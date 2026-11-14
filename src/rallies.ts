import { pointWinner } from './rotation'
import { newId } from './storage'
import type { Rally, ScoutEvent, Span } from './types'

/** Events this close outside a rally still count as part of it (late keypress). */
const EVENT_SLACK_SEC = 1.5
/** A rally you add by hand in a gap starts this long. */
const NEW_RALLY_SEC = 12

export function sortRallies(rallies: Rally[]): Rally[] {
  return [...rallies].sort((a, b) => a.start - b.start)
}

export function rallyAt(rallies: Rally[], t: number): Rally | null {
  return rallies.find((r) => t >= r.start && t < r.end) ?? null
}

export function nextRallyAfter(rallies: Rally[], t: number): Rally | null {
  return sortRallies(rallies).find((r) => r.start > t) ?? null
}

export function previousRallyBefore(rallies: Rally[], t: number): Rally | null {
  return (
    sortRallies(rallies)
      .filter((r) => r.end <= t)
      .at(-1) ?? null
  )
}

export function isCovered(covered: Span[], t: number): boolean {
  return covered.some((span) => t >= span.start && t <= span.end)
}

/** Has the model looked at all of [from, to]? Only then is it safe to skip it. */
export function spanCovered(covered: Span[], from: number, to: number): boolean {
  return covered.some((span) => span.start <= from + 0.01 && span.end >= to - 0.01)
}

/** The gap (dead time) around `t`, bounded by neighbouring rallies and the window. */
export function gapAround(rallies: Rally[], t: number, bounds: Span): Span {
  const prev = previousRallyBefore(rallies, t)
  const next = nextRallyAfter(rallies, t)
  return { start: prev?.end ?? bounds.start, end: next?.start ?? bounds.end }
}

/**
 * The rally an entry at time t belongs to: the one containing t, else the nearest
 * one within EVENT_SLACK_SEC (a late keypress right after the ball died).
 */
export function rallyFor(rallies: Rally[], t: number): Rally | null {
  const inside = rallyAt(rallies, t)
  if (inside) return inside
  let best: Rally | null = null
  let bestDistance = EVENT_SLACK_SEC
  for (const r of rallies) {
    const distance = t < r.start ? r.start - t : t - r.end
    if (distance <= bestDistance) {
      best = r
      bestDistance = distance
    }
  }
  return best
}

export function rallyEvents(rally: Rally, events: ScoutEvent[], rallies: Rally[]): ScoutEvent[] {
  return events.filter((e) => rallyFor(rallies, e.t)?.id === rally.id)
}

/** Does the rally contain an entry that decides it (a point or a replay)? */
export function rallyDecided(rally: Rally, events: ScoutEvent[], rallies: Rally[]): boolean {
  return rallyEvents(rally, events, rallies).some((e) => pointWinner(e.action, e.outcome, e.detail) !== null)
}

function overlap(a: Span, b: Span): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))
}

/**
 * Fold the latest AI rally list into the session's rallies. Your own rallies
 * (added or adjusted) always win; AI rallies you deleted stay deleted.
 */
export function mergeAiRallies(current: Rally[], incoming: Span[], dismissed: Span[]): Rally[] {
  const human = current.filter((r) => r.source === 'human')
  const previousAi = current.filter((r) => r.source === 'ai')
  const kept = incoming.filter((span) => {
    const length = span.end - span.start
    if (human.some((h) => overlap(h, span) > 0)) return false
    if (dismissed.some((d) => overlap(d, span) > length * 0.5)) return false
    return true
  })
  const ai: Rally[] = kept.map((span) => {
    // Keep ids stable across polls so React rows and the current rally do not flicker.
    const same = previousAi.find((r) => overlap(r, span) > 0)
    return { id: same?.id ?? newId('ra'), start: span.start, end: span.end, source: 'ai' }
  })
  return sortRallies([...human, ...ai])
}

/** `[`: start the rally here. In dead time this adds a new rally. */
export function setRallyStart(rallies: Rally[], t: number, bounds: Span): Rally[] {
  const current = rallyAt(rallies, t)
  if (current) {
    return sortRallies(rallies.map((r) => (r.id === current.id ? { ...r, start: t, source: 'human' } : r)))
  }
  const next = nextRallyAfter(rallies, t)
  if (next && next.start - t < 3) {
    // Just before a rally: the rally started earlier than the AI thought.
    return sortRallies(rallies.map((r) => (r.id === next.id ? { ...r, start: t, source: 'human' } : r)))
  }
  const end = Math.min(t + NEW_RALLY_SEC, next?.start ?? bounds.end, bounds.end)
  if (end - t < 1) return rallies
  return sortRallies([...rallies, { id: newId('ra'), start: t, end, source: 'human' }])
}

/** `]`: the rally ends here. In dead time this stretches the previous rally. */
export function setRallyEnd(rallies: Rally[], t: number): Rally[] {
  const current = rallyAt(rallies, t)
  const target = current ?? previousRallyBefore(rallies, t)
  if (!target || t - target.start < 0.5) return rallies
  const next = nextRallyAfter(rallies, target.start)
  const end = next && next.id !== target.id ? Math.min(t, next.start) : t
  return rallies.map((r) => (r.id === target.id ? { ...r, end, source: 'human' } : r))
}

/** `K`: two rallies were merged into one; split at the playhead. */
export function splitRally(rallies: Rally[], t: number): Rally[] {
  const current = rallyAt(rallies, t)
  if (!current || t - current.start < 0.5 || current.end - t < 0.5) return rallies
  return sortRallies([
    ...rallies.filter((r) => r.id !== current.id),
    { ...current, end: t, source: 'human' },
    { id: newId('ra'), start: t, end: current.end, source: 'human' },
  ])
}

/** `X`: this was not a rally. Returns the new list and the span to remember as dismissed. */
export function removeRally(rallies: Rally[], t: number): { rallies: Rally[]; dismissed: Span | null } {
  const current = rallyAt(rallies, t)
  if (!current) return { rallies, dismissed: null }
  return {
    rallies: rallies.filter((r) => r.id !== current.id),
    dismissed: current.source === 'ai' ? { start: current.start, end: current.end } : null,
  }
}

/** `J`: the AI split one rally in two; join this rally (or the one just before) with the next. */
export function joinWithNext(rallies: Rally[], t: number): Rally[] {
  const current = rallyAt(rallies, t) ?? previousRallyBefore(rallies, t)
  if (!current) return rallies
  const next = nextRallyAfter(rallies, current.start)
  if (!next) return rallies
  return sortRallies([
    ...rallies.filter((r) => r.id !== current.id && r.id !== next.id),
    { id: current.id, start: current.start, end: Math.max(current.end, next.end), source: 'human' },
  ])
}
