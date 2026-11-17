// @local/dsh-llm-detector — Host face.
// One detection run at a time; in-memory only. lmfpd-sdk owns scoring, this
// service owns sampling through ctx.llm and the single-run state machine.
import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { defineTool } from '@deepseek-ai/dsh-tools'

const QUESTION_TIMEOUT_MS = 300_000 // 5min: slow reasoning models stream long.
const QUESTION_COUNT = 3
const HISTORY_CAP = 30
// Env override keeps tests off the real user history file.
const HISTORY_FILE = process.env.LLM_DETECTOR_HISTORY ?? join(homedir(), '.dsh', 'llm-detector-runs.jsonl')
// Pelican test: one prompt, one reply, saved as an HTML artifact in the
// plugin's own pelican/ directory (env override keeps tests off it).
const MAX_HTML = 400_000
const PELICAN_PROMPT = [
  '创建一个HTML，内容是SVG绘制一个鹈鹕骑自行车的2D动画。鹈鹕必须有可辨认的长嘴和喉囊；双脚持续踩住左右踏板，踏板相位相反，车轮同步向前滚动，翅膀扶住车把。保持身体、四肢和车体连接，不能只移动一整张静态图。',
  '不允许查询互联网，不允许读取记忆，不允许加载技能，不允许测试，不允许读取本地文件。',
].join('\n')

// Number-counting challenges never need temperature tuning; provider defaults
// keep the sample representative of the configured model's ordinary behavior.

function failure(code, message) {
  // The error map has exactly three codes; business codes ride in details.
  return new RemoteError('gateway/bad-request', message, { issues: [{ code }] })
}

export default class LlmDetectorService extends TypertRemoteService {
  static inject = ['llm', 'typert', 'tools', 'agentDefaultModel']

  /** The one active run, occupying the slot before any await. */
  _active
  /** The latest finished run, kept for status({}) after completion. */
  _last
  /** Finished runs this process produced or loaded, newest first. */
  _history = []
  _historyLoaded = false
  _runCounter = 0

  constructor(ctx) {
    super(ctx, 'llmDetector', { namespace: 'llmDetector' })
    ctx.effect(() => ctx.tools.register(createDetectorTool(this)), 'llm-detector: tool')
  }

  start(input) {
    // Trim here, not in the codec: wire validation stays shape-only.
    let provider = input.provider.trim()
    let model = input.model.trim()
    if (provider === '' || model === '') {
      // Blank fields fall back to the host's current default model selection.
      const sel = this.ctx.get('agentDefaultModel')?.currentSelection()
      if (!sel?.provider || !sel?.model) throw failure('invalid', 'no model route given and no default model configured')
      if (provider === '') provider = sel.provider
      if (model === '') model = sel.model
    }
    if (this._active !== undefined) {
      throw failure('busy', `a detection run is already active (${this._active.runId}); cancel it first`)
    }
    // Occupy the slot before the first await so overlapping starts serialize.
    const controller = new AbortController()
    const runId = `run-${++this._runCounter}-${randomUUID().slice(0, 8)}`
    const run = {
      runId,
      provider,
      model,
      kind: input.kind === 'pelican' ? 'pelican' : 'lmfpd',
      concurrency: Math.min(6, Math.max(1, input.concurrency ?? 1)),
      controller,
      startedAt: Date.now(),
      phase: 'loading_data',
      questionIndex: 0,
      finishedAt: undefined,
      result: undefined,
    }
    this._active = run
    // Detached: the caller of start() gets the id at once; progress flows
    // through status() polling. Errors land in the run snapshot, not the wire.
    void this._run(run).catch(error => {
      if (run.result === undefined) this._settle(run, 'failed', { decision: 'error', error: sanitizeError(error) })
    })
    return { runId }
  }

  status(input) {
    const run = this._resolve(input.runId)
    if (run === undefined) return { state: 'idle' }
    if (run.result !== undefined) {
      return {
        state: run.state,
        runId: run.runId,
        provider: run.provider,
        model: run.model,
        kind: run.kind,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        result: run.result,
      }
    }
    return {
      state: run.phase,
      runId: run.runId,
      provider: run.provider,
      model: run.model,
      kind: run.kind,
      phase: run.phase,
      questionIndex: run.questionIndex,
      startedAt: run.startedAt,
    }
  }

  cancel(input) {
    const run = this._resolve(input.runId)
    if (run === undefined || run.result !== undefined) {
      throw failure('not_found', `no active run with id ${JSON.stringify(input.runId)}`)
    }
    run.controller.abort()
    return { runId: run.runId }
  }

  async listRoutes() {
    const routes = []
    for (const provider of this.ctx.llm.listProviders()) {
      const id = typeof provider === 'string' ? provider : provider?.id
      if (typeof id !== 'string' || id === '') continue
      try {
        for (const model of await this.ctx.llm.listModels(id)) {
          if (typeof model?.id === 'string' && model.id !== '') {
            routes.push({ provider: id, model: model.id, ...(typeof model.name === 'string' && model.name !== '' && model.name !== model.id ? { name: model.name } : {}) })
          }
        }
      } catch {
        // Adapter without a catalog: routing still works, just not selectable here.
      }
    }
    const sel = this.ctx.get('agentDefaultModel')?.currentSelection()
    let fallback = null
    if (typeof sel?.provider === 'string' && sel.provider !== '' && typeof sel?.model === 'string' && sel.model !== '') {
      const match = routes.find(route => route.provider === sel.provider && route.model === sel.model)
      fallback = { provider: sel.provider, model: sel.model, ...(match?.name !== undefined ? { name: match.name } : {}) }
    }
    return { default: fallback, routes }
  }

  _resolve(runId) {
    if (this._active !== undefined && (runId === undefined || this._active.runId === runId)) return this._active
    if (this._last !== undefined && (runId === undefined || this._last.runId === runId)) return this._last
    return undefined
  }

  _settle(run, state, result) {
    // Re-check liveness: a stale async step must not overwrite a newer run.
    if (this._active !== run) return
    run.state = state
    run.result = result
    run.finishedAt = Date.now()
    run.phase = undefined
    this._last = run
    this._active = undefined
    const snapshot = this.status({ runId: run.runId })
    this._history.unshift(snapshot)
    if (this._history.length > HISTORY_CAP) this._history.length = HISTORY_CAP
    // Fire-and-forget persistence: losing a history line must never fail a run.
    void appendFile(HISTORY_FILE, `${JSON.stringify(snapshot)}\n`, 'utf8').catch(() => { })
  }

  async listRuns() {
    if (!this._historyLoaded) {
      this._historyLoaded = true
      try {
        const text = await readFile(HISTORY_FILE, 'utf8')
        const lines = text.split('\n').filter(line => line !== '')
        const past = []
        for (const line of lines) {
          try { past.push(JSON.parse(line)) } catch { }
        }
        const seen = new Set(this._history.map(run => run.runId))
        for (const run of past.reverse()) {
          if (!seen.has(run.runId)) this._history.push(run)
        }
        if (this._history.length > HISTORY_CAP) this._history.length = HISTORY_CAP
      } catch {
        // First run ever, or a lost file: history is best-effort.
      }
    }
    return { runs: this._history }
  }

  async _run(run) {
    if (run.kind === 'pelican') return this._runPelican(run)
    const { runId, provider, model, controller } = run
    let detector
    let challenges
    try {
      // Lazy: the SDK and its data download only load when a run starts.
      const sdk = await import('lmfpd-sdk')
      if (controller.signal.aborted) throw abortError()
      detector = await sdk.loadDetector({ ttl: 86400 })
      if (controller.signal.aborted) throw abortError()
      challenges = sdk.generateChallenges(QUESTION_COUNT)
    } catch (error) {
      this._settle(run, 'failed', { decision: 'error', error: sanitizeError(error) })
      return
    }

    const questions = []
    const outputs = []
    const usage = {}
    run.phase = 'sampling'
    const challenges_length = challenges.length
    // Worker pool: run.concurrency === 1 keeps the original serial order;
    // >1 runs questions in parallel, results stay index-ordered.
    const results = new Array(challenges_length)
    let next = 0
    let completed = 0
    const record = (index, entry) => {
      results[index] = entry
      run.questionIndex = ++completed
    }
    const worker = async () => {
      while (next < challenges_length && !run.controller.signal.aborted) {
        const index = next++
        const challenge = challenges[index]
        try {
          const sample = await this._sampleQuestion(run, challenge.prompt)
          record(index, {
            question: { index: index + 1, state: 'ok', text: sample.text, ...(sample.usage === undefined ? {} : { usage: sample.usage }) },
            output: { text: sample.text, expected_count: challenge.expected_count },
            usage: sample.usage,
          })
        } catch (error) {
          record(index, {
            question: { index: index + 1, state: 'failed', error: sanitizeError(error) },
            output: { text: '', expected_count: challenge.expected_count },
          })
        }
      }
    }
    await Promise.all(Array.from({ length: run.concurrency }, worker))

    for (const entry of results) {
      if (entry === undefined) break
      questions.push(entry.question)
      outputs.push(entry.output)
      if (entry.usage !== undefined) {
        for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'totalTokens']) {
          if (entry.usage[key] !== undefined) usage[key] = (usage[key] ?? 0) + entry.usage[key]
        }
      }
    }

    if (controller.signal.aborted) {
      this._settle(run, 'cancelled', { decision: 'error', error: 'cancelled', questions })
      return
    }

    run.phase = 'analyzing'
    try {
      const analysis = detector.analyze(outputs, { strict: false })
      this._settle(run, 'completed', {
        decision: analysis.decision,
        prediction: analysis.prediction,
        predictionName: analysis.prediction_name,
        familyPredictionName: analysis.family_prediction_name,
        candidates: analysis.results.map(item => ({
          model: item.model,
          modelName: item.display_name,
          familyName: item.family_name,
          score: item.score,
          probability: item.probability,
        })),
        probability: analysis.probability,
        probabilityScope: analysis.probability_scope,
        usedOutputs: analysis.used_outputs,
        rankingScore: analysis.ranking_score,
        questions,
        ...(Object.keys(usage).length > 0 ? { usage } : {}),
      })
    } catch (error) {
      this._settle(run, 'failed', { decision: 'error', error: sanitizeError(error), questions, ...(Object.keys(usage).length > 0 ? { usage } : {}) })
    }
  }

  /** Pelican run: one request, save the HTML artifact under the plugin dir. */
  async _runPelican(run) {
    run.phase = 'sampling'
    let usage
    try {
      const sample = await this._sampleQuestion(run, PELICAN_PROMPT)
      usage = sample.usage
      const html = extractHtml(sample.text)
      if (html === '') throw new Error('model reply contained no HTML')
      if (html.length > MAX_HTML) throw new Error(`html exceeds ${MAX_HTML} characters`)
      const dir = pelicanDir()
      await mkdir(dir, { recursive: true })
      const htmlPath = join(dir, `${run.runId}.html`)
      await writeFile(htmlPath, html, 'utf8')
      this._settle(run, 'completed', { decision: 'pelican', htmlPath, html, ...(usage === undefined ? {} : { usage }) })
    } catch (error) {
      const state = run.controller.signal.aborted ? 'cancelled' : 'failed'
      this._settle(run, state, { decision: 'error', error: sanitizeError(error), ...(usage === undefined ? {} : { usage }) })
    }
  }

  /** One question: stream the challenge, count only text deltas, demand finish stop. */
  async _sampleQuestion(run, prompt) {
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(), QUESTION_TIMEOUT_MS)
    const signal = AbortSignal.any([run.controller.signal, timeout.signal])
    let text = ''
    let usage
    let finish
    try {
      const stream = this.ctx.llm.stream({
        provider: run.provider,
        model: run.model,
        messages: [{ id: randomUUID(), role: 'user', content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }],
        signal,
      })
      for await (const chunk of stream) {
        if (chunk.type === 'text-delta') text += chunk.text
        else if (chunk.type === 'usage') usage = chunk.usage
        else if (chunk.type === 'finish') finish = chunk.reason
      }
    } catch (error) {
      console.error('[llm-detector] stream threw:', error)
      throw error
    } finally {
      clearTimeout(timer)
    }
    if (run.controller.signal.aborted) throw abortError()
    if (timeout.signal.aborted) throw new Error(`no finish within ${QUESTION_TIMEOUT_MS / 1000}s`)
    if (finish === undefined || finish.kind !== 'stop') {
      const detail = finish?.failure?.message ?? finish?.failure?.code ?? 'unknown reason'
      console.error('[llm-detector] bad finish:', JSON.stringify(finish))
      throw new Error(`stream ended without a normal finish (${finish === undefined ? 'no finish chunk' : detail})`)
    }
    return {
      text,
      usage: usage === undefined ? undefined : {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        ...(usage.cacheReadTokens !== undefined ? { cacheReadTokens: usage.cacheReadTokens } : {}),
        ...(usage.cacheWriteTokens !== undefined ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
        ...(usage.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {}),
      },
    }
  }
}

function abortError() {
  const error = new Error('cancelled')
  error.name = 'AbortError'
  return error
}

/** Models love fences: prefer the fenced block, else cut leading prose. */
function extractHtml(text) {
  let out = text.trim()
  const fence = out.match(/```[^\n]*\n([\s\S]*?)```/)
  if (fence !== null) out = fence[1].trim()
  else {
    const start = out.search(/<!doctype html|<html[\s>]|<svg[\s>]/i)
    if (start > 0) out = out.slice(start).trim()
  }
  return out.includes('<') ? out : ''
}

/** Artifact home: the plugin's own pelican/ dir; env override keeps tests off it. */
function pelicanDir() {
  const override = process.env.LLM_DETECTOR_PELICAN_DIR
  if (override !== undefined && override !== '') return override
  return join(fileURLToPath(new URL('.', import.meta.url)), 'pelican')
}

/** Never echo transport details: keep the message text only, bounded. */
function sanitizeError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.length > 300 ? `${message.slice(0, 299)}…` : message
}

/** Single tool: one action field dispatches to the same service methods. */
function createDetectorTool(service) {
  return defineTool({
    name: 'llm_detector',
    description: [
      'Model probe tool. kind=lmfpd (default): detect whether a configured model is an LMFPD-listed model via three number-counting challenges.',
      'kind=pelican: ask the model to generate an SVG pelican-riding-a-bicycle 2D animation page; the HTML is saved under the plugin directory and returned in the verdict for preview.',
      'Each action=start run sends model requests on the given provider/model route, which may incur token cost.',
      'action=status reads progress or the final verdict; action=cancel aborts an active run.',
    ].join(' '),
    parameters: {
      action: { type: 'string', enum: ['start', 'status', 'cancel'], required: true, description: 'Which operation to perform.' },
      provider: { type: 'string', description: 'Registered provider route; required for action=start.' },
      model: { type: 'string', description: 'Model id on that route; required for action=start.' },
      kind: { type: 'string', enum: ['lmfpd', 'pelican'], description: 'Test kind; default lmfpd.' },
      runId: { type: 'string', description: 'Run id; required for action=cancel, optional for action=status.' },
    },
    output: {
      schema: { type: 'json' },
      render(args, value) {
        return [{ type: 'text', text: JSON.stringify(value) }]
      },
    },
    async execute(args) {
      if (args.action === 'start') {
        if (typeof args.provider !== 'string' || typeof args.model !== 'string') {
          throw new Error('action=start requires provider and model')
        }
        return service.start({
          provider: args.provider,
          model: args.model,
          ...(typeof args.concurrency === 'number' ? { concurrency: args.concurrency } : {}),
          ...(typeof args.kind === 'string' ? { kind: args.kind } : {}),
        })
      }
      if (args.action === 'status') return service.status({ ...(args.runId === undefined ? {} : { runId: args.runId }) })
      if (typeof args.runId !== 'string') throw new Error('action=cancel requires runId')
      return service.cancel({ runId: args.runId })
    },
  })
}
