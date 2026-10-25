# Action → outcome grid (v2.4)

Machine-readable source: [`data/action-outcome-grid.yaml`](../data/action-outcome-grid.yaml). Flow: [`scouting-flow.md`](./scouting-flow.md).

Own side only. **No `perfect`.** Second-touch quality for the setter is derived from prior pass + following attack — not graded in/out on the touch itself. Direct second-touch faults use the two error outcomes below.

| Action | Outcomes |
| --- | --- |
| Serve | Ace, In play — in system, In play — out of system, Serve error |
| Reception | In system, Out of system, Overpass, Error |
| Dig | In system, Out of system, Overpass, Error |
| Second touch | Set, Save, Error (own fault), Error (tried save) |
| Attack | Kill, Defended, Blocked, Error (own), Error (bad set) |
| Dump | Point, Defended, Blocked, Error (own), Error (bad set) |
| Block | Kill block, Recycle, Block error |
| Freeball (send) | In play, Error |

## Setter stats (derived)

Link rally chain: `reception|dig` → `second_touch` → `attack|dump`.

| Signal | How |
| --- | --- |
| System vs off-system | Prior pass `in_system` / `out_of_system` |
| Assist / kill set | Following attack `kill` or dump `point` |
| Bad set | Following attack/dump `error_bad_set` |
| Dump performance | Dump events on setter |
| Save rate | `second_touch` / `save` |
| Second-touch errors | `error_own` (own fault) vs `error_tried_save` (failed emergency save) |

**Still useful later (optional, not required to scout):** `priorEventId` on each event so chains are explicit; without it, use time order within a point.
