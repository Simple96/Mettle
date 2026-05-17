#!/usr/bin/env python3
"""Solve agentic-rider-megacity: beam search over macro actions."""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, FrozenSet, List, Optional, Set, Tuple

Point = Tuple[int, int]


def manhattan(a: Point, b: Point) -> int:
    return abs(a[0] - b[0]) + abs(a[1] - b[1])


def js_round_pos(x: float) -> int:
    """Match JavaScript Math.round for nonnegative values (Python round differs at .5)."""
    return math.floor(x + 0.5)


ORDERS: Dict[str, dict] = {
    "a1": {"pickup": (2, 1), "delivery": (4, 3), "fare": 30, "deadline": 18},
    "a2": {"pickup": (1, 3), "delivery": (5, 5), "fare": 35, "deadline": 25},
    "a3": {"pickup": (3, 4), "delivery": (6, 2), "fare": 25, "deadline": 32},
    "a4": {"pickup": (4, 6), "delivery": (7, 3), "fare": 30, "deadline": 45},
    "b1": {"pickup": (16, 2), "delivery": (18, 5), "fare": 40, "deadline": 75},
    "b2": {"pickup": (14, 4), "delivery": (17, 1), "fare": 35, "deadline": 82},
    "b3": {"pickup": (18, 3), "delivery": (14, 7), "fare": 30, "deadline": 90},
    "c1": {"pickup": (11, 9), "delivery": (9, 11), "fare": 50, "deadline": 105},
    "c2": {"pickup": (10, 12), "delivery": (13, 9), "fare": 40, "deadline": 115},
    "d1": {"pickup": (16, 15), "delivery": (18, 18), "fare": 50, "deadline": 150},
    "d2": {"pickup": (14, 17), "delivery": (17, 14), "fare": 35, "deadline": 165},
    "d3": {"pickup": (19, 12), "delivery": (15, 16), "fare": 40, "deadline": 175},
    "e1": {"pickup": (2, 15), "delivery": (4, 18), "fare": 30, "deadline": 190},
    "e2": {"pickup": (5, 17), "delivery": (1, 13), "fare": 25, "deadline": 200},
    "e3": {"pickup": (0, 18), "delivery": (3, 16), "fare": 30, "deadline": 215},
}

STATIONS: Set[Point] = {(6, 6), (14, 14), (10, 18)}
BAT_MAX = 40
TIME_BUDGET = 220
CHARGE_STEPS = 6
CAPACITY = 3
LATE_MULT = 0.3
MAX_PLAN_LEN = 120


Action = dict  # serialized plan step


@dataclass
class State:
    pos: Point
    time: int
    battery: int
    carrying: FrozenSet[str]
    delivered: FrozenSet[str]
    revenue: int
    plan: List[Action] = field(default_factory=list)

    def key(self) -> tuple:
        return (
            self.pos,
            self.time,
            self.battery,
            self.carrying,
            self.delivered,
        )


def apply_move(s: State, to: Point) -> Optional[State]:
    d = manhattan(s.pos, to)
    if d == 0:
        return None
    if s.time + d > TIME_BUDGET:
        return None
    if s.battery < d:
        return None
    return State(
        pos=to,
        time=s.time + d,
        battery=s.battery - d,
        carrying=s.carrying,
        delivered=s.delivered,
        revenue=s.revenue,
        plan=s.plan + [{"action": "move", "to": list(to)}],
    )


def apply_charge(s: State) -> Optional[State]:
    if s.pos not in STATIONS:
        return None
    if s.time + CHARGE_STEPS > TIME_BUDGET:
        return None
    return State(
        pos=s.pos,
        time=s.time + CHARGE_STEPS,
        battery=BAT_MAX,
        carrying=s.carrying,
        delivered=s.delivered,
        revenue=s.revenue,
        plan=s.plan + [{"action": "charge"}],
    )


def apply_pickup(s: State, oid: str) -> Optional[State]:
    o = ORDERS[oid]
    if oid in s.delivered or oid in s.carrying:
        return None
    if len(s.carrying) >= CAPACITY:
        return None
    if s.pos != o["pickup"]:
        return None
    if s.time + 1 > TIME_BUDGET:
        return None
    nc = frozenset(s.carrying | {oid})
    return State(
        pos=s.pos,
        time=s.time + 1,
        battery=s.battery,
        carrying=nc,
        delivered=s.delivered,
        revenue=s.revenue,
        plan=s.plan + [{"action": "pickup", "order": oid}],
    )


def apply_deliver(s: State, oid: str) -> Optional[State]:
    o = ORDERS[oid]
    if oid not in s.carrying:
        return None
    if s.pos != o["delivery"]:
        return None
    if s.time + 1 > TIME_BUDGET:
        return None
    # Matches rider-bench.ts: lateness uses time *before* deliver; fare uses full or round(fare * late_mult).
    on_time = s.time <= o["deadline"]
    add = o["fare"] if on_time else js_round_pos(o["fare"] * LATE_MULT)
    nc = frozenset(s.carrying - {oid})
    nd = frozenset(s.delivered | {oid})
    return State(
        pos=s.pos,
        time=s.time + 1,
        battery=s.battery,
        carrying=nc,
        delivered=nd,
        revenue=s.revenue + add,
        plan=s.plan + [{"action": "deliver", "order": oid}],
    )


def candidate_targets(s: State) -> List[Point]:
    targets: Set[Point] = set()
    for oid, o in ORDERS.items():
        if oid in s.delivered:
            continue
        if oid not in s.carrying:
            targets.add(o["pickup"])
        else:
            targets.add(o["delivery"])
    targets |= STATIONS
    # include neighbors of current pos only if needed — full set
    return list(targets)


def upper_bound_revenue(s: State) -> int:
    """Naive upper bound: sum fares of undelivered (optimistic)."""
    left = 0
    for oid, o in ORDERS.items():
        if oid in s.delivered:
            continue
        left += o["fare"]
    return s.revenue + left


def beam_search(beam_width: int = 4000, max_iters: int = 200000) -> State:
    start = State(
        pos=(0, 0),
        time=0,
        battery=BAT_MAX,
        carrying=frozenset(),
        delivered=frozenset(),
        revenue=0,
        plan=[],
    )
    # priority: maximize revenue, minimize time, minimize plan len (tie)
    beam: List[State] = [start]
    best = start

    for _ in range(max_iters):
        if not beam:
            break
        # expand
        next_states: List[State] = []
        for s in beam:
            if len(s.plan) >= MAX_PLAN_LEN:
                continue
            if s.revenue > best.revenue or (
                s.revenue == best.revenue and len(s.plan) < len(best.plan)
            ):
                best = s
            if s.time >= TIME_BUDGET:
                continue

            # deliver any at spot
            for oid in list(s.carrying):
                ns = apply_deliver(s, oid)
                if ns and len(ns.plan) <= MAX_PLAN_LEN:
                    next_states.append(ns)

            # pickup any at spot
            for oid in ORDERS:
                if oid in s.delivered or oid in s.carrying:
                    continue
                ns = apply_pickup(s, oid)
                if ns and len(ns.plan) <= MAX_PLAN_LEN:
                    next_states.append(ns)

            ns = apply_charge(s)
            if ns and len(ns.plan) <= MAX_PLAN_LEN:
                next_states.append(ns)

            for to in candidate_targets(s):
                ns = apply_move(s, to)
                if ns and len(ns.plan) <= MAX_PLAN_LEN:
                    next_states.append(ns)

        if not next_states:
            break

        def score(st: State) -> Tuple:
            ub = upper_bound_revenue(st)
            return (
                st.revenue,
                ub,
                -st.time,
                -len(ORDERS) + len(st.delivered),
                -len(st.plan),
            )

        next_states.sort(key=score, reverse=True)
        # dedupe by key keeping best score
        seen: Dict[tuple, State] = {}
        for st in next_states:
            k = st.key()
            if k not in seen or score(st) > score(seen[k]):
                seen[k] = st
        uniq = list(seen.values())
        uniq.sort(key=score, reverse=True)
        beam = uniq[:beam_width]

    return best


def main() -> None:
    b = beam_search(8000, max_iters=50000)
    print(
        "beam best revenue",
        b.revenue,
        "time",
        b.time,
        "len",
        len(b.plan),
        "delivered",
        len(b.delivered),
    )


if __name__ == "__main__":
    main()
