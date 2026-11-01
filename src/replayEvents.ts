import { ACTION_OUTCOME_GRID } from './data/grid'
import {
  applyPossessionChange,
  playerAt,
  positionOf,
  positionsFromRoster,
  possessionAfterEvent,
} from './rotation'
import type { MatchSession, MatchState, RosterPlayer, ScoutEvent } from './types'
import { FRONT_ROW, OPPONENT_PLAYER_ID } from './types'

/** Below this, the touch stays proposed with an explicit low-confidence note. */
export const LOW_CONFIDENCE = 0.55

export type ReplayTouch = {
  t: number
  player?: string
  number?: string
  action: string
  outcome: string
  confidence?: number
  evidence?: string
}

export type ReplayRally = {
  id: string
  start: number
  end: number
  touches: ReplayTouch[]
}

export type ReplayJob = {
  session: MatchSession
  rallies: ReplayRally[]
}

export type ReplayResult = {
  session: MatchSession
  match: MatchState
  warnings: string[]
}

function outcomeAllowed(action: string, outcome: string): boolean {
  const gridAction = ACTION_OUTCOME_GRID.actions.find((item) => item.id === action)
  return Boolean(gridAction?.outcomes.some((item) => item.id === outcome))
}

function jerseyKey(value: string | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim().replace(/^#/, '')
  if (!/^\d{1,2}$/.test(trimmed)) return null
  return String(Number(trimmed))
}

function findPlayer(roster: RosterPlayer[], touch: ReplayTouch): RosterPlayer | null {
  const num = jerseyKey(touch.number) ?? jerseyKey(touch.player)
  if (num) {
    const byNum = roster.find((player) => jerseyKey(player.number) === num)
    if (byNum) return byNum
  }
  const name = touch.player?.trim()
  if (!name) return null
  const lower = name.toLowerCase()
  return roster.find((player) => player.id === name || player.name.toLowerCase() === lower) ?? null
}

function noteFrom(parts: string[], evidence: string | undefined): string | undefined {
  const bits = parts.filter((part) => part.length > 0)
  const seen = evidence?.trim()
  if (seen) bits.push(seen)
  return bits.length > 0 ? bits.join(' — ') : undefined
}

function eventId(rallyId: string, index: number): string {
  return `ai_${rallyId}_${index}`
}

/**
 * Replay model touches through the same possession rules as the mask.
 * Reception versus dig is forced from the phase. Rotation, score, and
 * serving side come from possessionAfterEvent. Every kept touch is proposed.
 */
export function replayJob(job: ReplayJob): ReplayResult {
  const { session } = job
  const warnings: string[] = []
  const startPositions = positionsFromRoster(session.roster)
  let match: MatchState = {
    positions: Object.keys(startPositions).length > 0 ? { ...startPositions } : { ...session.match.positions },
    servingTeam: session.match.servingTeam === 'them' ? 'them' : 'us',
    scoreUs: Number.isFinite(session.match.scoreUs) ? session.match.scoreUs : 0,
    scoreThem: Number.isFinite(session.match.scoreThem) ? session.match.scoreThem : 0,
  }

  const rallies = [...job.rallies].sort((a, b) => a.start - b.start)
  const events: ScoutEvent[] = []

  for (const rally of rallies) {
    let expectingReception = match.servingTeam === 'them'
    let priorId: string | undefined
    const touches = [...rally.touches].sort((a, b) => a.t - b.t)
    touches.forEach((touch, index) => {
      const where = `${rally.id} touch ${index + 1}`
      if (!outcomeAllowed(touch.action, touch.outcome)) {
        warnings.push(`${where}: ${touch.action || '∅'}/${touch.outcome || '∅'} is not on the scout grid.`)
        return
      }
      if (!Number.isFinite(touch.t) || touch.t < 0) {
        warnings.push(`${where}: missing a file timestamp.`)
        return
      }

      const opponent = touch.action === 'opponent_error'
      const player = opponent ? null : findPlayer(session.roster, touch)
      if (!opponent && !player) {
        const label = touch.number || touch.player || '∅'
        warnings.push(`${where}: player "${label}" is not on the roster.`)
        return
      }

      let action = touch.action
      const reasons: string[] = []
      if (action === 'reception' || action === 'dig') {
        const forced = expectingReception ? 'reception' : 'dig'
        if (forced !== action) reasons.push(`${forced}, not ${action}`)
        action = forced
        expectingReception = false
      }

      const playerId = opponent ? OPPONENT_PLAYER_ID : player!.id
      if (action === 'serve') {
        const server = playerAt(match.positions, 1)
        if (server && playerId !== server) reasons.push('server is not P1')
      }
      if ((action === 'attack' || action === 'dump') && player) {
        const pos = positionOf(match.positions, player.id)
        if (pos && !FRONT_ROW.includes(pos)) reasons.push('back-row attack')
      }
      if (typeof touch.confidence !== 'number' || touch.confidence < LOW_CONFIDENCE) {
        reasons.push('low confidence')
      }

      const id = eventId(rally.id, index)
      const event: ScoutEvent = {
        id,
        playerId,
        action,
        outcome: touch.outcome,
        t: touch.t,
        source: 'ai',
        status: 'proposed',
        pointId: rally.id,
        priorEventId: priorId,
        note: noteFrom(reasons, touch.evidence),
      }
      events.push(event)
      priorId = id
      match = applyPossessionChange(match, possessionAfterEvent(action, touch.outcome, match.servingTeam))
    })
  }

  events.sort((a, b) => a.t - b.t)
  return {
    match,
    warnings,
    session: {
      ...session,
      version: 2,
      events,
      match,
      scoreboardBurnedIn: session.scoreboardBurnedIn === true,
      updatedAt: new Date().toISOString(),
    },
  }
}
