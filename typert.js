// Hand-written strict typert manifest for @local/dsh-llm-detector.
// Loaded by dsh-typert-loader via the ./typert export; no decorators, no zod.
// Strict codec contract (dsh-typert-loader requireSchemaProjection/requireStrictCodec):
// { mode:'strict', typeSymbol:string, create(): { parse(value) }, description?, jsonSchema? }.

const MAX_ID = 128
const MAX_NAME = 200
const MAX_TEXT = 100_000

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactObject(value, keys, what) {
  if (!isPlainObject(value)) throw new TypeError(`${what} must be an object`)
  const seen = new Set(Object.keys(value))
  for (const key of keys) seen.delete(key)
  if (seen.size > 0) throw new TypeError(`${what} has unknown field ${seen.values().next().value}`)
  return value
}

function nonEmptyString(value, what, max) {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${what} must be a non-empty string`)
  if (value.length > max) throw new TypeError(`${what} must be at most ${max} characters`)
  return value
}

function optionalString(value, what, max) {
  if (value === undefined) return undefined
  return nonEmptyString(value, what, max)
}

/** Wrap a validator as a strict codec factory. */
function codec(typeSymbol, description, parse) {
  return { mode: 'strict', typeSymbol, create: () => ({ parse }), description }
}

// --- wire payloads -----------------------------------------------------------

export function parseStartInput(value) {
  const input = exactObject(value, ['provider', 'model'], 'start input')
  // Empty route means "use the host's current default model selection".
  return {
    provider: input.provider === undefined || input.provider === '' ? '' : nonEmptyString(input.provider, 'provider', MAX_NAME),
    model: input.model === undefined || input.model === '' ? '' : nonEmptyString(input.model, 'model', MAX_NAME),
  }
}

export function parseStatusInput(value) {
  if (value === undefined) return {}
  const input = exactObject(value, ['runId'], 'status input')
  if (input.runId === undefined) return {}
  return { runId: optionalString(input.runId, 'runId', MAX_ID) }
}

export function parseCancelInput(value) {
  const input = exactObject(value, ['runId'], 'cancel input')
  return { runId: nonEmptyString(input.runId, 'runId', MAX_ID) }
}

export function parseRunIdResult(value) {
  const result = exactObject(value, ['runId'], 'result')
  return { runId: nonEmptyString(result.runId, 'runId', MAX_ID) }
}

const STATES = ['idle', 'loading_data', 'sampling', 'analyzing', 'completed', 'failed', 'cancelled']
const TERMINAL = new Set(['completed', 'failed', 'cancelled'])

// Shallow validation: the terminal snapshot is our own Host-produced JSON, the
// gateway already asserts JSON-ness; here we pin only the discriminant shape.
export function parseStatusResult(value) {
  const result = exactObject(value, ['state', 'runId', 'provider', 'model', 'phase', 'questionIndex', 'startedAt', 'finishedAt', 'result'], 'status result')
  if (!STATES.includes(result.state)) throw new TypeError('status result has an unknown state')
  const out = { state: result.state }
  if (result.runId !== undefined) out.runId = nonEmptyString(result.runId, 'runId', MAX_ID)
  if (result.provider !== undefined) out.provider = nonEmptyString(result.provider, 'provider', MAX_NAME)
  if (result.model !== undefined) out.model = nonEmptyString(result.model, 'model', MAX_NAME)
  if (result.phase !== undefined) {
    if (!['loading_data', 'sampling', 'analyzing'].includes(result.phase)) throw new TypeError('status result has an unknown phase')
    out.phase = result.phase
  }
  if (result.questionIndex !== undefined) {
    if (!Number.isInteger(result.questionIndex) || result.questionIndex < 0 || result.questionIndex > 3) throw new TypeError('questionIndex out of range')
    out.questionIndex = result.questionIndex
  }
  if (result.startedAt !== undefined) out.startedAt = requireNumber(result.startedAt, 'startedAt')
  if (result.finishedAt !== undefined) out.finishedAt = requireNumber(result.finishedAt, 'finishedAt')
  if (result.result !== undefined) {
    if (!TERMINAL.has(result.state)) throw new TypeError('result present on a non-terminal status')
    out.result = parseRunResult(result.result)
  }
  return out
}

function requireNumber(value, what) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${what} must be a finite number`)
  return value
}

export function parseRunResult(value) {
  const result = exactObject(value, ['decision', 'prediction', 'predictionName', 'familyPredictionName', 'candidates', 'questions', 'probability', 'probabilityScope', 'usedOutputs', 'rankingScore', 'usage', 'error'], 'run result')
  if (!['scored', 'partial', 'unscorable', 'not_model', 'error'].includes(result.decision)) throw new TypeError('run result has an unknown decision')
  const out = { decision: result.decision }
  for (const key of ['prediction', 'predictionName', 'familyPredictionName']) {
    if (result[key] !== undefined) out[key] = String(result[key])
  }
  if (result.candidates !== undefined) {
    if (!Array.isArray(result.candidates)) throw new TypeError('candidates must be an array')
    out.candidates = result.candidates.map((item, index) => {
      const candidate = exactObject(item, ['model', 'modelName', 'familyName', 'score', 'probability'], `candidate ${index}`)
      return {
        model: String(candidate.model),
        modelName: optionalString(candidate.modelName, 'candidate model name', 200),
        familyName: optionalString(candidate.familyName, 'candidate family name', 200),
        score: requireNumber(candidate.score, 'candidate score'),
        probability: candidate.probability === null || candidate.probability === undefined ? null : requireNumber(candidate.probability, 'candidate probability'),
      }
    })
  }
  if (result.questions !== undefined) {
    if (!Array.isArray(result.questions) || result.questions.length !== 3) throw new TypeError('questions must be 3 entries')
    out.questions = result.questions.map((item, index) => {
      const question = exactObject(item, ['index', 'state', 'text', 'error', 'usage'], `question ${index}`)
      if (!['ok', 'failed'].includes(question.state)) throw new TypeError('question has an unknown state')
      const entry = { index: requireNumber(question.index, 'question index'), state: question.state }
      if (question.text !== undefined) entry.text = nonEmptyString(question.text, 'question text', MAX_TEXT)
      if (question.error !== undefined) entry.error = String(question.error)
      if (question.usage !== undefined) entry.usage = parseUsage(question.usage, `question ${index} usage`)
      return entry
    })
  }
  if (result.probability !== undefined) out.probability = result.probability === null ? null : requireNumber(result.probability, 'probability')
  if (result.probabilityScope !== undefined) out.probabilityScope = result.probabilityScope === null ? null : String(result.probabilityScope)
  if (result.usedOutputs !== undefined) out.usedOutputs = requireNumber(result.usedOutputs, 'usedOutputs')
  if (result.rankingScore !== undefined) out.rankingScore = result.rankingScore === null ? null : requireNumber(result.rankingScore, 'rankingScore')
  if (result.usage !== undefined) out.usage = parseUsage(result.usage, 'usage')
  if (result.error !== undefined) out.error = String(result.error)
  return out
}

function parseUsage(value, what) {
  const usage = exactObject(value, ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'totalTokens'], what)
  const out = {
    inputTokens: requireNumber(usage.inputTokens, `${what} inputTokens`),
    outputTokens: requireNumber(usage.outputTokens, `${what} outputTokens`),
  }
  for (const key of ['cacheReadTokens', 'cacheWriteTokens', 'totalTokens']) {
    if (usage[key] !== undefined && usage[key] !== null) out[key] = requireNumber(usage[key], `${what} ${key}`)
  }
  return out
}

// --- descriptors -------------------------------------------------------------

const PKG = '@local/dsh-llm-detector'
const NS = 'llmDetector'

function inputParameter(description, acceptsUndefined = false) {
  return { name: 'input', wire: 'input', description, source: 'json', ...(acceptsUndefined ? { acceptsUndefined: true } : {}), codec: undefined }
}

export const START_INPUT = codec(`${PKG}#StartInput`, 'Provider route and model id to probe.', parseStartInput)
export const STATUS_INPUT = codec(`${PKG}#StatusInput`, 'Optional run id; omit for the latest run.', parseStatusInput)
export const CANCEL_INPUT = codec(`${PKG}#CancelInput`, 'The run id to cancel.', parseCancelInput)
export const START_RESULT = codec(`${PKG}#StartResult`, 'The accepted run id.', parseRunIdResult)
export const CANCEL_RESULT = codec(`${PKG}#CancelResult`, 'The cancelled run id.', parseRunIdResult)
export const STATUS_RESULT = codec(`${PKG}#StatusResult`, 'One snapshot of the detector run.', parseStatusResult)

const startDescriptor = inputParameter('Provider route and model id to probe.')
startDescriptor.codec = START_INPUT
const statusDescriptor = inputParameter('Optional run id; omit to read the latest run.', true)
statusDescriptor.codec = STATUS_INPUT
const cancelDescriptor = inputParameter('The run id to cancel.')
cancelDescriptor.codec = CANCEL_INPUT

export const TYPERT = {
  package: PKG,
  face: 'host',
  schemas: [],
  model: { services: [], events: [], objects: [] },
  invocations: [
    {
      id: `${PKG}#${NS}/start`,
      service: NS,
      namespace: NS,
      method: 'start',
      description: 'Start one detection run: 3 counting challenges against the configured model. Fails with busy when a run is active.',
      invocation: { kind: 'direct' },
      parameters: [startDescriptor],
      cancellation: { parameter: 'signal' },
      result: START_RESULT,
    },
    {
      id: `${PKG}#${NS}/status`,
      service: NS,
      namespace: NS,
      method: 'status',
      description: 'Read the current run snapshot; runId omitted means the latest run.',
      invocation: { kind: 'direct' },
      parameters: [statusDescriptor],
      cancellation: { parameter: 'signal' },
      result: STATUS_RESULT,
    },
    {
      id: `${PKG}#${NS}/cancel`,
      service: NS,
      namespace: NS,
      method: 'cancel',
      description: 'Cancel the run with the given id; unknown ids answer not_found.',
      invocation: { kind: 'direct' },
      parameters: [cancelDescriptor],
      cancellation: { parameter: 'signal' },
      result: CANCEL_RESULT,
    },
  ],
}
