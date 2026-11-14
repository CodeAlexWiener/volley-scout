import { BACK_ROW, FRONT_ROW, RALLY_POINT_ACTION, TEAM_ACTION } from './types'
import type {
  CourtPosition,
  MatchState,
  PlayerRole,
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

/**
 * Preferred hitter role for each front-row attack slot.
 * P4 = outside, P2 = opposite (outside ok), P3 = middle.
 */
export const ATTACK_SLOT_ROLES: Record<2 | 3 | 4, PlayerRole[]> = {
  4: ['outside'],
  2: ['opposite', 'outside'],
  3: ['middle'],
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

function findByRoles(roster: RosterPlayer[], roles: PlayerRole[]): string | null {
  for (const role of roles) {
    const hit = roster.find((p) => p.role === role)
    if (hit) return hit.id
  }
  return null
}

/**
 * Prefer back-row outside (common primary passer), else any back-row player.
 */
export function preferBackRowReceiver(
  roster: RosterPlayer[],
  positions: Partial<Record<CourtPosition, string>>,
): string | null {
  const back = playersInRow(positions, 'back')
  const byId = new Map(roster.map((p) => [p.id, p]))
  const outsideBack = back.find((id) => byId.get(id)?.role === 'outside')
  if (outsideBack) return outsideBack
  if (back[0]) return back[0]
  return findByRoles(roster, ['outside']) ?? roster[0]?.id ?? null
}

/** Prefer middle blocker in front row, else any front-row player. */
export function preferFrontRowBlocker(
  roster: RosterPlayer[],
  positions: Partial<Record<CourtPosition, string>>,
): string | null {
  const front = playersInRow(positions, 'front')
  const byId = new Map(roster.map((p) => [p.id, p]))
  const middle = front.find((id) => byId.get(id)?.role === 'middle')
  if (middle) return middle
  if (front[0]) return front[0]
  return findByRoles(roster, ['middle', 'outside', 'opposite']) ?? roster[0]?.id ?? null
}

/**
 * Prefer front-row hitters by slot: P4 outside → P2 opposite/outside → P3 middle.
 * Occupant of the slot wins (skip setter if another front hitter exists); else role fallback.
 */
export function preferFrontRowHitter(
  roster: RosterPlayer[],
  positions: Partial<Record<CourtPosition, string>>,
): string | null {
  const byId = new Map(roster.map((p) => [p.id, p]))
  for (const pos of [4, 2, 3] as const) {
    const id = positions[pos]
    if (!id) continue
    if (byId.get(id)?.role !== 'setter') return id
  }
  for (const pos of [4, 2, 3] as const) {
    const id = positions[pos]
    if (id) return id
  }
  return (
    findByRoles(roster, ['outside', 'opposite', 'middle']) ?? roster[0]?.id ?? null
  )
}

export type ServePossessionChange =
  | { kind: 'we_keep_serve' }
  | { kind: 'we_gain_serve' }
  | { kind: 'they_gain_serve' }
  | { kind: 'they_keep_serve' }
  | { kind: 'rally_continues' }
  /** Rally decided without a point (referee replay): same server, no score change. */
  | { kind: 'replay' }

/** Who won the point, if this event decides the rally. */
export function pointWinner(action: string, outcome: string, detail?: string): 'us' | 'them' | 'replay' | null {
  switch (action) {
    case 'serve':
      return outcome === 'ace' ? 'us' : outcome === 'error' ? 'them' : null
    case 'reception':
    case 'dig':
    case 'freeball_send':
    case 'second_touch':
      return outcome === 'error' ? 'them' : null
    case 'attack':
      if (outcome === 'kill') return 'us'
      if (outcome === 'error') return 'them'
      if (outcome === 'blocked') return detail === 'stuffed' ? 'them' : null
      return null
    case 'block':
      if (outcome === 'kill_block') return 'us'
      if (outcome === 'tooled' || outcome === 'block_error') return 'them'
      return null
    case 'opponent_error':
      return 'us'
    case TEAM_ACTION:
      if (outcome === 'replay') return 'replay'
      return outcome === 'down' || outcome === 'fault' ? 'them' : null
    case RALLY_POINT_ACTION:
      return outcome === 'us' ? 'us' : outcome === 'them' ? 'them' : null
    default:
      return null
  }
}

/**
 * How serve possession and score change after one of our logged events.
 * Never models opponent touches — only our logged outcomes.
 */
export function possessionAfterEvent(
  action: string,
  outcome: string,
  servingTeam: ServingTeam,
  detail?: string,
): ServePossessionChange {
  const winner = pointWinner(action, outcome, detail)
  if (winner === null) return { kind: 'rally_continues' }
  if (winner === 'replay') return { kind: 'replay' }
  if (winner === 'us') return servingTeam === 'us' ? { kind: 'we_keep_serve' } : { kind: 'we_gain_serve' }
  return servingTeam === 'us' ? { kind: 'they_gain_serve' } : { kind: 'they_keep_serve' }
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
    case 'replay':
      return match
  }
}

/** Points needed to win a set: 25, and 15 in the deciding third set. */
export function setTarget(setNumber: number): number {
  return setNumber >= 3 ? 15 : 25
}

/** A set is over at the target score with a two-point lead. */
export function isSetOver(match: Pick<MatchState, 'scoreUs' | 'scoreThem'>, setNumber: number): boolean {
  const target = setTarget(setNumber)
  const high = Math.max(match.scoreUs, match.scoreThem)
  return high >= target && Math.abs(match.scoreUs - match.scoreThem) >= 2
}
