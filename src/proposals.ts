import { ACTION_OUTCOME_GRID } from './data/grid'
import type { GameWindow, RosterPlayer } from './types'
import { isOpponentPlayerId, OPPONENT_PLAYER_ID } from './types'

export type ActionProposal = {
  id: string
  t: number
  playerName: string
  playerId: string | null
  action: string
  outcome: string
  note: string
  status: 'proposed' | 'accepted' | 'rejected'
}

export type ProposalParse = {
  proposals: ActionProposal[]
  errors: string[]
}

function newProposalId(): string {
  return `pr_${crypto.randomUUID().slice(0, 8)}`
}

function outcomeAllowed(actionId: string, outcomeId: string): boolean {
  const action = ACTION_OUTCOME_GRID.actions.find((item) => item.id === actionId)
  return Boolean(action?.outcomes.some((outcome) => outcome.id === outcomeId))
}

/**
 * LLM output must name a roster player (or Opponent) and an action/outcome
 * that exists on the scout grid. Anything else is rejected and not stored.
 */
export function parseProposalFile(text: string, roster: RosterPlayer[]): ProposalParse {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { proposals: [], errors: ['File is not JSON.'] }
  }
  const rawList = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { proposals?: unknown }).proposals)
      ? (parsed as { proposals: unknown[] }).proposals
      : null
  if (!rawList) {
    return { proposals: [], errors: ['Expected { "proposals": [ ... ] }.'] }
  }

  const proposals: ActionProposal[] = []
  const errors: string[] = []
  rawList.forEach((raw, index) => {
    const row = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
    const where = `Proposal ${index + 1}`
    if (!row) {
      errors.push(`${where} is not an object.`)
      return
    }
    const t = typeof row.t === 'number' ? row.t : Number(row.t)
    const playerName = typeof row.player === 'string' ? row.player.trim() : ''
    const action = typeof row.action === 'string' ? row.action.trim() : ''
    const outcome = typeof row.outcome === 'string' ? row.outcome.trim() : ''
    const note = typeof row.note === 'string' ? row.note.trim() : ''
    if (!Number.isFinite(t) || t < 0) {
      errors.push(`${where} needs a time "t" in seconds.`)
      return
    }
    if (!action || !outcomeAllowed(action, outcome)) {
      errors.push(`${where} action/outcome is not on the scout grid (${action || '∅'} / ${outcome || '∅'}).`)
      return
    }
    const opponent = action === 'opponent_error'
    const player = opponent
      ? roster.find((item) => isOpponentPlayerId(item.id))
      : roster.find((item) => item.name.toLowerCase() === playerName.toLowerCase())
    if (!opponent && !player) {
      errors.push(`${where} player "${playerName || '∅'}" is not on the roster.`)
      return
    }
    proposals.push({
      id: newProposalId(),
      t,
      playerName: opponent ? 'Opponent' : playerName,
      playerId: opponent ? OPPONENT_PLAYER_ID : (player?.id ?? null),
      action,
      outcome,
      note,
      status: 'proposed',
    })
  })
  return { proposals, errors }
}

/** Instructions a video model must follow. The grid is the only legal vocabulary. */
export function understandingPrompt(roster: RosterPlayer[], gameWindow: GameWindow): string {
  const names = roster.map((player) => player.name).join(', ')
  const actions = ACTION_OUTCOME_GRID.actions
    .map((action) => {
      const outcomes = action.outcomes.map((outcome) => outcome.id).join(' | ')
      return `- ${action.id}: ${outcomes}${action.note ? ` — ${action.note}` : ''}`
    })
    .join('\n')
  const start = gameWindow.start ?? 0
  const end = gameWindow.end == null ? 'end of file' : `${gameWindow.end}`
  return [
    'You label one volleyball clip. Answer with JSON only.',
    'Own side only. Do not invent actions or outcomes.',
    `Roster: ${names}. Use "Opponent" only for opponent_error.`,
    `Only label between ${start}s and ${end}.`,
    'Pass quality (in_system / out_of_system) is a judgment. If you are unsure, omit the touch.',
    '',
    'Return:',
    '{ "proposals": [ { "t": <seconds>, "player": "<roster name>", "action": "<id>", "outcome": "<id>", "note": "" } ] }',
    '',
    'Legal action → outcome ids:',
    actions,
  ].join('\n')
}
