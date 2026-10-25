import { emptyMatchState, positionsFromRoster } from './rotation'
import type {
  CourtPosition,
  MatchSession,
  MatchState,
  PlayerRole,
  RosterPlayer,
  ScoutEvent,
} from './types'

const STORAGE_KEY = 'volley-scout:session:v2'
const LEGACY_STORAGE_KEY = 'volley-scout:session:v1'

const ROLES = new Set<PlayerRole>(['setter', 'läufer', 'hitter', 'other'])

function isCourtPosition(n: unknown): n is CourtPosition {
  return n === 1 || n === 2 || n === 3 || n === 4 || n === 5 || n === 6
}

function normalizePlayer(raw: Partial<RosterPlayer> & { id: string; name: string }): RosterPlayer {
  const role = raw.role && ROLES.has(raw.role) ? raw.role : undefined
  const startingPosition = isCourtPosition(raw.startingPosition)
    ? raw.startingPosition
    : undefined
  return {
    id: raw.id,
    name: raw.name,
    number: raw.number,
    role,
    startingPosition,
  }
}

function normalizeMatch(raw: Partial<MatchState> | undefined, roster: RosterPlayer[]): MatchState {
  const base = emptyMatchState()
  if (!raw || typeof raw !== 'object') {
    return { ...base, positions: positionsFromRoster(roster) }
  }
  const positions: Partial<Record<CourtPosition, string>> = {}
  if (raw.positions && typeof raw.positions === 'object') {
    for (const [k, v] of Object.entries(raw.positions)) {
      const pos = Number(k)
      if (isCourtPosition(pos) && typeof v === 'string') positions[pos] = v
    }
  }
  if (Object.keys(positions).length === 0) {
    Object.assign(positions, positionsFromRoster(roster))
  }
  return {
    positions,
    servingTeam: raw.servingTeam === 'them' ? 'them' : 'us',
    scoreUs: typeof raw.scoreUs === 'number' ? raw.scoreUs : 0,
    scoreThem: typeof raw.scoreThem === 'number' ? raw.scoreThem : 0,
  }
}

function normalizeSession(parsed: Record<string, unknown>): MatchSession {
  const rosterRaw = Array.isArray(parsed.roster) ? parsed.roster : []
  const roster = rosterRaw
    .filter((p): p is Partial<RosterPlayer> & { id: string; name: string } =>
      Boolean(p && typeof p === 'object' && typeof (p as RosterPlayer).id === 'string' && typeof (p as RosterPlayer).name === 'string'),
    )
    .map(normalizePlayer)

  return {
    version: 2,
    videoName: typeof parsed.videoName === 'string' ? parsed.videoName : null,
    roster,
    bindings: Array.isArray(parsed.bindings) ? (parsed.bindings as MatchSession['bindings']) : [],
    currentPlayerId: typeof parsed.currentPlayerId === 'string' ? parsed.currentPlayerId : null,
    events: Array.isArray(parsed.events) ? (parsed.events as ScoutEvent[]) : [],
    match: normalizeMatch(parsed.match as Partial<MatchState> | undefined, roster),
    updatedAt: new Date().toISOString(),
  }
}

export function emptySession(): MatchSession {
  return {
    version: 2,
    videoName: null,
    roster: [],
    bindings: [],
    currentPlayerId: null,
    events: [],
    match: emptyMatchState(),
    updatedAt: new Date().toISOString(),
  }
}

export function loadSession(): MatchSession {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return emptySession()
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || !Array.isArray(parsed.roster) || !Array.isArray(parsed.events)) {
      return emptySession()
    }
    const session = normalizeSession(parsed)
    // Migrate legacy key forward
    if (!localStorage.getItem(STORAGE_KEY)) {
      saveSession(session)
    }
    return session
  } catch {
    return emptySession()
  }
}

export function saveSession(session: MatchSession): void {
  const next = { ...session, version: 2 as const, updatedAt: new Date().toISOString() }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
}

export function exportSessionJson(session: MatchSession): string {
  return JSON.stringify({ ...session, version: 2, updatedAt: new Date().toISOString() }, null, 2)
}

export function parseImportedSession(text: string): MatchSession {
  const parsed = JSON.parse(text) as Record<string, unknown>
  if (!parsed || !Array.isArray(parsed.roster) || !Array.isArray(parsed.events)) {
    throw new Error('Invalid session JSON (expected roster + events)')
  }
  return normalizeSession(parsed)
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`
}
