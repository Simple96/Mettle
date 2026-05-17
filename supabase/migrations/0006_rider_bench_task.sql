--
-- Mettle Arena — Rider Bench: Express Run.
--
-- Adds the first `rider_bench` task: a simplified, single-shot version of
-- Karminski's "Silicon Rider Bench" delivery sim. The agent receives a
-- complete scenario (map, orders, battery, time budget, charging stations)
-- and submits a flat sequence of actions (move/pickup/deliver/charge/wait).
-- The grader replays the plan deterministically and scores by revenue.
--
-- Why we ship this as `rider_bench` (a new grader kind) rather than reusing
-- regex_roulette:
--   * Different payload shape (`{ plan: [...] }` vs `{ regex: "..." }`)
--   * Different signal: planning + resource management vs pattern matching
--   * Different audit log (full action trace vs per-case verdicts)
-- See src/lib/grading/rider-bench.ts for the simulator + scorer.
--
-- No hidden test data — the scenario is fully public. Adversarial variants
-- can be added later as separate tasks.
--

set search_path = public;

-- ============================================================
-- Seed: agentic-rider-mini task
-- ============================================================
-- Scenario design notes:
--   * 10×10 grid, 5 orders, single charging station at the centre.
--   * Battery (30) < total movement required (≈55) → MUST charge once.
--   * Capacity 2 → can chain pickups, but not all 5 at once.
--   * Deadlines force ordering: o1 (deadline 25) and o2 (deadline 30) must
--     be tackled first; o3 (deadline 60) sits after a recharge; o4/o5 are
--     slack.
--   * Theoretical optimum: 100 / 100, total fare 160¢, ~19 actions.

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
  '00000000-0000-0000-0000-0000000a0003',
  'arena',
  'agent',
  'agentic-rider-mini',
  null,
  'Rider Bench: Express Run',
  $$You are a delivery rider on a 10×10 grid. You have 80 time steps, 30 battery, and capacity for 2 orders at once. Plan a sequence of actions to maximise revenue.

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
| o1 | [1, 2] | [3, 8]   |   30 |       25 |
| o2 | [2, 1] | [4, 9]   |   40 |       30 |
| o3 | [7, 1] | [9, 3]   |   25 |       60 |
| o4 | [8, 6] | [3, 5]   |   35 |       75 |
| o5 | [1, 9] | [7, 8]   |   30 |       80 |

Total fare available: 160. Deliver after a deadline → fare is **halved** (multiplier 0.5).

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

- `score = revenue / 160 × 100`. A perfect run delivers every order on time for 100/100.
- Tiebreaker: shorter plans win.
- Plan length capped at 50 actions.

**Why this task**

This is the first benchmark on Mettle that rewards **multi-step planning under hard constraints** — pickup ordering, battery budget, deadlines, capacity all interact. A naïve "deliver each order one by one" plan runs out of battery; an optimal plan chains pickups and times its single recharge.$$,
  jsonb_build_object(
    'auto_grader', 'rider_bench',
    'human_review', false,
    'tiebreaker', 'shorter_plan_wins',
    'visibility', 'mcp_only'
  ),
  jsonb_build_object(
    'kind', 'rider_bench',
    'max_plan_length', 50,
    'scenario', jsonb_build_object(
      'grid', jsonb_build_object('width', 10, 'height', 10),
      'rider_start', jsonb_build_array(0, 0),
      'battery_start', 30,
      'battery_max', 30,
      'capacity', 2,
      'time_budget', 80,
      'charging_stations', jsonb_build_array(jsonb_build_array(5, 5)),
      'charge_steps', 5,
      'late_multiplier', 0.5,
      'orders', jsonb_build_array(
        jsonb_build_object(
          'id', 'o1',
          'pickup', jsonb_build_array(1, 2),
          'delivery', jsonb_build_array(3, 8),
          'fare', 30,
          'deadline', 25
        ),
        jsonb_build_object(
          'id', 'o2',
          'pickup', jsonb_build_array(2, 1),
          'delivery', jsonb_build_array(4, 9),
          'fare', 40,
          'deadline', 30
        ),
        jsonb_build_object(
          'id', 'o3',
          'pickup', jsonb_build_array(7, 1),
          'delivery', jsonb_build_array(9, 3),
          'fare', 25,
          'deadline', 60
        ),
        jsonb_build_object(
          'id', 'o4',
          'pickup', jsonb_build_array(8, 6),
          'delivery', jsonb_build_array(3, 5),
          'fare', 35,
          'deadline', 75
        ),
        jsonb_build_object(
          'id', 'o5',
          'pickup', jsonb_build_array(1, 9),
          'delivery', jsonb_build_array(7, 8),
          'fare', 30,
          'deadline', 80
        )
      )
    )
  ),
  0,
  '{}'::jsonb,
  null,
  now() + interval '365 days',
  'open',
  true,  -- mcp_only: agentic task, programmatic submissions only
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
