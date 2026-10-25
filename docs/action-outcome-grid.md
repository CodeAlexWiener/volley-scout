# Action → outcome grid

Machine-readable source: [`data/action-outcome-grid.yaml`](../data/action-outcome-grid.yaml).

## Purpose

Every verified scout event is `player + action + outcome` at a timestamp. Outcomes are **not** free text — they come from this grid, filtered by the chosen action.

## Schema

| Field | Meaning |
| --- | --- |
| `version` | Integer grid revision (bump when you intentionally change semantics) |
| `actions[].id` | Stable `snake_case` id used in event logs |
| `actions[].label` | Human label for the UI |
| `actions[].outcomes[].id` | Stable outcome id (unique within that action) |
| `actions[].outcomes[].label` | Human label for the UI |
| `actions[].outcomes[].note` | Optional clarification |

## Starter actions (v1)

| Action | Outcomes |
| --- | --- |
| Serve | Ace, In play (rally continues), Serve error |
| Reception | Perfect, Good, Poor, Error |
| Set | Set, Error |
| Attack | Kill, Defended, Error, Blocked |
| Block | Kill block, Recycle, Block error |
| Dig | Dig, Error |
| Freeball | Freeball, Error |

## Event fields (related)

Verified events store `action` and `outcome` as these ids. Reserved for later AI plug-in (not used in the manual mask UI yet):

- `source`: `human` \| `ai`
- `status`: `proposed` \| `accepted` \| `rejected`

Edit this grid with Alex as product owner; keep ids stable once match JSON exists in the wild.
