import type { ActionOutcomeGrid } from '../types'

/**
 * In-app copy of data/action-outcome-grid.yaml (v3, two-step grid).
 * Step 1 picks an outcome (or, for dig/block, the action itself); step 2 picks a detail
 * or the outcome. Keep in sync when editing the YAML source of truth.
 */
export const ACTION_OUTCOME_GRID: ActionOutcomeGrid = {
  version: '3.0',
  schema: 'action_outcome_grid',
  actions: [
    {
      id: 'serve',
      label: 'Serve',
      outcomes: [
        {
          id: 'in_play',
          label: 'In play',
          details: [
            { id: 'in_system', label: 'Their pass in system' },
            { id: 'out_of_system', label: 'Their pass out of system' },
            { id: 'overpass', label: 'Their pass overpass' },
          ],
        },
        {
          id: 'ace',
          label: 'Ace',
          details: [
            { id: 'no_touch', label: 'No touch' },
            { id: 'touched', label: 'Touched' },
          ],
        },
        { id: 'error', label: 'Error' },
      ],
    },
    {
      id: 'reception',
      label: 'Reception',
      note: 'Only after an opponent serve',
      outcomes: [
        { id: 'in_system', label: 'In system' },
        { id: 'out_of_system', label: 'Out of system' },
        { id: 'overpass', label: 'Overpass' },
        { id: 'error', label: 'Error' },
      ],
    },
    {
      id: 'second_touch',
      label: 'Second touch',
      outcomes: [
        { id: 'set', label: 'Set' },
        { id: 'save', label: 'Save' },
        { id: 'attack_on_2', label: 'Attack on 2', note: 'Next entry is an attack by the same player' },
        {
          id: 'error',
          label: 'Error',
          details: [
            { id: 'lift_double', label: 'Lift / double' },
            { id: 'net', label: 'Net' },
            { id: 'failed_save', label: 'Failed save' },
          ],
        },
      ],
    },
    {
      id: 'attack',
      label: 'Attack',
      outcomes: [
        {
          id: 'kill',
          label: 'Kill',
          details: [
            { id: 'spike', label: 'Spike' },
            { id: 'tip_dump', label: 'Tip / dump' },
            { id: 'block_out', label: 'Block-out' },
          ],
        },
        { id: 'defended', label: 'Defended' },
        {
          id: 'blocked',
          label: 'Blocked',
          details: [
            { id: 'stuffed', label: 'Stuffed (point them)' },
            { id: 'covered', label: 'Covered (back to us)' },
          ],
        },
        {
          id: 'error',
          label: 'Error',
          details: [
            { id: 'out', label: 'Out' },
            { id: 'net', label: 'Net' },
            { id: 'bad_set', label: 'Bad set' },
            { id: 'violation', label: 'Violation' },
          ],
        },
      ],
    },
    {
      id: 'dig',
      label: 'Dig',
      note: 'Defense after their attack, freeball or overpass',
      outcomes: [
        { id: 'in_system', label: 'In system' },
        { id: 'out_of_system', label: 'Out of system' },
        { id: 'overpass', label: 'Overpass' },
        { id: 'error', label: 'Error' },
      ],
    },
    {
      id: 'block',
      label: 'Block',
      outcomes: [
        { id: 'kill_block', label: 'Kill block' },
        { id: 'soft_block', label: 'Soft block (our side)' },
        { id: 'touch', label: 'Touch (play on)' },
        { id: 'tooled', label: 'Tooled (point them)' },
        { id: 'block_error', label: 'Block error' },
      ],
    },
    {
      id: 'freeball_send',
      label: 'Freeball',
      outcomes: [
        { id: 'in_play', label: 'In play' },
        { id: 'error', label: 'Error' },
      ],
    },
    {
      id: 'opponent_error',
      label: 'Opponent',
      note: 'Opponent ends the rally with no deciding touch of ours',
      outcomes: [
        { id: 'serve_error', label: 'Serve error' },
        { id: 'out', label: 'Out' },
        { id: 'error', label: 'Error' },
      ],
    },
    {
      id: 'team',
      label: 'Team',
      note: 'Rally endings that belong to no single player',
      outcomes: [
        { id: 'down', label: 'Down', note: 'Their kill, nobody touched it' },
        { id: 'fault', label: 'Fault', note: 'Rotation, net, four hits, center line…' },
        { id: 'replay', label: 'Replay', note: 'No point, same server' },
      ],
    },
  ],
}

export function labelForAction(actionId: string): string {
  return ACTION_OUTCOME_GRID.actions.find((a) => a.id === actionId)?.label ?? actionId
}

export function labelForOutcome(actionId: string, outcomeId: string): string {
  const action = ACTION_OUTCOME_GRID.actions.find((a) => a.id === actionId)
  return action?.outcomes.find((o) => o.id === outcomeId)?.label ?? outcomeId
}

export function labelForDetail(actionId: string, outcomeId: string, detailId: string): string {
  const action = ACTION_OUTCOME_GRID.actions.find((a) => a.id === actionId)
  const outcome = action?.outcomes.find((o) => o.id === outcomeId)
  return outcome?.details?.find((d) => d.id === detailId)?.label ?? detailId
}
