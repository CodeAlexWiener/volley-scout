import type { ScoutEvent } from './types'

/**
 * Map events written with grid v2.x onto grid v3 ids, so old matches keep
 * scoring and showing correctly. Unknown or already-v3 events pass through.
 */
export function migrateLegacyEvent(event: ScoutEvent): ScoutEvent {
  const { action, outcome } = event
  const to = (next: Partial<ScoutEvent>): ScoutEvent => ({ ...event, ...next })

  if (action === 'serve') {
    if (outcome === 'in_play_in_system') return to({ outcome: 'in_play', detail: 'in_system' })
    if (outcome === 'in_play_out_of_system') return to({ outcome: 'in_play', detail: 'out_of_system' })
    if (outcome === 'serve_error') return to({ outcome: 'error' })
  }
  if (action === 'second_touch' || action === 'set') {
    if (outcome === 'error_own') return to({ action: 'second_touch', outcome: 'error' })
    if (outcome === 'error_tried_save') return to({ action: 'second_touch', outcome: 'error', detail: 'failed_save' })
    if (action === 'set') return to({ action: 'second_touch' })
  }
  if (action === 'attack') {
    if (outcome === 'error_own') return to({ outcome: 'error' })
    if (outcome === 'error_bad_set') return to({ outcome: 'error', detail: 'bad_set' })
  }
  if (action === 'dump') {
    if (outcome === 'point') return to({ action: 'attack', outcome: 'kill', detail: 'tip_dump' })
    if (outcome === 'error_own') return to({ action: 'attack', outcome: 'error' })
    if (outcome === 'error_bad_set') return to({ action: 'attack', outcome: 'error', detail: 'bad_set' })
    return to({ action: 'attack' })
  }
  if (action === 'block' && outcome === 'recycle') return to({ outcome: 'soft_block' })
  if (action === 'opponent_error' && (outcome === 'net' || outcome === 'other')) {
    return to({ outcome: 'error', detail: outcome })
  }
  return event
}
