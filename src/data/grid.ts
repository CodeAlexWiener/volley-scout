import type { ActionOutcomeGrid } from '../types'

/**
 * In-app copy of data/action-outcome-grid.yaml (v2.5).
 * Keep in sync when editing the YAML source of truth.
 */
export const ACTION_OUTCOME_GRID: ActionOutcomeGrid = {
  version: '2.5',
  schema: 'action_outcome_grid',
  actions: [
    {
      id: 'serve',
      label: 'Serve',
      outcomes: [
        { id: 'ace', label: 'Ace' },
        {
          id: 'in_play_in_system',
          label: 'In play — in system',
          note: 'Serve in; receiving team stays in system (easier). Next own touch dig/block',
        },
        {
          id: 'in_play_out_of_system',
          label: 'In play — out of system',
          note: 'Serve in; receiving team out of system (pressure). Next own touch dig/block',
        },
        { id: 'serve_error', label: 'Serve error' },
      ],
    },
    {
      id: 'reception',
      label: 'Reception',
      note: 'Only after opponent serve',
      outcomes: [
        { id: 'in_system', label: 'In system' },
        { id: 'out_of_system', label: 'Out of system' },
        { id: 'overpass', label: 'Overpass' },
        { id: 'error', label: 'Error' },
      ],
    },
    {
      id: 'dig',
      label: 'Dig',
      note: 'Defense after attack/freeball (not serve receive)',
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
      note: 'Second team contact after reception/dig. In/out of system comes from prior pass; quality from following attack. Direct faults use error_own / error_tried_save.',
      outcomes: [
        { id: 'set', label: 'Set', note: 'Intentional set to a hitter' },
        { id: 'save', label: 'Save', note: 'Emergency second touch to keep the ball playable' },
        {
          id: 'error_own',
          label: 'Error (own fault)',
          note: 'Second-touch fault ending the point (net, lift, out, etc.) — not a failed save attempt',
        },
        {
          id: 'error_tried_save',
          label: 'Error (tried save)',
          note: 'Tried an emergency save and the ball died / point ended',
        },
      ],
    },
    {
      id: 'attack',
      label: 'Attack',
      outcomes: [
        { id: 'kill', label: 'Kill' },
        { id: 'defended', label: 'Defended' },
        { id: 'blocked', label: 'Blocked' },
        { id: 'error_own', label: 'Error (own fault)' },
        { id: 'error_bad_set', label: 'Error (bad set)' },
      ],
    },
    {
      id: 'dump',
      label: 'Dump',
      note: 'Setter tip / dump',
      outcomes: [
        { id: 'point', label: 'Point' },
        { id: 'defended', label: 'Defended' },
        { id: 'blocked', label: 'Blocked' },
        { id: 'error_own', label: 'Error (own fault)' },
        { id: 'error_bad_set', label: 'Error (bad set)' },
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
      id: 'freeball_send',
      label: 'Freeball (send)',
      note: 'Receiving a freeball = dig',
      outcomes: [
        { id: 'in_play', label: 'In play' },
        { id: 'error', label: 'Error' },
      ],
    },
    {
      id: 'opponent_error',
      label: 'Opponent error',
      note: 'Opponent ends the rally with no logged our touch (e.g. they hit out). UI uses synthetic Opponent "person"; event has no roster playerId.',
      outcomes: [
        { id: 'out', label: 'Out', note: 'Ball out / into the outside' },
        { id: 'net', label: 'Net' },
        { id: 'other', label: 'Other', note: 'Other unforced opponent fault (catch, double, referee)' },
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
