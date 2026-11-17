import test from 'node:test'
import assert from 'node:assert/strict'

import { createUuid } from '../src/utils/uuid.js'

test('createUuid returns a unique version 4 UUID', () => {
  const first = createUuid()
  const second = createUuid()

  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.notEqual(first, second)
})
