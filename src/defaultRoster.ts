import type { MatchSession, RosterPlayer } from './types'
import { emptyMatchState, positionsFromRoster } from './rotation'

/**
 * Default starting six (fresh session / Clear).
 * Positions: P1 Peter MB, P2 Julia S, P3 Manu OH, P4 Alex MB, P5 Lucas OPP, P6 Kathi OH.
 */
export const DEFAULT_ROSTER: RosterPlayer[] = [
  { id: 'pl_peter', name: 'Peter', role: 'middle', startingPosition: 1 },
  { id: 'pl_julia', name: 'Julia', role: 'setter', startingPosition: 2 },
  { id: 'pl_manu', name: 'Manu', role: 'outside', startingPosition: 3 },
  { id: 'pl_alex', name: 'Alex', role: 'middle', startingPosition: 4 },
  { id: 'pl_lucas', name: 'Lucas', role: 'opposite', startingPosition: 5 },
  { id: 'pl_kathi', name: 'Kathi', role: 'outside', startingPosition: 6 },
]

export function defaultSession(): MatchSession {
  const roster = DEFAULT_ROSTER.map((p) => ({ ...p }))
  return {
    version: 2,
    videoName: null,
    roster,
    bindings: [],
    currentPlayerId: roster[0]?.id ?? null,
    events: [],
    match: {
      ...emptyMatchState(),
      positions: positionsFromRoster(roster),
      servingTeam: 'us',
    },
    updatedAt: new Date().toISOString(),
  }
}
