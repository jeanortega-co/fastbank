import assert from 'node:assert/strict'
import test from 'node:test'
import { parseBankQr } from '../src/utils/qr.js'

test('parses a JSON QR with the cuenta field', () => {
  assert.deepEqual(parseBankQr('{"cuenta":"3001234567"}'), {
    recipient: '',
    account: '3001234567',
    recipientId: '',
  })
})

test('parses FastBank URL fields and keeps the account holder name', () => {
  assert.deepEqual(parseBankQr('FASTBANK://PAY?userId=demo-user-fastbank&name=Ana%20Garc%C3%ADa&phone=3001234567'), {
    recipient: 'Ana García',
    account: '3001234567',
    recipientId: 'demo-user-fastbank',
  })
})

test('parses a cuenta query parameter', () => {
  assert.deepEqual(parseBankQr('https://fastbank.co/pay?cuenta=3001234567&nombre=Ana'), {
    recipient: 'Ana',
    account: '3001234567',
    recipientId: '',
  })
})

test('parses an explicit account id in a FastBank path', () => {
  assert.deepEqual(parseBankQr('FASTBANK://cuenta/demo-user-fastbank'), {
    recipient: 'demo-user-fastbank',
    account: 'demo-user-fastbank',
    recipientId: 'demo-user-fastbank',
  })
})

test('trims a plain account string', () => {
  assert.deepEqual(parseBankQr('  3001234567  '), {
    recipient: '',
    account: '3001234567',
    recipientId: '',
  })
})

test('rejects malformed JSON with a useful error', () => {
  assert.throws(() => parseBankQr('{"cuenta":'), /JSON inválidos/)
})

test('rejects the obsolete static demo QR instead of reading its date as an account', () => {
  assert.throws(() => parseBankQr('FASTBANK://PAY/ANA-GARCIA/2026-08-17'), /cuenta o identificador/)
})
