import { ACTION_OUTCOME_GRID } from './data/grid'
import {
  findSetterId,
  playerAt,
  playersInRow,
  preferBackRowReceiver,
  preferFrontRowBlocker,
  preferFrontRowHitter,
} from './rotation'
import { suggestNext } from './suggestions'
import type {
  FlowSuggestion,
  MatchState,
  RosterPlayer,
  ScoutEvent,
  SuggestionOption,
} from './types'
import { isOpponentPlayerId, OPPONENT_PLAYER } from './types'

export type GridColumn = {
  action: string
  outcome: string
  /** Short header for the matrix (outcome label, or action+outcome when mixed). */
  label: string
}

/**
 * One scout row: a player and a single action.
 * Outcomes stay hidden until that row is selected.
 */
export type ScoutChoice = {
  player: RosterPlayer
  action: string
  actionLabel: string
  outcomes: GridColumn[]
  primary: boolean
  suggestedOutcome: string | null
}

export type CandidateGrid = {
  players: RosterPlayer[]
  columns: GridColumn[]
  /** Player × action rows. Outcomes expand on the selected row. */
  choices: ScoutChoice[]
  /** Primary suggestion cell — default keyboard focus. */
  defaultFocus: { playerId: string; columnIndex: number } | null
  /** Flow reason from the primary suggestion (for UI hint). */
  reason: string | null
  suggestion: FlowSuggestion | null
}

function outcomeLabel(actionId: string, outcomeId: string): string {
  const action = ACTION_OUTCOME_GRID.actions.find((a) => a.id === actionId)
  return action?.outcomes.find((o) => o.id === outcomeId)?.label ?? outcomeId
}

function shortOutcomeLabel(actionId: string, outcomeId: string): string {
  const full = outcomeLabel(actionId, outcomeId)
  // Compact headers for common outcomes
  const map: Record<string, string> = {
    ace: 'Ace',
    in_play_in_system: 'InSys',
    in_play_out_of_system: 'OutSys',
    serve_error: 'Err',
    in_system: 'In sys',
    out_of_system: 'Out sys',
    overpass: 'Over',
    error: 'Error',
    set: 'Set',
    save: 'Save',
    kill: 'Kill',
    defended: 'Def',
    blocked: 'Blk',
    error_own: 'OwnErr',
    error_tried_save: 'TriedSave',
    error_bad_set: 'BadSet',
    point: 'Pt',
    kill_block: 'Kill',
    recycle: 'Recyc',
    block_error: 'Err',
    in_play: 'In',
    out: 'Out',
    net: 'Net',
    other: 'Other',
  }
  return map[outcomeId] ?? full
}

/** Opponent × opponent_error cells only; roster players never use opponent_error columns. */
export function isCellEnabled(playerId: string, column: GridColumn): boolean {
  const isOpp = isOpponentPlayerId(playerId)
  const isOppErr = column.action === 'opponent_error'
  return isOpp === isOppErr
}

function opponentErrorColumns(): GridColumn[] {
  return columnsForActions(['opponent_error'])
}

/** Always offer Opponent × opponent_error as an escape hatch on the matrix. */
function withOpponentEscapeHatch(
  players: RosterPlayer[],
  columns: GridColumn[],
): { players: RosterPlayer[]; columns: GridColumn[] } {
  const nextColumns = [...columns]
  for (const col of opponentErrorColumns()) {
    if (!nextColumns.some((c) => c.action === col.action && c.outcome === col.outcome)) {
      nextColumns.push(col)
    }
  }
  const nextPlayers = players.some((p) => isOpponentPlayerId(p.id))
    ? players
    : [...players, OPPONENT_PLAYER]
  return { players: nextPlayers, columns: nextColumns }
}

function columnsForActions(actionIds: string[]): GridColumn[] {
  const columns: GridColumn[] = []
  const unique = [...new Set(actionIds)]
  const multi = unique.length > 1
  for (const actionId of unique) {
    const action = ACTION_OUTCOME_GRID.actions.find((a) => a.id === actionId)
    if (!action) continue
    for (const outcome of action.outcomes) {
      const short = shortOutcomeLabel(actionId, outcome.id)
      columns.push({
        action: actionId,
        outcome: outcome.id,
        label: multi ? `${action.label.slice(0, 3)} ${short}` : short,
      })
    }
  }
  return columns
}

function onCourtPlayers(roster: RosterPlayer[], match: MatchState): RosterPlayer[] {
  const ids = new Set(
    ([1, 2, 3, 4, 5, 6] as const)
      .map((p) => match.positions[p])
      .filter((id): id is string => Boolean(id)),
  )
  if (ids.size === 0) return roster
  const ordered = roster.filter((p) => ids.has(p.id))
  return ordered.length > 0 ? ordered : roster
}

function playersForAction(
  action: string,
  roster: RosterPlayer[],
  match: MatchState,
  hintPlayerId: string | null,
): RosterPlayer[] {
  const byId = new Map(roster.map((p) => [p.id, p]))
  const pick = (id: string | null | undefined) => (id && byId.get(id) ? [byId.get(id)!] : [])
  const fromIds = (ids: string[]) =>
    ids.map((id) => byId.get(id)).filter((p): p is RosterPlayer => Boolean(p))

  if (action === 'serve') {
    const server = hintPlayerId ?? playerAt(match.positions, 1) ?? roster[0]?.id ?? null
    return pick(server)
  }

  if (action === 'reception') {
    const preferred = hintPlayerId ?? preferBackRowReceiver(roster, match.positions)
    const back = playersInRow(match.positions, 'back')
    const list = fromIds(back)
    if (preferred && byId.get(preferred) && !list.some((p) => p.id === preferred)) {
      list.unshift(byId.get(preferred)!)
    }
    return list.length > 0 ? list : onCourtPlayers(roster, match)
  }

  if (action === 'dig') {
    const preferred = hintPlayerId ?? preferBackRowReceiver(roster, match.positions)
    const back = playersInRow(match.positions, 'back')
    const list = fromIds(back)
    if (preferred && byId.get(preferred) && !list.some((p) => p.id === preferred)) {
      list.unshift(byId.get(preferred)!)
    }
    return list.length > 0 ? list : onCourtPlayers(roster, match)
  }

  if (action === 'block') {
    const preferred = hintPlayerId ?? preferFrontRowBlocker(roster, match.positions)
    const front = playersInRow(match.positions, 'front')
    const list = fromIds(front)
    if (preferred && byId.get(preferred) && !list.some((p) => p.id === preferred)) {
      list.unshift(byId.get(preferred)!)
    }
    return list.length > 0 ? list : onCourtPlayers(roster, match)
  }

  if (action === 'second_touch' || action === 'set') {
    // Unconstrained (null hint) → all on court; otherwise setter-first then others
    if (!hintPlayerId) return onCourtPlayers(roster, match)
    const setter = findSetterId(roster)
    const court = onCourtPlayers(roster, match)
    const ordered = [...court]
    const bump = (id: string | null) => {
      if (!id) return
      const idx = ordered.findIndex((p) => p.id === id)
      if (idx > 0) {
        const [p] = ordered.splice(idx, 1)
        ordered.unshift(p)
      }
    }
    bump(setter)
    bump(hintPlayerId)
    return ordered
  }

  if (action === 'attack') {
    const front = playersInRow(match.positions, 'front')
    const list = fromIds(front)
    const preferred = hintPlayerId ?? preferFrontRowHitter(roster, match.positions)
    if (preferred && byId.get(preferred)) {
      const idx = list.findIndex((p) => p.id === preferred)
      if (idx > 0) {
        const [p] = list.splice(idx, 1)
        list.unshift(p)
      } else if (idx < 0) list.unshift(byId.get(preferred)!)
    }
    return list.length > 0 ? list : onCourtPlayers(roster, match)
  }

  if (action === 'dump') {
    const setter = hintPlayerId ?? findSetterId(roster)
    const list = pick(setter)
    // Allow other on-court as alternates
    for (const p of onCourtPlayers(roster, match)) {
      if (!list.some((x) => x.id === p.id)) list.push(p)
    }
    return list.length > 0 ? list : onCourtPlayers(roster, match)
  }

  if (action === 'freeball_send') {
    if (hintPlayerId && byId.get(hintPlayerId)) {
      const rest = onCourtPlayers(roster, match).filter((p) => p.id !== hintPlayerId)
      return [byId.get(hintPlayerId)!, ...rest]
    }
    return onCourtPlayers(roster, match)
  }

  return onCourtPlayers(roster, match)
}

function mergePlayers(
  options: SuggestionOption[],
  roster: RosterPlayer[],
  match: MatchState,
): RosterPlayer[] {
  const seen = new Set<string>()
  const out: RosterPlayer[] = []
  const addAll = (list: RosterPlayer[]) => {
    for (const p of list) {
      if (seen.has(p.id)) continue
      seen.add(p.id)
      out.push(p)
    }
  }

  for (const opt of options) {
    addAll(playersForAction(opt.action, roster, match, opt.playerId))
  }

  // Primary player's action first — keep primary-suggested player at top
  const primaryId = options[0]?.playerId
  if (primaryId) {
    const idx = out.findIndex((p) => p.id === primaryId)
    if (idx > 0) {
      const [p] = out.splice(idx, 1)
      out.unshift(p)
    }
  }

  return out
}

function actionMeta(actionId: string): { label: string; outcomes: GridColumn[] } {
  const action = ACTION_OUTCOME_GRID.actions.find((a) => a.id === actionId)
  return {
    label: action?.label ?? actionId,
    outcomes: columnsForActions([actionId]),
  }
}

function opponentChoice(): ScoutChoice {
  return {
    player: OPPONENT_PLAYER,
    action: 'opponent_error',
    actionLabel: 'Error',
    outcomes: actionMeta('opponent_error').outcomes,
    primary: false,
    suggestedOutcome: null,
  }
}

/**
 * Group the matrix by touch: each row is one player + one action.
 * Players are only paired with actions they are actually candidates for
 * (server for serve, back row for dig, front row for block, …), not with
 * every outcome column. Opponent error stays one row of its own.
 */
function buildChoices(
  suggestion: FlowSuggestion,
  roster: RosterPlayer[],
  match: MatchState,
): ScoutChoice[] {
  const choices: ScoutChoice[] = []
  const seen = new Set<string>()
  const options = [suggestion.primary, ...suggestion.alternates]
  for (const option of options) {
    const meta = actionMeta(option.action)
    if (meta.outcomes.length === 0) continue
    const players = playersForAction(option.action, roster, match, option.playerId)
    for (const player of players) {
      if (isOpponentPlayerId(player.id)) continue
      const key = `${player.id}:${option.action}`
      if (seen.has(key)) continue
      seen.add(key)
      choices.push({
        player,
        action: option.action,
        actionLabel: meta.label,
        outcomes: meta.outcomes,
        primary: false,
        suggestedOutcome: null,
      })
    }
  }

  const primaryId = suggestion.primary.playerId
  for (const choice of choices) {
    if (choice.action !== suggestion.primary.action) continue
    if (primaryId && choice.player.id !== primaryId) continue
    choice.primary = true
    choice.suggestedOutcome = suggestion.primary.outcome
    break
  }
  if (!choices.some((choice) => choice.primary) && choices[0]) {
    choices[0].primary = true
    choices[0].suggestedOutcome = suggestion.primary.outcome
  }
  const primaryAt = choices.findIndex((choice) => choice.primary)
  if (primaryAt > 0) {
    const [choice] = choices.splice(primaryAt, 1)
    if (choice) choices.unshift(choice)
  }
  choices.push(opponentChoice())
  return choices
}

export function suggestedOutcomeIndex(choice: ScoutChoice): number {
  if (choice.outcomes.length === 0) return 0
  if (!choice.suggestedOutcome) return 0
  const index = choice.outcomes.findIndex((outcome) => outcome.outcome === choice.suggestedOutcome)
  return index >= 0 ? index : 0
}

function defaultColumnIndex(
  columns: GridColumn[],
  primary: SuggestionOption | undefined,
): number {
  if (!primary || columns.length === 0) return 0
  if (primary.outcome) {
    const exact = columns.findIndex(
      (c) => c.action === primary.action && c.outcome === primary.outcome,
    )
    if (exact >= 0) return exact
  }
  const firstOfAction = columns.findIndex((c) => c.action === primary.action)
  return firstOfAction >= 0 ? firstOfAction : 0
}

/**
 * Build the keyboard scout matrix: eligible players × legal (action, outcome) columns.
 * Flow suggestions decide which actions/players are offered; arrows pick among cells.
 */
export function getCandidateGrid(
  last: ScoutEvent | null,
  roster: RosterPlayer[],
  match: MatchState,
): CandidateGrid {
  const suggestion = suggestNext(last, roster, match)
  if (!suggestion || roster.length === 0) {
    // Still offer Opponent escape hatch when roster exists but suggestion is null
    if (roster.length > 0) {
      const { players, columns } = withOpponentEscapeHatch([], [])
      const choices = [opponentChoice()]
      return {
        players,
        columns,
        choices,
        defaultFocus: players[0]
          ? { playerId: players[0].id, columnIndex: 0 }
          : null,
        reason: 'Opponent error escape hatch',
        suggestion: null,
      }
    }
    return {
      players: [],
      columns: [],
      choices: [],
      defaultFocus: null,
      reason: null,
      suggestion: null,
    }
  }

  const options = [suggestion.primary, ...suggestion.alternates]
  const baseColumns = columnsForActions(options.map((o) => o.action))
  const basePlayers = mergePlayers(options, roster, match)
  const { players, columns } = withOpponentEscapeHatch(basePlayers, baseColumns)
  const choices = buildChoices(suggestion, roster, match)

  if (players.length === 0 || columns.length === 0) {
    return {
      players,
      columns,
      choices,
      defaultFocus: null,
      reason: suggestion.primary.reason,
      suggestion,
    }
  }

  const colIndex = defaultColumnIndex(columns, suggestion.primary)
  let focusPlayerId = suggestion.primary.playerId
  if (
    !focusPlayerId ||
    isOpponentPlayerId(focusPlayerId) ||
    !players.some((p) => p.id === focusPlayerId)
  ) {
    focusPlayerId =
      players.find((p) => !isOpponentPlayerId(p.id))?.id ?? players[0]?.id ?? null
  }

  return {
    players,
    columns,
    choices,
    defaultFocus:
      focusPlayerId != null
        ? { playerId: focusPlayerId, columnIndex: colIndex }
        : null,
    reason: suggestion.primary.reason,
    suggestion,
  }
}

export type FocusCell = {
  groupIndex: number
  outcomeIndex: number
}

/** Snap keyboard focus to the primary player + action, on its suggested outcome. */
export function resolveFocus(
  grid: CandidateGrid,
  _prev: FocusCell | null,
): FocusCell | null {
  if (grid.choices.length === 0) return null
  const found = grid.choices.findIndex((choice) => choice.primary)
  const groupIndex = found >= 0 ? found : 0
  const choice = grid.choices[groupIndex]
  if (!choice) return null
  return { groupIndex, outcomeIndex: suggestedOutcomeIndex(choice) }
}

/**
 * Up/down moves between player–action rows. Left/right moves among that row's outcomes.
 */
export function moveFocusSkippingDisabled(
  grid: CandidateGrid,
  from: FocusCell,
  dRow: number,
  dCol: number,
): FocusCell {
  const count = grid.choices.length
  if (count === 0) return from

  if (dRow !== 0) {
    const groupIndex = (from.groupIndex + dRow + count) % count
    const choice = grid.choices[groupIndex]
    if (!choice) return from
    return { groupIndex, outcomeIndex: suggestedOutcomeIndex(choice) }
  }

  const choice = grid.choices[from.groupIndex]
  if (!choice || choice.outcomes.length === 0) return from
  const len = choice.outcomes.length
  const outcomeIndex = (from.outcomeIndex + dCol + len) % len
  return { groupIndex: from.groupIndex, outcomeIndex }
}
