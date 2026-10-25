import type { ActionOutcomeGrid } from '../types'

/**
 * In-app copy of data/action-outcome-grid.yaml.
 * Keep in sync when editing the YAML source of truth.
 */
export const ACTION_OUTCOME_GRID: ActionOutcomeGrid = {
  version: 1,
  schema: 'action_outcome_grid',
  actions: [
    {
      id: 'serve',
      label: 'Serve',
      outcomes: [
        { id: 'ace', label: 'Ace' },
        { id: 'in_play', label: 'In play', note: 'Rally continues' },
        { id: 'serve_error', label: 'Serve error' },
      ],
    },
    {
      id: 'reception',
      label: 'Reception',
      outcomes: [
        { id: 'perfect', label: 'Perfect' },
        { id: 'good', label: 'Good' },
        { id: 'poor', label: 'Poor' },
        { id: 'error', label: 'Error' },
      ],
    },
    {
      id: 'set',
      label: 'Set',
      outcomes: [
        { id: 'set', label: 'Set' },
        { id: 'error', label: 'Error' },
      ],
    },
    {
      id: 'attack',
      label: 'Attack',
      outcomes: [
        { id: 'kill', label: 'Kill' },
        { id: 'defended', label: 'Defended' },
        { id: 'error', label: 'Error' },
        { id: 'blocked', label: 'Blocked' },
      ],
    },
    {
      id: 'block',
      label: 'Block',
      outcomes: [
        { id: 'kill_block', label: 'Kill block' },
        { id: 'recycle', label: 'Recycle' },
        { id: 'block_error', label: 'Block error' },
      ],
    },
    {
      id: 'dig',
      label: 'Dig',
      outcomes: [
        { id: 'dig', label: 'Dig' },
        { id: 'error', label: 'Error' },
      ],
    },
    {
      id: 'freeball',
      label: 'Freeball',
      outcomes: [
        { id: 'freeball', label: 'Freeball' },
        { id: 'error', label: 'Error' },
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
