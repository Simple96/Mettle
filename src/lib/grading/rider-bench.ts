import "server-only";

/**
 * Rider Bench — a single-shot delivery-planning benchmark.
 *
 * Inspired by Karminski's "Silicon Rider Bench". We simplify the 24-hour
 * stateful sim into a deterministic puzzle: the agent receives the full
 * scenario (map, orders, battery, time budget) and submits a flat plan
 * (sequence of actions). The grader replays the plan and scores the result.
 *
 * Why simplified:
 *   - Our grader stack is synchronous and stateless. A turn-based MCP
 *     loop would be a big engineering lift for the first iteration.
 *   - Flat plans still test the high-value capabilities: route planning,
 *     order selection, battery/capacity management, deadline awareness.
 *   - Dynamic decision-making under uncertainty is the only thing we lose;
 *     future task variants can add demand surges / road closures and
 *     ask for adaptive plans (or expose a stateful tool surface).
 *
 * Action model (deliberately minimal):
 *
 *   move {to:[x,y]}           Manhattan-move to (x,y). Time += distance.
 *                             Battery -= distance. Both must remain ≥ 0.
 *   pickup {order: <id>}      Must be at order.pickup AND have capacity.
 *                             Time += 1.
 *   deliver {order: <id>}     Must be at order.delivery AND carrying order.
 *                             Time += 1. Fare paid (halved if late).
 *   charge                    Must be at a charging station. Battery = max.
 *                             Time += charge_steps (configurable).
 *   wait                      Time += 1. No-op; useful for stalling near a
 *                             station while waiting on a deadline.
 *
 * Illegal actions are recorded as failures but DON'T abort the run; the
 * simulator skips them and continues. The plan ends when actions are
 * exhausted, time/battery is depleted, or max_plan_length is reached.
 *
 * Scoring:
 *   score = revenue (the literal dollars earned during the shift).
 *   max_revenue = sum of every order's fare on time at full fare — the
 *   theoretical ceiling, surfaced as a separate field so callers can
 *   compute % completion if they want.
 *
 * We deliberately do NOT normalize to 0–100: rider_bench tasks are sized
 * so that perfect runs are hard / impossible. Reporting raw earnings keeps
 * task scenarios comparable across difficulty and gives agents a real
 * spread instead of a wall of 100s.
 *
 * Tiebreaker is plan length (shorter wins) — surfaced separately in the
 * audit log; the score itself is purely revenue-based to keep the rubric
 * simple.
 */

// ============================================================
// Scenario / plan / result types
// ============================================================

export type Coord = readonly [number, number];

export type RiderOrder = {
  id: string;
  pickup: Coord;
  delivery: Coord;
  fare: number;        // base fare paid on on-time delivery
  deadline: number;    // time-step before which delivery must complete
};

export type RiderBenchScenario = {
  grid: { width: number; height: number };
  rider_start: Coord;
  battery_start: number;
  battery_max: number;
  capacity: number;       // max simultaneous carried orders
  time_budget: number;    // hard cap on total time steps
  charging_stations: Coord[];
  charge_steps: number;   // time spent per `charge` action
  late_multiplier: number;// fare multiplier when delivered after deadline (e.g. 0.5)
  orders: RiderOrder[];
};

export type RiderBenchConfig = {
  kind: "rider_bench";
  max_plan_length?: number;
  scenario: RiderBenchScenario;
};

export type PlanAction =
  | { action: "move"; to: Coord }
  | { action: "pickup"; order: string }
  | { action: "deliver"; order: string }
  | { action: "charge" }
  | { action: "wait" };

export type TraceStep = {
  step: number;
  action: PlanAction;
  ok: boolean;
  error?: string;
  // State snapshot AFTER the action (or the attempt). Lets agents
  // post-mortem their plan.
  position: Coord;
  battery: number;
  time: number;
  revenue: number;
  carrying: string[];
};

export type RiderBenchSuccess = {
  ok: true;
  score: number;            // dollars earned (== revenue). NOT normalized.
  plan_length: number;
  duration_ms: number;
  revenue: number;
  max_revenue: number;
  delivered_on_time: number;
  delivered_late: number;
  picked_up: number;
  total_orders: number;
  illegal_actions: number;
  time_spent: number;
  battery_remaining: number;
  trace: TraceStep[];
};

export type RiderBenchFailure = {
  ok: false;
  reason:
    | "plan_too_long"
    | "plan_invalid_shape"
    | "no_orders"
    | "internal_error";
  message: string;
};

export type RiderBenchResult = RiderBenchSuccess | RiderBenchFailure;

// ============================================================
// Constants / defaults
// ============================================================

const ABSOLUTE_MAX_PLAN_LENGTH = 500;
const DEFAULT_MAX_PLAN_LENGTH = 200;
const WALL_CLOCK_MS = 1500;

// ============================================================
// Grader
// ============================================================

export function gradeRiderBench(
  plan: unknown,
  config: RiderBenchConfig
): RiderBenchResult {
  const startedAt = Date.now();

  if (!Array.isArray(plan)) {
    return {
      ok: false,
      reason: "plan_invalid_shape",
      message: "Plan must be a JSON array of action objects.",
    };
  }
  const maxLen = Math.min(
    config.max_plan_length ?? DEFAULT_MAX_PLAN_LENGTH,
    ABSOLUTE_MAX_PLAN_LENGTH
  );
  if (plan.length > maxLen) {
    return {
      ok: false,
      reason: "plan_too_long",
      message: `Plan has ${plan.length} steps; max is ${maxLen}.`,
    };
  }

  const scenario = config.scenario;
  if (!scenario || !Array.isArray(scenario.orders) || scenario.orders.length === 0) {
    return {
      ok: false,
      reason: "no_orders",
      message: "Scenario has no orders.",
    };
  }

  const orderById = new Map<string, RiderOrder>();
  for (const o of scenario.orders) orderById.set(o.id, o);

  const stationSet = new Set(
    scenario.charging_stations.map((c) => coordKey(c))
  );

  // ---- Mutable run state -------------------------------------
  let position: Coord = [scenario.rider_start[0], scenario.rider_start[1]];
  let battery = clamp(scenario.battery_start, 0, scenario.battery_max);
  let time = 0;
  let revenue = 0;
  const carrying = new Set<string>();
  const pickedUp = new Set<string>();
  const deliveredOnTime = new Set<string>();
  const deliveredLate = new Set<string>();
  let illegalActions = 0;
  const trace: TraceStep[] = [];

  // ---- Replay -----------------------------------------------
  for (let i = 0; i < plan.length; i++) {
    if (Date.now() - startedAt > WALL_CLOCK_MS) {
      // Simulator should never get close to this; bail out defensively.
      trace.push(snapshot(i, plan[i] as PlanAction, false, position, battery, time, revenue, carrying, "Wall-clock exceeded"));
      break;
    }
    if (time >= scenario.time_budget) {
      trace.push(snapshot(i, plan[i] as PlanAction, false, position, battery, time, revenue, carrying, "Out of time"));
      break;
    }

    const raw = plan[i];
    const validated = validateAction(raw, scenario);
    if (!validated.ok) {
      illegalActions += 1;
      trace.push(
        snapshot(
          i,
          (raw as PlanAction) ?? { action: "wait" },
          false,
          position,
          battery,
          time,
          revenue,
          carrying,
          validated.error
        )
      );
      continue;
    }
    const action = validated.action;

    let stepOk = true;
    let stepErr: string | undefined;

    switch (action.action) {
      case "move": {
        const dist = manhattan(position, action.to);
        if (dist === 0) {
          stepOk = false;
          stepErr = "move to same cell (use wait if you mean to idle)";
          break;
        }
        if (dist > battery) {
          stepOk = false;
          stepErr = `out of battery (need ${dist}, have ${battery})`;
          break;
        }
        if (time + dist > scenario.time_budget) {
          stepOk = false;
          stepErr = `out of time (need ${dist}, have ${scenario.time_budget - time})`;
          break;
        }
        position = [action.to[0], action.to[1]];
        battery -= dist;
        time += dist;
        break;
      }

      case "pickup": {
        const order = orderById.get(action.order);
        if (!order) {
          stepOk = false;
          stepErr = `unknown order '${action.order}'`;
          break;
        }
        if (pickedUp.has(order.id)) {
          stepOk = false;
          stepErr = "order already picked up";
          break;
        }
        if (!coordsEqual(position, order.pickup)) {
          stepOk = false;
          stepErr = `not at pickup location (you're at ${position}, pickup is ${order.pickup})`;
          break;
        }
        if (carrying.size >= scenario.capacity) {
          stepOk = false;
          stepErr = `over capacity (${carrying.size}/${scenario.capacity})`;
          break;
        }
        carrying.add(order.id);
        pickedUp.add(order.id);
        time += 1;
        break;
      }

      case "deliver": {
        const order = orderById.get(action.order);
        if (!order) {
          stepOk = false;
          stepErr = `unknown order '${action.order}'`;
          break;
        }
        if (!carrying.has(order.id)) {
          stepOk = false;
          stepErr = "not carrying this order";
          break;
        }
        if (!coordsEqual(position, order.delivery)) {
          stepOk = false;
          stepErr = `not at delivery location (you're at ${position}, delivery is ${order.delivery})`;
          break;
        }
        const onTime = time <= order.deadline;
        const fare = onTime
          ? order.fare
          : Math.round(order.fare * scenario.late_multiplier);
        revenue += fare;
        carrying.delete(order.id);
        if (onTime) deliveredOnTime.add(order.id);
        else deliveredLate.add(order.id);
        time += 1;
        break;
      }

      case "charge": {
        if (!stationSet.has(coordKey(position))) {
          stepOk = false;
          stepErr = "not at a charging station";
          break;
        }
        battery = scenario.battery_max;
        time += scenario.charge_steps;
        break;
      }

      case "wait": {
        time += 1;
        break;
      }
    }

    if (!stepOk) illegalActions += 1;
    trace.push(
      snapshot(
        i,
        action,
        stepOk,
        position,
        battery,
        time,
        revenue,
        carrying,
        stepErr
      )
    );
  }

  const maxRevenue = scenario.orders.reduce((acc, o) => acc + o.fare, 0);
  // Score is the raw revenue earned. Fares are dollars; revenue is the
  // sum of paid-out fares (each halved/multiplied if late). max_revenue
  // is reported separately so UIs can show completion %.
  const score = Math.round(revenue * 100) / 100;

  return {
    ok: true,
    score,
    plan_length: plan.length,
    duration_ms: Date.now() - startedAt,
    revenue,
    max_revenue: maxRevenue,
    delivered_on_time: deliveredOnTime.size,
    delivered_late: deliveredLate.size,
    picked_up: pickedUp.size,
    total_orders: scenario.orders.length,
    illegal_actions: illegalActions,
    time_spent: time,
    battery_remaining: battery,
    trace,
  };
}

// ============================================================
// Helpers
// ============================================================

function manhattan(a: Coord, b: Coord): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

function coordsEqual(a: Coord, b: Coord): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function coordKey(c: Coord): string {
  return `${c[0]},${c[1]}`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function snapshot(
  step: number,
  action: PlanAction,
  ok: boolean,
  position: Coord,
  battery: number,
  time: number,
  revenue: number,
  carrying: Set<string>,
  error?: string
): TraceStep {
  return {
    step,
    action,
    ok,
    error,
    position: [position[0], position[1]],
    battery,
    time,
    revenue,
    carrying: Array.from(carrying),
  };
}

/**
 * Defensive runtime validation. The HTTP layer already validates with zod,
 * but the grader is called directly from MCP-tool dispatchers etc., so we
 * defend in depth.
 */
function validateAction(
  raw: unknown,
  scenario: RiderBenchScenario
): { ok: true; action: PlanAction } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "action must be an object" };
  }
  const a = raw as { action?: unknown };
  switch (a.action) {
    case "move": {
      const to = (raw as { to?: unknown }).to;
      if (!Array.isArray(to) || to.length !== 2) {
        return { ok: false, error: "move.to must be [x, y]" };
      }
      const [x, y] = to;
      if (
        typeof x !== "number" ||
        typeof y !== "number" ||
        !Number.isInteger(x) ||
        !Number.isInteger(y) ||
        x < 0 ||
        y < 0 ||
        x >= scenario.grid.width ||
        y >= scenario.grid.height
      ) {
        return { ok: false, error: `move.to outside grid (got [${x},${y}])` };
      }
      return { ok: true, action: { action: "move", to: [x, y] } };
    }
    case "pickup":
    case "deliver": {
      const order = (raw as { order?: unknown }).order;
      if (typeof order !== "string" || order.length === 0) {
        return { ok: false, error: `${a.action}.order must be a non-empty string` };
      }
      return { ok: true, action: { action: a.action, order } };
    }
    case "charge":
      return { ok: true, action: { action: "charge" } };
    case "wait":
      return { ok: true, action: { action: "wait" } };
    default:
      return {
        ok: false,
        error: `unknown action '${String(a.action)}' (expected move/pickup/deliver/charge/wait)`,
      };
  }
}
