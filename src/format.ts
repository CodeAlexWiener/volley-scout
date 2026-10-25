/** Format seconds as m:ss.t (one decimal). */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00.0'
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  const whole = Math.floor(s)
  const tenths = Math.floor((s - whole) * 10)
  return `${m}:${String(whole).padStart(2, '0')}.${tenths}`
}

export function playerLabel(
  player: { name: string } | undefined,
  fallback = 'Unknown',
): string {
  if (!player) return fallback
  return player.name
}
