/** Roster entry shown in the mask UI. */
export type RosterPlayer = {
  id: string
  name: string
  number?: string
}

/**
 * Verified (or future AI-proposed) touch event.
 * v1 UI only creates source=human, status=accepted.
 * source=ai and status=proposed|rejected are reserved for a later plug-in.
 */
export type EventSource = 'human' | 'ai'
export type EventStatus = 'proposed' | 'accepted' | 'rejected'

export type ScoutEvent = {
  id: string
  playerId: string
  action: string
  outcome: string
  /** Timestamp in seconds on the video timeline. */
  t: number
  source: EventSource
  status: EventStatus
}

export type MatchSession = {
  version: 1
  videoName: string | null
  roster: RosterPlayer[]
  /** Optional soft→player binding for later CV tracks; v1 uses currentPlayerId. */
  bindings: TrackBinding[]
  currentPlayerId: string | null
  events: ScoutEvent[]
  updatedAt: string
}

export type TrackBinding = {
  trackId: string
  playerId: string
  tStart: number
  tEnd: number | null
}

export type GridOutcome = {
  id: string
  label: string
  note?: string
}

export type GridAction = {
  id: string
  label: string
  outcomes: GridOutcome[]
}

export type ActionOutcomeGrid = {
  version: number
  schema: string
  actions: GridAction[]
}
