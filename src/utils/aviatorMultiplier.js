export const MAX_AVIATOR_MULTIPLIER = 1000

export const calculateDisplayedMultiplier = (startedAt, now, clockOffset = 0) => {
  const start = Date.parse(startedAt)
  if (!Number.isFinite(start)) return 1

  const elapsed = Math.max(0, now - clockOffset - start)
  return Math.min(MAX_AVIATOR_MULTIPLIER, Math.max(1, Math.exp(elapsed / 10000)))
}
