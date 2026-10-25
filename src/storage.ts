import type { MatchSession, ScoutEvent, RosterPlayer } from './types'

const STORAGE_KEY = 'volley-scout:session:v1'

export function emptySession(): MatchSession {
  return {
    version: 1,
    videoName: null,
    roster: [],
    bindings: [],
    currentPlayerId: null,
    events: [],
    updatedAt: new Date().toISOString(),
  }
}

export function loadSession(): MatchSession {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptySession()
    const parsed = JSON.parse(raw) as MatchSession
    if (parsed?.version !== 1 || !Array.isArray(parsed.roster) || !Array.isArray(parsed.events)) {
      return emptySession()
    }
    return parsed
  } catch {
    return emptySession()
  }
}

export function saveSession(session: MatchSession): void {
  const next = { ...session, updatedAt: new Date().toISOString() }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
}

export function exportSessionJson(session: MatchSession): string {
  return JSON.stringify({ ...session, updatedAt: new Date().toISOString() }, null, 2)
}

export function parseImportedSession(text: string): MatchSession {
  const parsed = JSON.parse(text) as MatchSession
  if (parsed?.version !== 1 || !Array.isArray(parsed.roster) || !Array.isArray(parsed.events)) {
    throw new Error('Invalid session JSON (expected version 1 with roster + events)')
  }
  return {
    version: 1,
    videoName: parsed.videoName ?? null,
    roster: parsed.roster as RosterPlayer[],
    bindings: Array.isArray(parsed.bindings) ? parsed.bindings : [],
    currentPlayerId: parsed.currentPlayerId ?? null,
    events: parsed.events as ScoutEvent[],
    updatedAt: new Date().toISOString(),
  }
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`
}
