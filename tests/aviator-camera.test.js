import test from 'node:test'
import assert from 'node:assert/strict'

import { computeCamera } from '../src/utils/aviatorCamera.js'

const widths = [360, 768, 1280]
const multipliers = [1, 2, 10, 50, 100, 1000]

for (const width of widths) {
  for (const multiplier of multipliers) {
    test(`computeCamera keeps the plane inside the safe area for width ${width} and multiplier ${multiplier}`, () => {
      const elapsedMs = 5000 + multiplier * 1000
      const camera = computeCamera(elapsedMs, multiplier, width, 440)
      const { plane, safeBounds } = camera

      assert.ok(plane.x >= safeBounds.left, 'plane x should not be left of the safe bounds')
      assert.ok(plane.x <= safeBounds.right, 'plane x should not be right of the safe bounds')
      assert.ok(plane.y >= safeBounds.top, 'plane y should not be above the safe bounds')
      assert.ok(plane.y <= safeBounds.bottom, 'plane y should not be below the safe bounds')
    })
  }
}

test('computeCamera keeps the plane inside the safe area when reloading mid-flight', () => {
  const width = 768
  const height = 440
  const camera = computeCamera(9000, 6, width, height)
  const { plane, safeBounds } = camera

  assert.ok(plane.x >= safeBounds.left)
  assert.ok(plane.x <= safeBounds.right)
  assert.ok(plane.y >= safeBounds.top)
  assert.ok(plane.y <= safeBounds.bottom)
})
