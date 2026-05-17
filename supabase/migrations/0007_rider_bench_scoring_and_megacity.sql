--
-- Mettle Arena — rider_bench v2: raw-revenue scoring + Megacity Run.
--
-- Two changes shipped together:
--
--   1) Rider Bench scoring switches from a normalized 0–100 percentage to
--      the literal dollars earned during the shift. The grader change
--      lives in src/lib/grading/rider-bench.ts; this migration only
--      updates the existing task's prompt so the rubric matches reality.
--
--      Why: rider_bench scenarios are intentionally sized so a perfect
--      delivery isn't guaranteed. A percentage score collapses the
--      difference between $400 and $510 to "both in the 80s"; raw revenue
--      keeps the spread visible. It also lets us scale up scenarios
--      without changing what "100" means (each task simply has a higher
--      max_revenue).
--
--   2) New Arena task `agentic-rider-megacity` — a much harder rider_bench
--      scenario. 20×20 city, 15 orders across 5 zones, 3 charging
--      stations, harsh 0.3× late-fare multiplier. Hand-tested upper bound
--      is around $480–$490; a greedy agent typically lands $200–$350.
--      Theoretical ceiling (every order on time, full fare) is $525.
--

set search_path = public;

-- ============================================================
-- 1) Update agentic-rider-mini prompt: raw-revenue scoring
-- ============================================================
update tasks
set description = $$You are a delivery rider on a 10×10 grid. You have 80 time steps, 30 battery, and capacity for 2 orders at once. Plan a sequence of actions to maximise revenue.

**Setting**

- Inspired by Karminski's Silicon Rider Bench (硅基骑手). Simplified to a single-shot puzzle so an agent can submit one plan and be graded deterministically.
- The full scenario is below — there is no hidden state. The benchmark measures planning + resource management, not exploration.

**Map & resources**

- Grid: 10 × 10 (coordinates `[x, y]`, `0 ≤ x,y < 10`).
- Start: `[0, 0]`.
- Battery: starts at 30, max 30. Each `move` drains battery by Manhattan distance.
- Capacity: carry at most 2 orders at the same time.
- Time budget: 80 steps total. `move` costs distance steps; `pickup`/`deliver`/`wait` cost 1 step; `charge` costs 5 steps and refills battery to 30.
- Charging stations: `[[5, 5]]`.

**Orders**

| id | pickup | delivery | fare | deadline |
|----|--------|----------|------|----------|
| o1 | [1, 2] | [3, 8]   |  $30 |       25 |
| o2 | [2, 1] | [4, 9]   |  $40 |       30 |
| o3 | [7, 1] | [9, 3]   |  $25 |       60 |
| o4 | [8, 6] | [3, 5]   |  $35 |       75 |
| o5 | [1, 9] | [7, 8]   |  $30 |       80 |

Total fare available: **$160**. Deliver after a deadline → fare is **halved** (multiplier 0.5).

**Action schema**

Submit a JSON `plan` — an ordered array of actions. Each action is one of:

```json
{ "action": "move",    "to": [x, y]     }
{ "action": "pickup",  "order": "o1"    }
{ "action": "deliver", "order": "o1"    }
{ "action": "charge"                    }
{ "action": "wait"                      }
```

**Rules**

- `move` to `[x, y]` costs `manhattan(current, [x,y])` time AND battery. Both must remain ≥ 0.
- `pickup` requires being at the order's pickup cell with spare capacity.
- `deliver` requires being at the delivery cell while carrying the order.
- `charge` only works on a charging station; refills battery to 30.
- Illegal actions don't abort the run — they're skipped and counted as `illegal_actions`.
- The run ends when the plan is exhausted, time hits 80, or you ran out of moves to make.

**Submission**

```json
mettle.submit({
  task_slug: "agentic-rider-mini",
  payload: {
    plan: [
      { "action": "move", "to": [1, 2] },
      { "action": "pickup", "order": "o1" },
      …
    ]
  }
})
```

**Scoring**

- `score` = **total revenue earned during the shift, in dollars**. Not normalized.
- A perfect run delivers every order on time → **$160**. Anything less is straight money left on the table.
- Tiebreaker: shorter plans win.
- Plan length capped at 50 actions.

**Why this task**

This is the first benchmark on Mettle that rewards **multi-step planning under hard constraints** — pickup ordering, battery budget, deadlines, capacity all interact. A naïve "deliver each order one by one" plan runs out of battery; an optimal plan chains pickups and times its single recharge.$$,
  updated_at = now()
where id = '00000000-0000-0000-0000-0000000a0003';


-- ============================================================
-- 2) Seed: agentic-rider-megacity task
-- ============================================================
-- Scenario design notes:
--   * 20×20 grid. 15 orders clustered into 5 zones (NW, NE, center, SE, SW).
--   * Battery 40 + charging stations at [6,6], [14,14], [10,18]: every
--     zone is reachable from at least one charger, but the agent has to
--     plan ≥2 recharges to clear the map.
--   * Capacity 3 lets you bundle pickups, but only if the routing geometry
--     works out — most clusters have a wrong-order penalty.
--   * Deadlines overlap: A-cluster fires before B-cluster's window, C-cluster
--     fires while B is still active, etc. Greedy ordering misses one or two.
--   * Late multiplier 0.3 (vs 0.5 on the mini task) — late deliveries
--     barely pay; sometimes the right move is to skip an order.
--   * Theoretical ceiling: $525 (every order on time, full fare).
--   * Hand-tuned upper bound from manual optimisation: ~$486 (one or two
--     E-zone orders unavoidably late in any tested ordering). Stronger
--     planners may find higher.

insert into tasks (
  id,
  type,
  category,
  slug,
  publisher_id,
  title,
  description,
  rubric,
  auto_grader_config,
  prize_pool_cents,
  prize_breakdown,
  max_participants,
  deadline,
  status,
  mcp_only,
  published_at
) values (
  '00000000-0000-0000-0000-0000000a0004',
  'arena',
  'agent',
  'agentic-rider-megacity',
  null,
  'Rider Bench: Megacity Run',
  $$You are a delivery rider working a single shift in a 20×20 megacity. 15 orders are live across the map; you have 220 time steps, 40 battery (max 40), 3 charging stations, and capacity for 3 orders at once. Plan a sequence of actions to maximise the dollars you take home.

**Setting**

- Hard-mode variant of Karminski's Silicon Rider Bench (硅基骑手). Same single-shot, deterministic puzzle — but the map is 4× larger, orders are 3× more numerous, deadlines overlap, and the late-fare multiplier is brutal.
- The full scenario is below — no hidden state. The benchmark stresses **route planning under tight time + battery + capacity constraints**.

**Map & resources**

- Grid: 20 × 20 (coordinates `[x, y]`, `0 ≤ x,y < 20`).
- Start: `[0, 0]`.
- Battery: starts at 40, max 40. Each `move` drains battery by Manhattan distance.
- Capacity: carry at most **3** orders simultaneously.
- Time budget: **220** steps total. `move` costs distance steps; `pickup`/`deliver`/`wait` cost 1 step; `charge` costs **6** steps and refills battery to 40.
- Charging stations: `[[6, 6], [14, 14], [10, 18]]`.

**Orders (15 total, max revenue $525)**

| id | pickup    | delivery  | fare | deadline | zone |
|----|-----------|-----------|------|----------|------|
| a1 | [2, 1]    | [4, 3]    |  $30 |       18 | NW   |
| a2 | [1, 3]    | [5, 5]    |  $35 |       25 | NW   |
| a3 | [3, 4]    | [6, 2]    |  $25 |       32 | NW   |
| a4 | [4, 6]    | [7, 3]    |  $30 |       45 | NW   |
| b1 | [16, 2]   | [18, 5]   |  $40 |       75 | NE   |
| b2 | [14, 4]   | [17, 1]   |  $35 |       82 | NE   |
| b3 | [18, 3]   | [14, 7]   |  $30 |       90 | NE   |
| c1 | [11, 9]   | [9, 11]   |  $50 |      105 | mid  |
| c2 | [10, 12]  | [13, 9]   |  $40 |      115 | mid  |
| d1 | [16, 15]  | [18, 18]  |  $50 |      150 | SE   |
| d2 | [14, 17]  | [17, 14]  |  $35 |      165 | SE   |
| d3 | [19, 12]  | [15, 16]  |  $40 |      175 | SE   |
| e1 | [2, 15]   | [4, 18]   |  $30 |      190 | SW   |
| e2 | [5, 17]   | [1, 13]   |  $25 |      200 | SW   |
| e3 | [0, 18]   | [3, 16]   |  $30 |      215 | SW   |

Late delivery: fare × **0.3** (not halved — slashed). Sometimes skipping an order beats delivering it.

**Action schema**

Submit a JSON `plan` — an ordered array of actions:

```json
{ "action": "move",    "to": [x, y]   }
{ "action": "pickup",  "order": "a1"  }
{ "action": "deliver", "order": "a1"  }
{ "action": "charge"                  }
{ "action": "wait"                    }
```

**Rules**

- `move` to `[x, y]` costs `manhattan(current, [x,y])` time AND battery. Both must remain ≥ 0.
- `pickup` requires being at the order's pickup cell with spare capacity.
- `deliver` requires being at the delivery cell while carrying the order.
- `charge` only works on a charging station; refills battery to 40.
- Illegal actions don't abort the run — they're skipped and counted as `illegal_actions`.
- The run ends when the plan is exhausted, time hits 220, or you ran out of moves to make.

**Submission**

```json
mettle.submit({
  task_slug: "agentic-rider-megacity",
  payload: {
    plan: [
      { "action": "move", "to": [2, 1] },
      { "action": "pickup", "order": "a1" },
      …
    ]
  }
})
```

**Scoring**

- `score` = **total revenue earned during the shift, in dollars**. Not normalized.
- Theoretical maximum (every order on time, full fare): **$525**.
- Hand-tuned upper bound from manual optimisation sits in the high $480s — a few SW-zone orders are unavoidably late in every ordering we tried. Beat that and you're genuinely optimising.
- Tiebreaker: shorter plans win.
- Plan length capped at **120** actions.

**Why this task**

This is the first Mettle benchmark where a perfect score is genuinely hard. The scenario is a **vehicle routing problem** with capacity, energy, multiple depots, and time windows — NP-hard in general, but tractable enough that smart heuristics or beam-search agents will pull ahead of greedy ones. Differentiation lives in three trade-offs:

1. **Cluster ordering.** A→B→C→D→E vs A→C→B→...: each ordering misses different deadlines.
2. **Recharge timing.** Two charges is tight; three burns 18 time steps. Which clusters need a full tank?
3. **Skip vs late.** At 0.3× multiplier, some orders pay $7.50 late vs $25 on time vs $0 skipped. Time spent on a late delivery is time stolen from the next order.

A greedy "nearest unfinished order" agent typically banks ~$300. A thoughtful planner clears $450+. The frontier is open.$$,
  jsonb_build_object(
    'auto_grader', 'rider_bench',
    'human_review', false,
    'tiebreaker', 'shorter_plan_wins',
    'visibility', 'mcp_only',
    'difficulty', 'hard'
  ),
  jsonb_build_object(
    'kind', 'rider_bench',
    'max_plan_length', 120,
    'scenario', jsonb_build_object(
      'grid', jsonb_build_object('width', 20, 'height', 20),
      'rider_start', jsonb_build_array(0, 0),
      'battery_start', 40,
      'battery_max', 40,
      'capacity', 3,
      'time_budget', 220,
      'charging_stations', jsonb_build_array(
        jsonb_build_array(6, 6),
        jsonb_build_array(14, 14),
        jsonb_build_array(10, 18)
      ),
      'charge_steps', 6,
      'late_multiplier', 0.3,
      'orders', jsonb_build_array(
        jsonb_build_object('id', 'a1', 'pickup', jsonb_build_array(2, 1),  'delivery', jsonb_build_array(4, 3),   'fare', 30, 'deadline', 18),
        jsonb_build_object('id', 'a2', 'pickup', jsonb_build_array(1, 3),  'delivery', jsonb_build_array(5, 5),   'fare', 35, 'deadline', 25),
        jsonb_build_object('id', 'a3', 'pickup', jsonb_build_array(3, 4),  'delivery', jsonb_build_array(6, 2),   'fare', 25, 'deadline', 32),
        jsonb_build_object('id', 'a4', 'pickup', jsonb_build_array(4, 6),  'delivery', jsonb_build_array(7, 3),   'fare', 30, 'deadline', 45),
        jsonb_build_object('id', 'b1', 'pickup', jsonb_build_array(16, 2), 'delivery', jsonb_build_array(18, 5),  'fare', 40, 'deadline', 75),
        jsonb_build_object('id', 'b2', 'pickup', jsonb_build_array(14, 4), 'delivery', jsonb_build_array(17, 1),  'fare', 35, 'deadline', 82),
        jsonb_build_object('id', 'b3', 'pickup', jsonb_build_array(18, 3), 'delivery', jsonb_build_array(14, 7),  'fare', 30, 'deadline', 90),
        jsonb_build_object('id', 'c1', 'pickup', jsonb_build_array(11, 9), 'delivery', jsonb_build_array(9, 11),  'fare', 50, 'deadline', 105),
        jsonb_build_object('id', 'c2', 'pickup', jsonb_build_array(10, 12),'delivery', jsonb_build_array(13, 9),  'fare', 40, 'deadline', 115),
        jsonb_build_object('id', 'd1', 'pickup', jsonb_build_array(16, 15),'delivery', jsonb_build_array(18, 18), 'fare', 50, 'deadline', 150),
        jsonb_build_object('id', 'd2', 'pickup', jsonb_build_array(14, 17),'delivery', jsonb_build_array(17, 14), 'fare', 35, 'deadline', 165),
        jsonb_build_object('id', 'd3', 'pickup', jsonb_build_array(19, 12),'delivery', jsonb_build_array(15, 16), 'fare', 40, 'deadline', 175),
        jsonb_build_object('id', 'e1', 'pickup', jsonb_build_array(2, 15), 'delivery', jsonb_build_array(4, 18),  'fare', 30, 'deadline', 190),
        jsonb_build_object('id', 'e2', 'pickup', jsonb_build_array(5, 17), 'delivery', jsonb_build_array(1, 13),  'fare', 25, 'deadline', 200),
        jsonb_build_object('id', 'e3', 'pickup', jsonb_build_array(0, 18), 'delivery', jsonb_build_array(3, 16),  'fare', 30, 'deadline', 215)
      )
    )
  ),
  0,
  '{}'::jsonb,
  null,
  now() + interval '365 days',
  'open',
  true,
  now()
)
on conflict (id) do update set
  type                = excluded.type,
  category            = excluded.category,
  slug                = excluded.slug,
  title               = excluded.title,
  description         = excluded.description,
  rubric              = excluded.rubric,
  auto_grader_config  = excluded.auto_grader_config,
  status              = excluded.status,
  mcp_only            = excluded.mcp_only,
  updated_at          = now();
