/**
 * Roster roles (no Läufer / generic hitter).
 * Attack heuristics by front-row slot: P4 outside, P2 opposite (or outside), P3 middle.
 */
export type PlayerRole = 'setter' | 'outside' | 'opposite' | 'middle'

/** Standard court slots P1–P6. */
export type CourtPosition = 1 | 2 | 3 | 4 | 5 | 6

export type ServingTeam = 'us' | 'them'

/** Roster entry shown in the mask UI. */
export type RosterPlayer = {
  id: string
  name: string
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

/**
 * Sentinel for opponent_error events (no roster player).
 * Prefer {@link isOpponentPlayerId} / {@link OPPONENT_PLAYER} over comparing raw strings.
 */
export const OPPONENT_PLAYER_ID = '__opponent__'

export function isOpponentPlayerId(id: string | null | undefined): boolean {
  return id === OPPONENT_PLAYER_ID
}

/**
 * Sentinel for "point us / point them" markers, used when the deciding touch
 * is not something you track. Action is {@link RALLY_POINT_ACTION}.
 */
export const TEAM_PLAYER_ID = '__team__'
export const RALLY_POINT_ACTION = 'rally_point'

/** Synthetic grid / log person for opponent_error (not on the roster). */
export const OPPONENT_PLAYER: RosterPlayer = {
  id: OPPONENT_PLAYER_ID,
  name: 'Opponent',
}

export type ScoutEvent = {
  id: string
  /**
   * Roster player id, or {@link OPPONENT_PLAYER_ID} when action is `opponent_error`
   * (no our touch / no roster person).
   */
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

/** A span of the video file, in seconds. */
export type Span = { start: number; end: number }

/** One rally on the timeline. AI rallies become 'human' once you adjust them. */
export type Rally = Span & {
  id: string
  source: 'ai' | 'human'
}

/** Where the played match starts and ends inside the file. Null until marked. */
export type MatchWindow = {
  start: number | null
  end: number | null
}

/** Last known state of the rally cut job on the local server. */
export type CutState = {
  jobId: string
  status: 'running' | 'done' | 'failed' | 'cancelled'
  model: string
  chunksTotal: number
  chunksDone: number
  /** Parts of the match window the model has looked at; only these gaps are skipped. */
  covered: Span[]
  warnings: string[]
  error?: string
}

export type MatchSession = {
  version: 2
  videoName: string | null
  /** Local server id of this match: file name + size. Also the matches/<key>.json name. */
  videoKey: string | null
  matchWindow: MatchWindow
  rallies: Rally[]
  /** AI rallies you deleted; a still-running cut will not bring them back. */
  dismissedAi: Span[]
  cut: CutState | null
  /** Jump over dead time between rallies while playing. */
  skipDeadTime: boolean
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
  /** Grid revision, e.g. `"2.5"`. */
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
  { id: 'outside', label: 'Outside Hitter' },
  { id: 'opposite', label: 'Opposite' },
  { id: 'middle', label: 'Middle Blocker' },
]

/** Legacy role ids → current (import / localStorage migration). */
export const LEGACY_ROLE_MAP: Record<string, PlayerRole> = {
  läufer: 'outside',
  hitter: 'outside',
  other: 'outside',
  setter: 'setter',
  outside: 'outside',
  opposite: 'opposite',
  middle: 'middle',
}

export const COURT_POSITIONS: CourtPosition[] = [1, 2, 3, 4, 5, 6]
export const FRONT_ROW: CourtPosition[] = [2, 3, 4]
export const BACK_ROW: CourtPosition[] = [1, 5, 6]
