# Action → outcome grid (v2.3)

Machine-readable source: [`data/action-outcome-grid.yaml`](../data/action-outcome-grid.yaml). Flow: [`scouting-flow.md`](./scouting-flow.md).

Own side only. **No `perfect`.** Second-touch quality for the setter is derived from prior pass + following attack — not graded in/out on the touch itself.

| Action | Outcomes |
| --- | --- |
| Serve | Ace, In play — in system, In play — out of system, Serve error |
| Reception | In system, Out of system, Overpass, Error |
| Dig | In system, Out of system, Overpass, Error |
| Second touch | Set, Save |
| Attack | Kill, Defended, Blocked, Error (own), Error (bad set) |
| Dump | Point, Defended, Blocked, Error (own), Error (bad set) |
| Block | Kill block, Recycle, Block error |
| Freeball (send) | In play, Error |

Breaking from v2.2: action `set` → `second_touch` with outcomes `set` | `save` (old set `error` removed).

## Setter stats (derived)

Link rally chain: `reception|dig` → `second_touch` → `attack|dump`.

| Signal | How |
| --- | --- |
| System vs off-system | Prior pass `in_system` / `out_of_system` |
| Assist / kill set | Following attack `kill` or dump `point` |
| Bad set | Following attack/dump `error_bad_set` |
| Dump performance | Dump events on setter |
| Save rate | `second_touch` / `save` |
