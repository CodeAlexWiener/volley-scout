import { defaultSession, emptyMatchFields } from './defaultRoster'
import { emptyMatchState, positionsFromRoster } from './rotation'
import type {
  CourtPosition,
  CutState,
  MatchSession,
  MatchState,
  MatchWindow,
  PlayerRole,
  Rally,
  RosterPlayer,
  ScoutEvent,
  Span,
} from './types'
import { LEGACY_ROLE_MAP } from './types'

const STORAGE_KEY = 'volley-scout:session:v2'
const LEGACY_STORAGE_KEY = 'volley-scout:session:v1'

const ROLES = new Set<PlayerRole>(['setter', 'outside', 'opposite', 'middle'])

function isCourtPosition(n: unknown): n is CourtPosition {
  return n === 1 || n === 2 || n === 3 || n === 4 || n === 5 || n === 6
}

function normalizeRole(raw: unknown): PlayerRole | undefined {
  if (typeof raw !== 'string') return undefined
  const mapped = LEGACY_ROLE_MAP[raw] ?? (ROLES.has(raw as PlayerRole) ? (raw as PlayerRole) : undefined)
  return mapped && ROLES.has(mapped) ? mapped : undefined
}

function normalizePlayer(raw: Partial<RosterPlayer> & { id: string; name: string }): RosterPlayer {
  const role = normalizeRole(raw.role)
  const startingPosition = isCourtPosition(raw.startingPosition)
    ? raw.startingPosition
    : undefined
  return {
    id: raw.id,
    name: raw.name,
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

function finite(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

function normalizeSpan(raw: unknown): Span | null {
  if (!raw || typeof raw !== 'object') return null
  const start = finite((raw as Span).start)
  const end = finite((raw as Span).end)
  return start !== null && end !== null && end > start ? { start, end } : null
}

function normalizeRally(raw: unknown): Rally | null {
  const span = normalizeSpan(raw)
  if (!span) return null
  const r = raw as Partial<Rally>
  return {
    ...span,
    id: typeof r.id === 'string' ? r.id : newId('ra'),
    source: r.source === 'human' ? 'human' : 'ai',
  }
}

function normalizeWindow(raw: unknown): MatchWindow {
  if (!raw || typeof raw !== 'object') return { start: null, end: null }
  return { start: finite((raw as MatchWindow).start), end: finite((raw as MatchWindow).end) }
}

function normalizeCut(raw: unknown): CutState | null {
  if (!raw || typeof raw !== 'object') return null
  const c = raw as Partial<CutState>
  if (typeof c.jobId !== 'string') return null
  const status = c.status === 'done' || c.status === 'failed' || c.status === 'cancelled' ? c.status : 'running'
  return {
    jobId: c.jobId,
    status,
    model: typeof c.model === 'string' ? c.model : '',
    chunksTotal: finite(c.chunksTotal) ?? 0,
    chunksDone: finite(c.chunksDone) ?? 0,
    covered: Array.isArray(c.covered)
      ? c.covered.map(normalizeSpan).filter((s): s is Span => s !== null)
      : [],
    warnings: Array.isArray(c.warnings) ? c.warnings.filter((w): w is string => typeof w === 'string') : [],
    error: typeof c.error === 'string' ? c.error : undefined,
  }
}

function normalizeSession(parsed: Record<string, unknown>): MatchSession {
  const rosterRaw = Array.isArray(parsed.roster) ? parsed.roster : []
  const roster = rosterRaw
    .filter((p): p is Partial<RosterPlayer> & { id: string; name: string } =>
      Boolean(p && typeof p === 'object' && typeof (p as RosterPlayer).id === 'string' && typeof (p as RosterPlayer).name === 'string'),
    )
    .map(normalizePlayer)

  const empty = emptyMatchFields()
  return {
    version: 2,
    videoName: typeof parsed.videoName === 'string' ? parsed.videoName : null,
    videoKey: typeof parsed.videoKey === 'string' ? parsed.videoKey : null,
    matchWindow: normalizeWindow(parsed.matchWindow),
    rallies: Array.isArray(parsed.rallies)
      ? parsed.rallies.map(normalizeRally).filter((r): r is Rally => r !== null)
      : [],
    dismissedAi: Array.isArray(parsed.dismissedAi)
      ? parsed.dismissedAi.map(normalizeSpan).filter((r): r is Span => r !== null)
      : [],
    cut: normalizeCut(parsed.cut),
    skipDeadTime: typeof parsed.skipDeadTime === 'boolean' ? parsed.skipDeadTime : empty.skipDeadTime,
    roster,
    bindings: Array.isArray(parsed.bindings) ? (parsed.bindings as MatchSession['bindings']) : [],
    currentPlayerId: typeof parsed.currentPlayerId === 'string' ? parsed.currentPlayerId : null,
    events: Array.isArray(parsed.events) ? (parsed.events as ScoutEvent[]) : [],
    match: normalizeMatch(parsed.match as Partial<MatchState> | undefined, roster),
    updatedAt: new Date().toISOString(),
  }
}

/** Fresh session with default six + court positions filled. */
export function emptySession(): MatchSession {
  return defaultSession()
}

/**
 * Ensure a usable roster/court: empty → default six; missing positions → from startingPosition.
 * Persists when we rewrite so the next load is not empty again.
 */
function ensureDefaultRoster(session: MatchSession): MatchSession {
  if (session.roster.length === 0) {
    const defaults = defaultSession()
    saveSession(defaults)
    return defaults
  }

  const positionCount = Object.keys(session.match.positions).length
  if (positionCount === 0) {
    const fromStarting = positionsFromRoster(session.roster)
    if (Object.keys(fromStarting).length === 0) {
      const defaults = defaultSession()
      saveSession(defaults)
      return defaults
    }
    const next: MatchSession = {
      ...session,
      match: { ...session.match, positions: fromStarting },
      currentPlayerId: session.currentPlayerId ?? session.roster[0]?.id ?? null,
    }
    saveSession(next)
    return next
  }

  return session
}

export function loadSession(): MatchSession {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) {
      const defaults = defaultSession()
      saveSession(defaults)
      return defaults
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || !Array.isArray(parsed.roster) || !Array.isArray(parsed.events)) {
      const defaults = defaultSession()
      saveSession(defaults)
      return defaults
    }
    const session = ensureDefaultRoster(normalizeSession(parsed))
    if (!localStorage.getItem(STORAGE_KEY)) {
      saveSession(session)
    }
    return session
  } catch {
    const defaults = defaultSession()
    saveSession(defaults)
    return defaults
  }
}

export function saveSession(session: MatchSession): void {
  const next = { ...session, version: 2 as const, updatedAt: new Date().toISOString() }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
}

export function exportSessionJson(session: MatchSession): string {
  const cleaned: MatchSession = {
    ...session,
    version: 2,
    roster: session.roster.map(({ id, name, role, startingPosition }) => ({
      id,
      name,
      role,
      startingPosition,
    })),
    updatedAt: new Date().toISOString(),
  }
  return JSON.stringify(cleaned, null, 2)
}

export function parseImportedSession(text: string): MatchSession {
  const parsed = JSON.parse(text) as Record<string, unknown>
  if (!parsed || !Array.isArray(parsed.roster) || !Array.isArray(parsed.events)) {
    throw new Error('Invalid session JSON (expected roster + events)')
  }
  return ensureDefaultRoster(normalizeSession(parsed))
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`
}
