# Action → outcome grid (v2.1)

Machine-readable source: [`data/action-outcome-grid.yaml`](../data/action-outcome-grid.yaml). Flow: [`scouting-flow.md`](./scouting-flow.md).

Own side only. **No `perfect`.** **Set is not graded in/out** — that lives on the pass; setter skill is computed later.

| Action | Outcomes |
| --- | --- |
| Serve | Ace, In play, Serve error |
| Reception | In system, Out of system, Overpass, Error |
| Dig | In system, Out of system, Overpass, Error |
| Set | Set, Error |
| Attack | Kill, Defended, Blocked, Error (own), Error (bad set) |
| Dump | Point, Defended, Blocked, Error (own), Error (bad set) |
| Block | Kill block, Recycle, Block error |
| Freeball (send) | In play, Error |

## Setter stats (derived — do not enter on set)

Link rally chain: `reception|dig` → `set` → `attack|dump`.

| Signal | How |
| --- | --- |
| System vs off-system sets | Prior pass `in_system` / `out_of_system` |
| Assist / kill set | Following attack `kill` or dump `point` |
| Bad set | Following attack/dump `error_bad_set` |
| Setter fault | Set outcome `error` |
| Dump performance | Dump events on setter |

**Still useful later (optional, not required to scout):** `priorEventId` on each event so chains are explicit; without it, use time order within a point.

## Schema

| Field | Meaning |
| --- | --- |
| `version` | Grid revision (`"2.1"`) |
| `actions[].id` | Stable `snake_case` id used in event logs |
| `actions[].label` | Human label for the UI |
| `actions[].outcomes[].id` | Stable outcome id (unique within that action) |
| `actions[].outcomes[].label` | Human label for the UI |
| `actions[].outcomes[].note` | Optional clarification |

Verified events store `action` and `outcome` as these ids. Reserved for later AI plug-in:

- `source`: `human` \| `ai`
- `status`: `proposed` \| `accepted` \| `rejected`
