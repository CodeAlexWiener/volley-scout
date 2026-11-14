# Scout grid (v3, two steps)

Pick the **player row** (↑↓, the likely player is pre-selected), then **step 1** with keys 1–5, then, if the option has a `›`, **step 2** with keys 1–5 or Enter for the first (default). Esc backs out of step 2. `,` and `.` switch the situation by hand; the switch holds until the next entry.

Every situation also has an **Opponent** row and a **Team** row at the bottom. **Replay** is always the very last option.

"Point us / them" means the entry ends the rally. "Play on" means it continues.

## We serve (likely player: P1)
| Step 1 | Step 2 | Result |
|---|---|---|
| In play | **their pass in system** · out of system · overpass | play on → ball comes over |
| Ace | **no touch** · touched | point us |
| Error | — | point them |

## They serve (likely player: back-row passer)
| Step 1 | Result |
|---|---|
| In system | play on → second touch |
| Out of system | play on → second touch |
| Overpass | play on → ball comes over |
| Error | point them |
| *Opponent:* Serve error | point us |

## Second touch (likely player: setter)
| Step 1 | Step 2 | Result |
|---|---|---|
| Set | — | play on → attack |
| Save | — | play on → attack |
| Attack on 2 | — | the next entry is an attack by the same player |
| Error | **lift/double** · net · failed save | point them |
| Freeball | **in play** · error | in play → ball comes over · error: point them |

## Attack (likely player: front-row hitter)
| Step 1 | Step 2 | Result |
|---|---|---|
| Kill | **spike** · tip/dump · block-out | point us |
| Defended | — | play on → ball comes over |
| Blocked | **stuffed** · covered | stuffed: point them · covered: play on |
| Error | **out** · net · bad set · violation | point them |
| Freeball | **in play** · error | as above |

## Ball comes over (likely player: back-row passer)
| Step 1 | Step 2 | Result |
|---|---|---|
| Dig | **in system** · out of system · overpass · error | error: point them · otherwise play on |
| Block | **kill block** · soft block · touch · tooled · block error | kill block: point us · tooled / block error: point them · otherwise play on |
| Freeball | **in play** · error | as above |
| *Opponent:* Out | — | point us |

## Every situation
| Row | Options | Result |
|---|---|---|
| Opponent | Error (plus Serve error / Out above) | point us |
| Team | Down · Fault · **Replay** (last) | Down, Fault: point them · Replay: no point, same server |

## Rules around the grid
- **P / O**: point us / them, when the deciding touch is not tracked.
- **Double point guard**: a second deciding entry in the same rally asks before counting.
- **Set end**: 25 (15 in set 3) with a two-point lead. A dialog asks who serves the next set and whether the starting lineup or the current rotation starts.
- **Substitutions**: in the roster, a bench player has "Sub in for…". The new player takes over that court position and rotation.
- Entries are assigned to the rally they fall in, or the nearest one within 1.5 s.
- Matches written with grid v2.x are converted on load (dump → attack, serve_error → serve error, recycle → soft block, …).
