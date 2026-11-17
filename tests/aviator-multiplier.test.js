import assert from 'node:assert/strict'
import { test } from 'node:test'
import { calculateDisplayedMultiplier, MAX_AVIATOR_MULTIPLIER } from '../src/utils/aviatorMultiplier.js'

test('display multiplier stays within the configured maximum for stale flying rounds', () => {
  const startedAt = new Date(0).toISOString()
  assert.equal(calculateDisplayedMultiplier(startedAt, 24 * 60 * 60 * 1000), MAX_AVIATOR_MULTIPLIER)
})

test('display multiplier uses server clock offset and handles invalid start times', () => {
  const startedAt = new Date(10000).toISOString()
  assert.equal(calculateDisplayedMultiplier(startedAt, 20000, 5000), Math.exp(0.5))
  assert.equal(calculateDisplayedMultiplier('invalid', 20000), 1)
})
