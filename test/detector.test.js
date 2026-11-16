// node --test test/detector.test.js
// Covers the wire codecs and the service state machine with a fake llm —
// no network, no real model.
import test from 'node:test'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { TYPERT, parseStartInput, parseStatusInput, parseCancelInput, parseRoutesInput, parseRoutesResult } from '../typert.js'
import Service from '../index.js'

// TypertRemoteService extends a real cordis Service, so the fake needs a real
// Context with the injected services provided as plain values.
function fakeCtx(llm) {
  const ctx = new Context()
  ctx.reflect.provide('llm', llm, null)
  ctx.reflect.provide('typert', { register: () => () => {} }, null)
  ctx.reflect.provide('tools', { register: () => () => {} }, null)
  return ctx
}

function fakeStream(blocks, { delay = 0 } = {}) {
  return async function* () {
    for (const text of blocks) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay))
      yield { type: 'text-delta', text }
    }
    yield { type: 'usage', usage: { inputTokens: 11, outputTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

const flush = ms => new Promise(resolve => setTimeout(resolve, ms))

test('TYPERT manifest shape', () => {
  assert.equal(TYPERT.package, '@local/dsh-llm-detector')
  assert.equal(TYPERT.face, 'host')
  assert.deepEqual(TYPERT.model, { services: [], events: [], objects: [] })
  assert.deepEqual(TYPERT.invocations.map(d => d.method), ['start', 'status', 'cancel', 'listRoutes'])
  for (const d of TYPERT.invocations) {
    assert.equal(d.service, 'llmDetector')
    assert.equal(d.namespace, 'llmDetector')
    assert.deepEqual(d.invocation, { kind: 'direct' })
    assert.deepEqual(d.cancellation, { parameter: 'signal' })
    assert.equal(d.parameters.length, 1)
    assert.equal(d.parameters[0].source, 'json')
  }
  const status = TYPERT.invocations.find(d => d.method === 'status')
  assert.equal(status.parameters[0].acceptsUndefined, true)
})

test('start codec validates shape; blank route means default-model fallback', () => {
  // Codec is shape-only — trimming happens in the service.
  assert.deepEqual(parseStartInput({ provider: ' p ', model: ' m ' }), { provider: ' p ', model: ' m ' })
  assert.deepEqual(parseStartInput({ provider: '', model: 'm' }), { provider: '', model: 'm' })
  assert.deepEqual(parseStartInput({ provider: 'p' }), { provider: 'p', model: '' })
  assert.deepEqual(parseStartInput({}), { provider: '', model: '' })
  assert.throws(() => parseStartInput({ provider: 'p', model: 'm', extra: 1 }))
  assert.throws(() => parseStartInput({ provider: 'x'.repeat(201), model: 'm' }))
})

test('status/cancel codecs', () => {
  assert.deepEqual(parseStatusInput(undefined), {})
  assert.deepEqual(parseStatusInput({}), {})
  assert.deepEqual(parseStatusInput({ runId: 'run-1' }), { runId: 'run-1' })
  assert.throws(() => parseStatusInput(5))
  assert.deepEqual(parseCancelInput({ runId: 'run-1' }), { runId: 'run-1' })
  assert.throws(() => parseCancelInput({}))
})

test('routes codec: nullable default, named routes', () => {
  assert.deepEqual(parseRoutesInput(undefined), {})
  assert.deepEqual(parseRoutesResult({ default: null, routes: [] }), { default: null, routes: [] })
  const value = parseRoutesResult({
    default: { provider: 'zcode', model: 'GLM-5.3-FlashX', name: 'GLM 5.3 FlashX · ZCode' },
    routes: [{ provider: 'deepseek', model: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash' }, { provider: 'p', model: 'm' }],
  })
  assert.deepEqual(value.default, { provider: 'zcode', model: 'GLM-5.3-FlashX', name: 'GLM 5.3 FlashX · ZCode' })
  assert.deepEqual(value.routes[1], { provider: 'p', model: 'm' })
  assert.throws(() => parseRoutesResult({ routes: [] }))
  assert.throws(() => parseRoutesResult({ default: null, routes: [{ provider: 'p' }] }))
  assert.throws(() => parseRoutesResult({ default: { provider: 'p' }, routes: [] }))
})

test('full run: start → sampling → completed with result', async () => {
  const ctx = fakeCtx({ stream: fakeStream(['1 2 3', ' 42', 'x']) })
  const svc = new Service(ctx, {})
  assert.deepEqual(svc.status({}), { state: 'idle' })

  const started = svc.start({ provider: 'p', model: 'm' })
  assert.match(started.runId, /^run-1-/)

  // Wait for the detached run to settle (SDK load + 3 fake samples).
  let snap
  for (let i = 0; i < 100; i++) {
    snap = svc.status({ runId: started.runId })
    if (snap.state === 'completed' || snap.state === 'failed' || snap.state === 'cancelled') break
    await flush(100)
  }
  assert.equal(snap.state, 'completed')
  assert.ok(['scored', 'partial', 'unscorable', 'not_model'].includes(snap.result.decision), `decision ${snap.result.decision}`)
  assert.equal(snap.result.questions.length, 3)
  assert.ok(Array.isArray(snap.result.candidates)) // garbage replies → possibly zero candidates
  assert.equal(snap.result.usage.inputTokens, 33) // 11 × 3 questions
  // status() without runId also returns the last terminal run
  assert.equal(svc.status({}).state, 'completed')
})

test('busy then cancel', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const ctx = fakeCtx({
    stream: async function* () {
      yield { type: 'text-delta', text: 'a' }
      await gate
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  })
  const svc = new Service(ctx, {})
  const first = svc.start({ provider: 'p', model: 'm' })
  await flush(50)

  assert.throws(() => svc.start({ provider: 'p', model: 'm' }), err => {
    assert.equal(err.code, 'gateway/bad-request')
    assert.equal(err.details?.issues?.[0]?.code, 'busy')
    return true
  })

  assert.throws(() => svc.cancel({ runId: 'nope' }), err => {
    assert.equal(err.code, 'gateway/bad-request')
    assert.equal(err.details?.issues?.[0]?.code, 'not_found')
    return true
  })
  // cancelling an already-terminal run is a no-op with the run id
  assert.deepEqual(svc.cancel({ runId: first.runId }), { runId: first.runId })
  const cancelled = svc.cancel({ runId: first.runId })
  assert.equal(cancelled.runId, first.runId)
  release()
  await flush(1500) // sample question throws on abort → run settles cancelled
  const snap = svc.status({ runId: first.runId })
  assert.equal(snap.state, 'cancelled')
})

test('client.js parses (browser bundle ships untested — guard the syntax)', () => {
  const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  new Function(src) // compile only; top-level window refs must not run
})
