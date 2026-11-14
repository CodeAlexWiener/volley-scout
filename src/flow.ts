/**
 * Two-step scout grid: which situation we are in, which choices it offers per
 * row (player / Opponent / Team), and which player is the likely next touch.
 * Vocabulary lives in data/grid.ts; scoring in rotation.ts.
 */

import { labelForDetail, labelForOutcome, ACTION_OUTCOME_GRID } from './data/grid'
import {
  playerAt,
  pointWinner,
  positionOf,
  preferBackRowReceiver,
  preferFrontRowHitter,
} from './rotation'
import type { CourtPosition, MatchState, RosterPlayer, ScoutEvent } from './types'
import { COURT_POSITIONS, RALLY_POINT_ACTION, SUBSTITUTION_ACTION, TEAM_ACTION } from './types'

export type Situation = 'serve' | 'reception' | 'second' | 'attack' | 'defense'

export const SITUATIONS: { id: Situation; label: string; hint: string }[] = [
  { id: 'serve', label: 'We serve', hint: 'Server in P1' },
  { id: 'reception', label: 'They serve', hint: 'Our pass' },
  { id: 'second', label: 'Second touch', hint: 'Set or play the 2nd ball' },
  { id: 'attack', label: 'Attack', hint: 'Third ball over the net' },
  { id: 'defense', label: 'Ball comes over', hint: 'Dig or block' },
]

export type RowKind = 'player' | 'opponent' | 'team'

/** Step 2 option: sets the outcome (dig/block) or a detail (kill → tip). */
export type StepTwo = { label: string; outcome?: string; detail?: string }

/** Step 1 option. With `next`, a second pick follows; its first entry is the Enter default. */
export type Choice = {
  key: string
  label: string
  action: string
  outcome?: string
  next?: StepTwo[]
}

function details(action: string, outcome: string): StepTwo[] | undefined {
  const o = ACTION_OUTCOME_GRID.actions.find((a) => a.id === action)?.outcomes.find((x) => x.id === outcome)
  return o?.details?.map((d) => ({ label: d.label, detail: d.id }))
}

function outcomesAsStepTwo(action: string): StepTwo[] {
  const a = ACTION_OUTCOME_GRID.actions.find((x) => x.id === action)
  return (a?.outcomes ?? []).map((o) => ({ label: o.label, outcome: o.id }))
}

function pick(action: string, outcome: string, label?: string): Choice {
  return {
    key: `${action}:${outcome}`,
    label: label ?? labelForOutcome(action, outcome),
    action,
    outcome,
    next: details(action, outcome),
  }
}

const FREEBALL: Choice = {
  key: 'freeball_send',
  label: 'Freeball',
  action: 'freeball_send',
  next: outcomesAsStepTwo('freeball_send'),
}

const PLAYER_CHOICES: Record<Situation, Choice[]> = {
  serve: [pick('serve', 'in_play'), pick('serve', 'ace'), pick('serve', 'error')],
  reception: [
    pick('reception', 'in_system'),
    pick('reception', 'out_of_system'),
    pick('reception', 'overpass'),
    pick('reception', 'error'),
  ],
  second: [
    pick('second_touch', 'set'),
    pick('second_touch', 'save'),
    pick('second_touch', 'attack_on_2'),
    pick('second_touch', 'error'),
    FREEBALL,
  ],
  attack: [
    pick('attack', 'kill'),
    pick('attack', 'defended'),
    pick('attack', 'blocked'),
    pick('attack', 'error'),
    FREEBALL,
  ],
  defense: [
    { key: 'dig', label: 'Dig', action: 'dig', next: outcomesAsStepTwo('dig') },
    { key: 'block', label: 'Block', action: 'block', next: outcomesAsStepTwo('block') },
    FREEBALL,
  ],
}

function opponentChoices(situation: Situation): Choice[] {
  const list: Choice[] = []
  if (situation === 'reception') list.push(pick('opponent_error', 'serve_error'))
  if (situation === 'defense') list.push(pick('opponent_error', 'out'))
  list.push(pick('opponent_error', 'error'))
  return list
}

/** Replay is always last: furthest from the normal choices. */
const TEAM_CHOICES: Choice[] = [pick(TEAM_ACTION, 'down'), pick(TEAM_ACTION, 'fault'), pick(TEAM_ACTION, 'replay')]

export function choicesFor(situation: Situation, row: RowKind): Choice[] {
  if (row === 'opponent') return opponentChoices(situation)
  if (row === 'team') return TEAM_CHOICES
  return PLAYER_CHOICES[situation]
}

/** Events that say nothing about the ball (substitutions) do not drive the flow. */
export function lastBallEvent(events: ScoutEvent[]): ScoutEvent | null {
  const sorted = [...events].sort((a, b) => a.t - b.t)
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i]!.action !== SUBSTITUTION_ACTION) return sorted[i]!
  }
  return null
}

/** Where the rally goes after `last`; `match` is the state after it was applied. */
export function nextSituation(last: ScoutEvent | null, match: MatchState): Situation {
  const between = match.servingTeam === 'us' ? 'serve' : 'reception'
  if (!last) return between
  if (pointWinner(last.action, last.outcome, last.detail) !== null) return between
  const { action, outcome } = last
  if (action === RALLY_POINT_ACTION || action === TEAM_ACTION || action === 'opponent_error') return between
  if ((action === 'reception' || action === 'dig') && outcome !== 'overpass') return 'second'
  if (action === 'second_touch') return 'attack'
  // Serve in play, overpass, defended or covered attack, block touch, freeball: ball comes (back) over.
  return 'defense'
}

function onCourt(roster: RosterPlayer[], match: MatchState): RosterPlayer[] {
  const ids = new Set(COURT_POSITIONS.map((p) => match.positions[p]).filter(Boolean))
  return roster.filter((p) => ids.has(p.id))
}

/** Likely next player for the situation. */
export function defaultPlayer(
  situation: Situation,
  last: ScoutEvent | null,
  roster: RosterPlayer[],
  match: MatchState,
): string | null {
  const court = onCourt(roster, match)
  const fallback = court[0]?.id ?? null
  switch (situation) {
    case 'serve':
      return playerAt(match.positions, 1) ?? fallback
    case 'reception':
    case 'defense':
      return preferBackRowReceiver(court, match.positions) ?? fallback
    case 'second': {
      const setter = court.find((p) => p.role === 'setter')
      if (setter && setter.id !== last?.playerId) return setter.id
      // Setter took the first ball: the right-side front player usually sets.
      return playerAt(match.positions, 2 as CourtPosition) ?? fallback
    }
    case 'attack':
      if (last?.action === 'second_touch' && last.outcome === 'attack_on_2') return last.playerId
      return preferFrontRowHitter(court, match.positions) ?? fallback
  }
}

/** Grid rows: players on court (roster order, stable while rotating), then Opponent, then Team. */
export function gridPlayers(roster: RosterPlayer[], match: MatchState): RosterPlayer[] {
  return onCourt(roster, match).sort(
    (a, b) => roster.indexOf(a) - roster.indexOf(b) || (positionOf(match.positions, a.id) ?? 0) - (positionOf(match.positions, b.id) ?? 0),
  )
}

/** One-line description for the event log. */
export function describeEvent(event: ScoutEvent): string {
  const { action, outcome, detail } = event
  if (action === RALLY_POINT_ACTION) return outcome === 'us' ? 'Point us' : 'Point them'
  if (action === SUBSTITUTION_ACTION) return 'Sub in'
  const head = `${ACTION_OUTCOME_GRID.actions.find((a) => a.id === action)?.label ?? action} → ${labelForOutcome(action, outcome)}`
  return detail ? `${head} · ${labelForDetail(action, outcome, detail)}` : head
}
