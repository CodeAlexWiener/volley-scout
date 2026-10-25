# volley-scout

Local-first **manual video scout mask** for volleyball. Load a match video in the browser, bind on-screen players to a roster, and log `player → action → outcome` events at the current timestamp. No AI or computer vision in v1 — every event is human-entered and verified.

## Quick start

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). Pick a local video file, add roster players, select a current player, choose action + outcome from the grid, and mark the event.

## What v1 does

- Load a local video (file picker; nothing uploaded to a server)
- Manage a simple roster (name + optional jersey number)
- Assign a “current” roster player for the next touch
- Scrub video; mark events at the playhead
- Verified event log with edit / delete
- Persist session in `localStorage`; export / import JSON

## Action → outcome grid

Machine-readable source of truth: [`data/action-outcome-grid.yaml`](data/action-outcome-grid.yaml). Explainer: [`docs/action-outcome-grid.md`](docs/action-outcome-grid.md).

Starter actions: serve, reception, set, attack, block, dig, freeball — each with a fixed set of outcomes.

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
