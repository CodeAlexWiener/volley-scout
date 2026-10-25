# Flow-aware scouting (own side only)

We never log opponent touches. After each event, the UI suggests the **next likely own-side action + player** from volleyball rules + rotation.

## Roles

Only these roster roles:

| Id | Label |
| --- | --- |
| `setter` | Setter |
| `outside` | Outside Hitter |
| `opposite` | Opposite |
| `middle` | Middle Blocker |

No Läufer / generic hitter. Legacy `läufer` / `hitter` / `other` import as `outside`.

## Rotation + court diagram

- Court slots **P1–P6** (standard): P1 back-right (server when we serve), P2 front-right, P3 front-middle, P4 front-left, P5 back-left, P6 back-middle.
- Assign each player a **role** and **starting position** P1–P6.
- Track P1–P6 + rotate clockwise when we gain the right to serve.
- **UI court diagram** (our half): live player name in each slot; front row (P2–P4) vs back row (P5–P6–P1) visually distinct; server (P1) highlighted when we serve; updates on rotate / Apply starting.
- Fresh sessions start with a default six (Peter/Julia/Manu/Alex/Lucas/Kathi) already placed on P1–P6. No jersey numbers.
- **Rotate** on side-out when we earn serve. Manual Rotate still available.

## Attack / second-touch suggestion heuristics

- **in_system** pass → prefer `setter` + `second_touch` outcome `set`
- **out_of_system** → `second_touch` without forcing setter (often outcome `save`)
- After `second_touch`/`set` → attack by front-row slot: **P4 outside**, **P2 opposite (or outside)**, **P3 middle**; setter may dump
- After `second_touch`/`save` → freeball_send (or attack if still hittable)

## Updated action → outcome grid (v2.3)

### serve
- `ace` → we keep serve → **suggest same player serve again**
- `in_play_in_system` → serve in, opponent stays in system → **suggest dig/block** when ball returns
- `in_play_out_of_system` → serve in, opponent under pressure / out of system → **suggest dig/block** when ball returns
- `serve_error` → side-out → **suggest reception** (they will serve; our next touch is pass)

### reception (Annahme — only after opponent serve)
- `in_system` — setter can run system
- `out_of_system` — off-system
- `overpass` — ball goes to opponent
- `error` — direct point against / unplayable

No `perfect`. Flow: `in_system` → **suggest setter second_touch/set**. `out_of_system` → **suggest second_touch/save**. `overpass` → dig/block. `error` → point over → next serve/reception.

### dig (Abwehr — after attack/freeball, not serve)
Same as reception: `in_system` | `out_of_system` | `overpass` | `error` (no perfect).

### second_touch (was “set”)
- `set` — intentional set to a hitter (or dump may follow)
- `save` — emergency second touch to keep the ball alive

**Do not** grade in/out of system here — that is on the prior reception/dig. Setter analytics later = pass context + following attack (`kill` / `error_bad_set` / `error_own`) + dumps.

### attack
- `kill` (point)
- `defended` (stays in play on their side)
- `blocked` (stuff / channelled — see block pairing)
- `error_own` — attacker fault (out, net, lift)
- `error_bad_set` — unhittable set, attack attempt fails because of set

### dump (separate action — setter tip/dump)
- `point` | `defended` | `blocked` | `error_own` | `error_bad_set`

### block
- `kill_block` | `recycle` | `block_error`

### freeball_send
- `in_play` | `error`  
(Receive freeballs as **dig**, not freeball.)

## Suggestion engine (rules)

| Last event | Suggest next |
| --- | --- |
| serve/ace | same player + serve |
| serve/in_play_in_system \| in_play_out_of_system | front-row → block; back-row → dig |
| serve/serve_error | reception (back-row / outside preferred) |
| reception/in_system | setter + second_touch (prefer outcome set) |
| reception/out_of_system | second_touch, player unconstrained (often save) |
| reception/overpass | dig/block |
| reception/error | if we now serve: rotate + serve P1; else reception |
| dig/* | same pattern as reception → second_touch |
| second_touch/set | attack by P4/P2/P3 role heuristics; setter may dump |
| second_touch/save | freeball_send or continue play |
| attack/kill \| dump/point \| block/kill_block | we serve: ensure rotation + serve |
| attack/defended \| dump/defended | dig/block |
| attack/blocked \| dump/blocked | cover dig (back) |
| */error ending point against us | opponent serves → reception |

## Attribute hand-offs

- Pass quality (`in_system` / `out_of_system`) → who is suggested for second_touch; **stored for setter analytics**, not re-entered on second_touch
- Attack `error_bad_set` vs `error_own` → setter vs hitter blame
- Attack blocked ↔ block recycle/kill
- Never log opponent actions; infer only our next touch
