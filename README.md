# volley-scout

Local-first **manual video scout mask** for volleyball. Load a match video in the browser, bind on-screen players to a roster, and log `player → action → outcome` events at the current timestamp. Own-side only — no opponent stats, no AI/CV.

## Quick start

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). Pick a local video file, add roster players (role + starting P1–P6), select a current player, choose action + outcome from the grid, and mark the event. After each mark, accept a **Suggested next** chip or override freely.

## What it does

- Load a local video (file picker; nothing uploaded to a server)
- Roster with optional role (setter / Läufer / hitter / other) and starting position P1–P6
- Court rotation + auto side-out rotate when we earn serve
- Flow-aware next-action suggestions (player + action; set outcome not graded in/out)
- Scrub video; mark events at the playhead
- Verified event log with edit / delete
- Persist session in `localStorage`; export / import JSON

## Action → outcome grid (v2.1)

Machine-readable source of truth: [`data/action-outcome-grid.yaml`](data/action-outcome-grid.yaml). Explainer: [`docs/action-outcome-grid.md`](docs/action-outcome-grid.md). Flow: [`docs/scouting-flow.md`](docs/scouting-flow.md).

Actions: serve, reception, dig, set (`set`|`error` only), attack, dump, block, freeball_send. Pass quality lives on reception/dig; setter analytics are derived later.

## Event schema (v1)

```ts
{
  id: string
  playerId: string
  action: string   // grid action id
  outcome: string  // grid outcome id for that action
  t: number        // seconds
  source: "human"  // reserved: "ai" for later
  status: "accepted" // reserved: "proposed" | "accepted" | "rejected"
}
```

AI proposal UI is intentionally out of scope for this mask vertical slice.

## License

MIT
