/** Optional role for suggestion heuristics. */
export type PlayerRole = 'setter' | 'läufer' | 'hitter' | 'other'

/** Standard court slots P1–P6. */
export type CourtPosition = 1 | 2 | 3 | 4 | 5 | 6

export type ServingTeam = 'us' | 'them'

/** Roster entry shown in the mask UI. */
export type RosterPlayer = {
  id: string
  name: string
  number?: string
  role?: PlayerRole
  /** Starting lineup slot (1–6). */
  startingPosition?: CourtPosition
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

/** Live rotation / serve possession (own side only). */
export type MatchState = {
  /** Position → playerId for who is currently in each slot. */
  positions: Partial<Record<CourtPosition, string>>
  servingTeam: ServingTeam
  /** Optional running score (own side bookkeeping only). */
  scoreUs: number
  scoreThem: number
}

export type MatchSession = {
  version: 2
  videoName: string | null
  roster: RosterPlayer[]
  /** Optional soft→player binding for later CV tracks; UI uses currentPlayerId. */
  bindings: TrackBinding[]
  currentPlayerId: string | null
  events: ScoutEvent[]
  match: MatchState
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
  note?: string
  outcomes: GridOutcome[]
}

export type ActionOutcomeGrid = {
  /** Grid revision, e.g. `"2.1"`. */
  version: number | string
  schema: string
  actions: GridAction[]
}

/** One suggested next entry for the mark form. */
export type SuggestionOption = {
  playerId: string | null
  action: string
  /** Prefill when known from flow; null means leave outcome for user. */
  outcome: string | null
  reason: string
}

export type FlowSuggestion = {
  primary: SuggestionOption
  alternates: SuggestionOption[]
}

export const PLAYER_ROLES: { id: PlayerRole; label: string }[] = [
  { id: 'setter', label: 'Setter' },
  { id: 'läufer', label: 'Läufer' },
  { id: 'hitter', label: 'Hitter' },
  { id: 'other', label: 'Other' },
]

export const COURT_POSITIONS: CourtPosition[] = [1, 2, 3, 4, 5, 6]
export const FRONT_ROW: CourtPosition[] = [2, 3, 4]
export const BACK_ROW: CourtPosition[] = [1, 5, 6]
