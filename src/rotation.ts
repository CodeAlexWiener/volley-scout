import { BACK_ROW, FRONT_ROW } from './types'
import type {
  CourtPosition,
  MatchState,
  RosterPlayer,
  ServingTeam,
} from './types'

/** Clockwise side-out: P2→P1 (new server), P3→P2, …, P1→P6. */
const ROTATE_FROM: Record<CourtPosition, CourtPosition> = {
  1: 2,
  2: 3,
  3: 4,
  4: 5,
  5: 6,
  6: 1,
}

export function emptyMatchState(): MatchState {
  return {
    positions: {},
    servingTeam: 'us',
    scoreUs: 0,
    scoreThem: 0,
  }
}

/** Build positions from roster startingPosition fields (unique slots). */
export function positionsFromRoster(
  roster: RosterPlayer[],
): Partial<Record<CourtPosition, string>> {
  const positions: Partial<Record<CourtPosition, string>> = {}
  for (const player of roster) {
    if (player.startingPosition) {
      positions[player.startingPosition] = player.id
    }
  }
  return positions
}

export function rotateClockwise(
  positions: Partial<Record<CourtPosition, string>>,
): Partial<Record<CourtPosition, string>> {
  const next: Partial<Record<CourtPosition, string>> = {}
  for (const pos of [1, 2, 3, 4, 5, 6] as CourtPosition[]) {
    const from = ROTATE_FROM[pos]
    const playerId = positions[from]
    if (playerId) next[pos] = playerId
  }
  return next
}

export function playerAt(
  positions: Partial<Record<CourtPosition, string>>,
  pos: CourtPosition,
): string | undefined {
  return positions[pos]
}

export function positionOf(
  positions: Partial<Record<CourtPosition, string>>,
  playerId: string,
): CourtPosition | null {
  for (const pos of [1, 2, 3, 4, 5, 6] as CourtPosition[]) {
    if (positions[pos] === playerId) return pos
  }
  return null
}

export function playersInRow(
  positions: Partial<Record<CourtPosition, string>>,
  row: 'front' | 'back',
): string[] {
  const slots = row === 'front' ? FRONT_ROW : BACK_ROW
  return slots.map((p) => positions[p]).filter((id): id is string => Boolean(id))
}

export function findSetterId(roster: RosterPlayer[]): string | null {
  return roster.find((p) => p.role === 'setter')?.id ?? null
}

export function findLauferId(roster: RosterPlayer[]): string | null {
  return roster.find((p) => p.role === 'läufer')?.id ?? null
}

/**
 * Prefer Läufer if they are (or would be) back-row; else first back-row player;
 * else any roster player.
 */
export function preferBackRowReceiver(
  roster: RosterPlayer[],
  positions: Partial<Record<CourtPosition, string>>,
): string | null {
  const back = playersInRow(positions, 'back')
  const laufer = findLauferId(roster)
  if (laufer && (back.includes(laufer) || back.length === 0)) return laufer
  if (back[0]) return back[0]
  return roster[0]?.id ?? null
}

export function preferFrontRowBlocker(
  roster: RosterPlayer[],
  positions: Partial<Record<CourtPosition, string>>,
): string | null {
  const front = playersInRow(positions, 'front')
  if (front[0]) return front[0]
  const hitter = roster.find((p) => p.role === 'hitter')
  return hitter?.id ?? roster[0]?.id ?? null
}

/** Prefer outside (P4), then opposite (P2), then middle (P3). */
export function preferFrontRowHitter(
  roster: RosterPlayer[],
  positions: Partial<Record<CourtPosition, string>>,
): string | null {
  for (const pos of [4, 2, 3] as CourtPosition[]) {
    const id = positions[pos]
    if (id) return id
  }
  const hitter = roster.find((p) => p.role === 'hitter')
  return hitter?.id ?? roster[0]?.id ?? null
}

export type ServePossessionChange =
  | { kind: 'we_keep_serve' }
  | { kind: 'we_gain_serve' }
  | { kind: 'they_gain_serve' }
  | { kind: 'they_keep_serve' }
  | { kind: 'rally_continues' }

/**
 * Infer how serve possession / score should change from an own-side event.
 * Never models opponent touches — only our logged outcomes.
 */
export function possessionAfterEvent(
  action: string,
  outcome: string,
  servingTeam: ServingTeam,
): ServePossessionChange {
  if (action === 'serve') {
    if (outcome === 'ace') return { kind: 'we_keep_serve' }
    if (outcome === 'serve_error') return { kind: 'they_gain_serve' }
    return { kind: 'rally_continues' }
  }

  if (action === 'reception' || action === 'dig') {
    if (outcome === 'error') {
      return servingTeam === 'us' ? { kind: 'they_gain_serve' } : { kind: 'they_keep_serve' }
    }
    return { kind: 'rally_continues' }
  }

  if (action === 'set') {
    if (outcome === 'error') {
      return servingTeam === 'us' ? { kind: 'they_gain_serve' } : { kind: 'they_keep_serve' }
    }
    return { kind: 'rally_continues' }
  }

  if (action === 'attack' || action === 'dump') {
    const weScore =
      (action === 'attack' && outcome === 'kill') ||
      (action === 'dump' && outcome === 'point')
    if (weScore) {
      return servingTeam === 'us' ? { kind: 'we_keep_serve' } : { kind: 'we_gain_serve' }
    }
    if (
      outcome === 'error_own' ||
      outcome === 'error_bad_set' ||
      outcome === 'blocked'
    ) {
      // blocked ends our attack attempt; treat as point against when stuff,
      // but "blocked" in grid can also mean channelled — spec: suggest cover dig,
      // so rally continues for blocked. Only errors end the point.
      if (outcome === 'blocked') return { kind: 'rally_continues' }
      return servingTeam === 'us' ? { kind: 'they_gain_serve' } : { kind: 'they_keep_serve' }
    }
    return { kind: 'rally_continues' }
  }

  if (action === 'block') {
    if (outcome === 'kill_block') {
      return servingTeam === 'us' ? { kind: 'we_keep_serve' } : { kind: 'we_gain_serve' }
    }
    if (outcome === 'block_error') {
      return servingTeam === 'us' ? { kind: 'they_gain_serve' } : { kind: 'they_keep_serve' }
    }
    return { kind: 'rally_continues' }
  }

  if (action === 'freeball_send') {
    if (outcome === 'error') {
      return servingTeam === 'us' ? { kind: 'they_gain_serve' } : { kind: 'they_keep_serve' }
    }
    return { kind: 'rally_continues' }
  }

  return { kind: 'rally_continues' }
}

/** Apply possession change: rotate on side-out, bump optional score. */
export function applyPossessionChange(
  match: MatchState,
  change: ServePossessionChange,
): MatchState {
  switch (change.kind) {
    case 'we_keep_serve':
      return {
        ...match,
        servingTeam: 'us',
        scoreUs: match.scoreUs + 1,
      }
    case 'we_gain_serve':
      return {
        ...match,
        servingTeam: 'us',
        positions: rotateClockwise(match.positions),
        scoreUs: match.scoreUs + 1,
      }
    case 'they_gain_serve':
      return {
        ...match,
        servingTeam: 'them',
        scoreThem: match.scoreThem + 1,
      }
    case 'they_keep_serve':
      return {
        ...match,
        servingTeam: 'them',
        scoreThem: match.scoreThem + 1,
      }
    case 'rally_continues':
      return match
  }
}
