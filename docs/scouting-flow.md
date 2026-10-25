# Flow-aware scouting (own side only)

We never log opponent touches. After each event, the UI suggests the **next likely own-side action + player** from volleyball rules + rotation (Läufer).

## Rotation / Läufer

- Court slots **P1–P6** (standard): P1 back-right (server when we serve), P2 front-right, P3 front-middle, P4 front-left, P5 back-left, P6 back-middle.
- On roster setup: assign each player a **starting position** and optionally mark **one Läufer** (defensive specialist). **v1**: track P1–P6 + rotate clockwise on side-out *when we gain the right to serve*; Läufer flag prefers Läufer for dig/reception suggestions in back row.
- **Rotate** when serve possession changes to us (side-out): we scored while receiving → rotate before we serve. We erred on serve / lost while serving → they serve: no our rotate until we side-out again.

## Updated action → outcome grid (v2.1)

### serve
- `ace` → we keep serve → **suggest same player serve again**
- `in_play` → rally on → **suggest dig/block** when ball returns (not reception)
- `serve_error` → side-out → **suggest reception** (they will serve; our next touch is pass)

### reception (Annahme — only after opponent serve)
- `in_system` — setter can run system
- `out_of_system` — off-system
- `overpass` — ball goes to opponent
- `error` — direct point against / unplayable

No `perfect`. Flow: `in_system` → **suggest setter set**. `out_of_system` → **suggest set, don’t force setter**. `overpass` → dig/block. `error` → point over → next serve/reception.

### dig (Abwehr — after attack/freeball, not serve)
Same as reception: `in_system` | `out_of_system` | `overpass` | `error` (no perfect).

### set
- `set` — successful contact that creates a hit (or dump follows)
- `error` — setter fault (double, catch, net, …)

**Do not** grade set in/out of system. That is already on the pass. Setter quality later = pass context + following attack (`kill` / `error_bad_set` / `error_own`) + set `error` + dumps.

### attack
- `kill` (point)
- `defended` (stays in play on their side)
- `blocked` (stuff / channelled — see block pairing)
- `error_own` — attacker fault (out, net, lift)
- `error_bad_set` — unhittable set, attack attempt fails because of set

Flow: kill → we serve next (rotate if we were receiving). defended → suggest dig/block. blocked → suggest cover dig / block recycle on our blocker. errors → point over → reception or serve.

### dump (separate action — setter tip/dump)
- `point` (kill dump)
- `defended`
- `blocked`
- `error_own`
- `error_bad_set` (rare)

### block
- `kill_block`
- `recycle` (soft / playable)
- `block_error`

Pairing: our block recycle ↔ their attack defended; kill_block ends point.

### freeball_send
- `in_play` | `error`
(Receive freeballs as **dig**, not freeball.)

## Suggestion engine (rules)

| Last event | Suggest next |
| --- | --- |
| serve/ace | same player + serve |
| serve/in_play | front-row → block; back-row → dig |
| serve/serve_error | reception (back-row / Läufer preferred) |
| reception/in_system | setter + set (do not prefill in/out on set) |
| reception/out_of_system | set, player unconstrained |
| reception/overpass | dig/block |
| reception/error | if we now serve: rotate + serve P1; else reception |
| dig/* | same pattern as reception → set |
| set/* | hitter suggestion by position (P4/P2/P3) + attack; setter may dump |
| attack/kill \| dump/point \| block/kill_block | we serve: ensure rotation + serve |
| attack/defended \| dump/defended | dig/block |
| attack/blocked \| dump/blocked | cover dig (back) |
| */error ending point against us | opponent serves → reception |

## Attribute hand-offs

- Pass quality (`in_system` / `out_of_system`) → who is suggested to set; **stored for setter analytics**, not re-entered on set
- Attack `error_bad_set` vs `error_own` → setter vs hitter blame
- Attack blocked ↔ block recycle/kill
- Never log opponent actions; infer only our next touch

## Setter analytics (computed, not scouted as set grade)

Need a rally chain (time-ordered events in a point, ideally `priorEventId` later):

1. **% in-system sets** — sets whose preceding reception/dig was `in_system`
2. **Assists** — set followed by attack `kill` or dump `point`
3. **Bad sets** — following attack/dump `error_bad_set`
4. **Setter errors** — set outcome `error`
5. **Dump rates** — dump action by setter
