// @local/dsh-llm-detector — Client face (web).
// Self-contained bundle: no relative imports, locale data inline. The sidebar
// row and the main panel share PANEL_ID; clicking the row opens the panel.

window.__ModuleLoader__.load({
  id: '@local/dsh-llm-detector',
  factory(require) {
    const React = require('react')
    const { createElement: h, useState, useEffect, useRef, useCallback } = React

    const NS = 'llmDetector'
    const PANEL_ID = 'llm-detector'
    const PKG = '@local/dsh-llm-detector'
    let getContext = () => undefined

    const zh = {
      panel: '模型检测',
      title: 'LMFPD 模型检测',
      intro: '用 3 道计数挑战题判断当前配置的模型是否为 LMFPD 库内已知模型。仅对本 DSH 实例已配置的 Provider 路由发起请求，不会发送任何密钥或页面数据。',
      choose_model: '选择模型',
      default_model: '默认模型',
      settings_entry: '模型检测',
      settings_entry_hint: '用计数挑战题识别当前模型，查看是否命中参考库',
      start: '开始检测',
      starting: '启动中…',
      cost: '开始后将向该模型串行发送 3 个请求，可能产生 token 费用。',
      cancel: '取消检测',
      idle_hint: '尚无检测任务。',
      phase_loading_data: '加载参考数据…',
      phase_sampling: '采样中 {index}/3',
      phase_analyzing: '分析样本…',
      completed: '检测完成',
      failed: '检测失败',
      cancelled: '已取消',
      decision_scored: '命中库内模型',
      decision_partial: '样本不足，仅部分匹配',
      decision_unscorable: '无法评分',
      decision_not_model: '不符合库内模型样本特征',
      configured_model: '配置模型',
      prediction: '最可能模型',
      family: '所属家族',
      candidates: '候选排名',
      score: '评分',
      probability: '概率',
      prob_ref: '参考库内校准概率（非真实模型确认率）',
      no_probability: '概率不可用（样本不足）',
      questions: '问题明细',
      q_ok: '成功',
      q_failed: '失败',
      usage: 'Token 用量（input+cache读+cache写）',
      method: '方法与局限',
      notes: '结论来自计数一致性与序列统计特征对照参考库的排名，非模型提供方确认；有效样本少于 3 时仅给部分结论；无法给出概率时表示参考库校准不可用。',
      offline: '连接中断，状态未确认',
      busy: '已有检测任务在运行，请先取消。',
      start_failed: '启动失败',
      error: '错误',
      raw_reply: '原始回复',
    }
    const en = {
      panel: 'LM Detector',
      title: 'LMFPD model detector',
      intro: 'Probes whether the configured model is an LMFPD-listed model with 3 counting challenges. Requests only the provider routes this DSH instance already configured; no keys or page data are sent.',
      choose_model: 'Model',
      default_model: 'Default model',
      settings_entry: 'Model detection',
      settings_entry_hint: 'Identify the current model with counting challenges against a reference bank',
      start: 'Start detection',
      starting: 'Starting…',
      cost: 'Starting sends 3 serial requests to the model and may incur token cost.',
      cancel: 'Cancel run',
      idle_hint: 'No detection run yet.',
      phase_loading_data: 'Loading reference data…',
      phase_sampling: 'Sampling {index}/3',
      phase_analyzing: 'Analyzing samples…',
      completed: 'Detection completed',
      failed: 'Detection failed',
      cancelled: 'Cancelled',
      decision_scored: 'Listed model matched',
      decision_partial: 'Partial match: not enough valid samples',
      decision_unscorable: 'Unscorable',
      decision_not_model: 'Does not look like a listed-model sample',
      configured_model: 'Configured model',
      prediction: 'Best match',
      family: 'Model family',
      candidates: 'Top candidates',
      score: 'Score',
      probability: 'Probability',
      prob_ref: 'Reference-calibrated probability (not a real-model confirmation rate)',
      no_probability: 'Probability unavailable (insufficient samples)',
      questions: 'Question detail',
      q_ok: 'ok',
      q_failed: 'failed',
      usage: 'Token usage (input+cache read+cache write)',
      method: 'Method and limits',
      notes: 'The verdict ranks counting consistency and sequence statistics against the reference bank; it is not a confirmation by the model vendor. Fewer than 3 valid samples yield only a partial verdict; a missing probability means calibration was unavailable.',
      offline: 'Connection lost; status unknown',
      busy: 'A run is already active; cancel it first.',
      start_failed: 'Start failed',
      error: 'Error',
      raw_reply: 'Raw reply',
    }

    // Client-side descriptors only need the strict shape; the Host decodes.
    function stubCodec(typeSymbol) {
      return { mode: 'strict', typeSymbol, create: () => ({ parse: value => value }) }
    }
    function descriptor(method, description, acceptsUndefined) {
      return {
        id: `${PKG}#llmDetector/${method}`,
        service: 'llmDetector',
        namespace: 'llmDetector',
        method,
        description,
        invocation: { kind: 'direct' },
        parameters: [{
          name: 'input',
          wire: 'input',
          description,
          source: 'json',
          ...(acceptsUndefined ? { acceptsUndefined: true } : {}),
          codec: stubCodec(`${PKG}#${method}Input`),
        }],
        cancellation: { parameter: 'signal' },
        result: stubCodec(`${PKG}#${method}Result`),
      }
    }
    const INVOCATIONS = [
      descriptor('start', 'Start one detection run against a configured provider/model route.'),
      descriptor('status', 'Read the current run snapshot.', true),
      descriptor('cancel', 'Cancel the run with the given id.'),
      descriptor('listRoutes', 'List probe-able model routes and the default selection.', true),
    ]

    const DECISION_KEYS = {
      scored: 'decision_scored',
      partial: 'decision_partial',
      unscorable: 'decision_unscorable',
      not_model: 'decision_not_model',
    }
    const ACTIVE_STATES = new Set(['loading_data', 'sampling', 'analyzing'])

    function PanelIcon() {
      return h('svg', {
        width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true,
        style: { display: 'block' },
      },
        h('circle', { cx: 8, cy: 8, r: 6.2, stroke: 'currentColor', 'stroke-width': 1.4 }),
        h('path', { d: 'M8 1.8v12.4M1.8 8h12.4', stroke: 'currentColor', 'stroke-width': 1.2, opacity: 0.55 }),
      )
    }

    // Row inside 设置 → 模型; clicking opens the detector panel and closes
    // the settings modal (it stays mounted over the panel otherwise).
    function SettingsEntry({ t }) {
      return h('div', { style: styles.settingsEntry },
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
          h('span', { style: { fontWeight: 600 } }, t('settings_entry')),
          h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, t('settings_entry_hint'))),
        h('button', {
          onClick: () => {
            getContext()?.layout?.selectPanel(PANEL_ID)
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
          },
          style: styles.secondary,
        }, t('start')),
      )
    }

    function formatUsage(usage) {
      if (usage === undefined) return null
      const parts = [`in ${usage.inputTokens}`, `out ${usage.outputTokens}`]
      if (usage.cacheReadTokens !== undefined) parts.push(`cacheR ${usage.cacheReadTokens}`)
      if (usage.cacheWriteTokens !== undefined) parts.push(`cacheW ${usage.cacheWriteTokens}`)
      return parts.join(' / ')
    }

    function Page({ t, api }) {
      const [routeKey, setRouteKey] = useState('')
      const [routes, setRoutes] = useState(undefined)
      const [snapshot, setSnapshot] = useState(undefined)
      const [busyStarting, setBusyStarting] = useState(false)
      const [error, setError] = useState(undefined)
      const [offline, setOffline] = useState(false)
      const polling = useRef(false)

      const refresh = useCallback(async (runId) => {
        if (polling.current) return
        polling.current = true
        try {
          const result = await api.status(runId === undefined ? {} : { runId })
          if (!result.ok) {
            setError(`${t('error')}: ${result.error.message}`)
            return
          }
          setSnapshot(result.value)
          setError(undefined)
          setOffline(false)
        } catch {
          setOffline(true)
        } finally {
          polling.current = false
        }
      }, [api, t])

      // Restore on open, then poll ~1s (serial) while a run is active.
      useEffect(() => { void refresh() }, [refresh])
      useEffect(() => {
        if (snapshot === undefined || !ACTIVE_STATES.has(snapshot.state)) return undefined
        const timer = setInterval(() => { void refresh(snapshot.runId) }, 1000)
        return () => clearInterval(timer)
      }, [snapshot, refresh])

      // Model catalog for the picker; failure leaves just the default option.
      useEffect(() => {
        let alive = true
        void api.listRoutes({}).then(result => {
          if (alive && result.ok) setRoutes(result.value)
        }).catch(() => {})
        return () => { alive = false }
      }, [api])

      const active = snapshot !== undefined && ACTIVE_STATES.has(snapshot.state)
      const options = []
      const defaultLabel = routes?.default === null || routes?.default === undefined
        ? t('default_model')
        : `${t('default_model')}（${routes.default.name ?? routes.default.model} · ${routes.default.provider}）`
      options.push(h('option', { key: '', value: '' }, defaultLabel))
      const seen = new Set()
      for (const route of routes?.routes ?? []) {
        const key = `${route.provider}|${route.model}`
        if (seen.has(key)) continue
        seen.add(key)
        options.push(h('option', { key, value: key }, `${route.name ?? route.model} · ${route.provider}`))
      }
      const start = async () => {
        setBusyStarting(true)
        setError(undefined)
        try {
          const [provider, model] = routeKey === '' ? ['', ''] : routeKey.split('|')
          const result = await api.start({ provider, model })
          if (!result.ok) {
            const issue = result.error.details?.issues?.[0]
            setError(issue?.code === 'busy' ? t('busy') : `${t('start_failed')}: ${result.error.message}`)
            return
          }
          await refresh(result.value.runId)
        } catch {
          setOffline(true)
        } finally {
          setBusyStarting(false)
        }
      }
      const cancel = async () => {
        if (snapshot?.runId === undefined) return
        try {
          const result = await api.cancel({ runId: snapshot.runId })
          if (!result.ok) setError(result.error.message)
        } catch {
          setOffline(true)
        }
      }

      return h('div', { style: styles.page },
        h('h2', { style: styles.title }, t('title')),
        offline && h('div', { role: 'alert', style: styles.offline }, t('offline')),
        h('p', { style: styles.intro }, t('intro')),
        h('div', { style: styles.form },
          h('label', { style: styles.field },
            h('span', null, t('choose_model')),
            h('select', { value: routeKey, onChange: e => setRouteKey(e.target.value), style: styles.input, disabled: active }, ...options)),
          h('div', { style: styles.actions },
            active
              ? h('button', { onClick: () => { void cancel() }, style: styles.secondary }, t('cancel'))
              : h('button', {
                onClick: () => { void start() },
                disabled: busyStarting,
                style: styles.primary,
              }, busyStarting ? t('starting') : t('start'))),
          h('p', { style: styles.cost }, t('cost'))),
        error !== undefined && h('div', { role: 'alert', style: styles.error }, error),
        h(ResultView, { t, snapshot }),
      )
    }

    function ResultView({ t, snapshot }) {
      if (snapshot === undefined || snapshot.state === 'idle') {
        return h('p', { style: styles.hint }, t('idle_hint'))
      }
      const children = []
      if (snapshot.state === 'loading_data') children.push(h('p', { 'aria-live': 'polite', style: styles.phase }, t('phase_loading_data')))
      if (snapshot.state === 'sampling') children.push(h('p', { 'aria-live': 'polite', style: styles.phase }, t('phase_sampling').replace('{index}', String(snapshot.questionIndex ?? ''))))
      if (snapshot.state === 'analyzing') children.push(h('p', { 'aria-live': 'polite', style: styles.phase }, t('phase_analyzing')))
      if (snapshot.state === 'completed' || snapshot.state === 'failed' || snapshot.state === 'cancelled') {
        children.push(h('p', { style: styles.phase }, t(snapshot.state)))
        const result = snapshot.result
        if (result !== undefined) {
          if (result.decision !== 'error' && result.predictionName !== undefined) {
            const key = DECISION_KEYS[result.decision]
            children.push(h('div', { style: styles.verdict }, [
              h('span', { style: styles.badge, key: 'badge' }, key === undefined ? result.decision : t(key)),
              h('span', { key: 'pred' }, `${t('prediction')}: ${result.predictionName} (${t('configured_model')}: ${snapshot.model})`),
            ]))
            if (result.familyPredictionName !== undefined) {
              children.push(h('p', { style: styles.line }, `${t('family')}: ${result.familyPredictionName}`))
            }
            const probability = result.probability
            children.push(h('p', { style: styles.line },
              probability === null || probability === undefined
                ? t('no_probability')
                : `${t('prob_ref')}: ${(probability * 100).toFixed(1)}%`))
          }
          if (result.error !== undefined) {
            children.push(h('div', { role: 'alert', style: styles.error }, `${t('error')}: ${result.error}`))
          }
          const candidates = result.candidates ?? []
          if (candidates.length > 0) {
            children.push(h('h3', { style: styles.sectionTitle }, t('candidates')))
            children.push(h('table', { style: styles.table },
              h('thead', null, h('tr', null,
                h('th', { style: styles.th }, '#'),
                h('th', { style: styles.th }, t('configured_model')),
                h('th', { style: styles.th }, t('family')),
                h('th', { style: styles.th }, t('score')))),
              h('tbody', null, candidates.slice(0, 5).map((candidate, index) => h('tr', { key: candidate.model },
                h('td', { style: styles.td }, String(index + 1)),
                h('td', { style: styles.td }, candidate.modelName ?? candidate.model),
                h('td', { style: styles.td }, candidate.familyName ?? ''),
                h('td', { style: styles.td }, candidate.score.toFixed(3)))))))
          }
          const questions = result.questions ?? []
          if (questions.length > 0) {
            children.push(h('h3', { style: styles.sectionTitle }, t('questions')))
            for (const question of questions) {
              children.push(h('details', { key: question.index, style: styles.question },
                h('summary', null, `#${question.index} — ${question.state === 'ok' ? t('q_ok') : `${t('q_failed')}${question.error === undefined ? '' : `: ${question.error}`}`}`),
                question.text !== undefined && h('pre', { style: styles.reply }, question.text),
                question.usage !== undefined && h('p', { style: styles.usageLine }, `${t('usage')}: ${formatUsage(question.usage)}`)))
            }
          }
          const usage = formatUsage(result.usage)
          if (usage !== null) children.push(h('p', { style: styles.usageLine }, `${t('usage')}: ${usage}`))
        }
      }
      children.push(h('details', { style: styles.method },
        h('summary', null, t('method')),
        h('p', { style: styles.line }, t('notes'))))
      return h('section', { 'aria-live': 'polite' }, ...children)
    }

    const styles = {
      page: { display: 'flex', flexDirection: 'column', gap: 12, padding: 16, color: 'var(--dsw-alias-label-primary)', fontSize: 13, lineHeight: 1.55, overflowY: 'auto', height: '100%', boxSizing: 'border-box' },
      title: { margin: 0, fontSize: 17, fontWeight: 600 },
      intro: { margin: 0, color: 'var(--dsw-alias-label-secondary)' },
      form: { display: 'flex', flexDirection: 'column', gap: 8, padding: 12, borderRadius: 10, border: '1px solid var(--dsw-alias-border-l)' },
      field: { display: 'flex', flexDirection: 'column', gap: 4, color: 'var(--dsw-alias-label-secondary)' },
      input: { padding: '6px 10px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l)', background: 'transparent', color: 'var(--dsw-alias-label-primary)', fontSize: 13 },
      actions: { display: 'flex', gap: 8, marginTop: 2 },
      primary: { padding: '7px 16px', borderRadius: 8, border: 'none', background: 'var(--dsw-alias-brand-primary)', color: '#fff', fontSize: 13, cursor: 'pointer' },
      secondary: { padding: '7px 16px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l)', background: 'transparent', color: 'var(--dsw-alias-label-primary)', fontSize: 13, cursor: 'pointer' },
      cost: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-state-warn-label)' },
      error: { padding: '8px 12px', borderRadius: 8, border: '1px solid var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-state-error-primary)' },
      offline: { padding: '8px 12px', borderRadius: 8, border: '1px solid var(--dsw-alias-state-warn-label)', color: 'var(--dsw-alias-state-warn-label)' },
      hint: { margin: 0, color: 'var(--dsw-alias-label-tertiary)' },
      phase: { margin: 0, fontWeight: 600 },
      verdict: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      badge: { padding: '2px 10px', borderRadius: 999, background: 'var(--dsw-alias-state-success-secondary)', color: 'var(--dsw-alias-label-primary)', fontSize: 12 },
      line: { margin: 0 },
      sectionTitle: { margin: '8px 0 0', fontSize: 13, fontWeight: 600 },
      table: { borderCollapse: 'collapse', width: '100%' },
      th: { textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--dsw-alias-border-l)', fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' },
      td: { padding: '4px 8px', borderBottom: '1px solid var(--dsw-alias-border-l)' },
      question: { padding: '4px 0', borderBottom: '1px solid var(--dsw-alias-border-l)' },
      reply: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '6px 0', padding: 8, borderRadius: 8, background: 'transparent', maxHeight: 200, overflowY: 'auto' },
      usageLine: { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' },
      method: { marginTop: 4, color: 'var(--dsw-alias-label-secondary)' },
      settingsEntry: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 14px', borderRadius: 10, border: '1px solid var(--dsw-alias-border-l)' },
    }

    // Data layer over the mounted llmDetector namespace. `ctx.remote.llmDetector`
    // (accessor form) needs a `remote.llmDetector` inject that deadlocks with our
    // own $mount — resolve via the live map instead (same trick as dsh-worker).
    function createApi(getCtx) {
      function ns() {
        const ctx = getCtx()
        const entry = ctx.remote && ctx.remote.namespaces && ctx.remote.namespaces.get('llmDetector')
        if (!entry || !entry.service) throw new Error('llm-detector remote is not mounted yet')
        return entry.service
      }
      return {
        async status(input) { return ns().status(input) },
        async start(input) { return ns().start(input) },
        async cancel(input) { return ns().cancel(input) },
        async listRoutes(input) { return ns().listRoutes(input ?? {}) },
      }
    }

    // ctx.remote comes from the api-remotes client bundle; if our entry applies
    // before it, poll briefly instead of failing the mount.
    function mountWhenReady(ctx, contribution) {
      let tries = 0
      const attempt = async () => {
        if (ctx.remote && typeof ctx.remote.$mount === 'function') {
          try {
            await ctx.remote.$mount(contribution)
            console.info('[llm-detector] remote mounted')
          } catch (err) {
            console.error('[llm-detector] remote mount failed:', err)
          }
          return
        }
        if (++tries < 50) setTimeout(attempt, 200)
        else console.warn('[llm-detector] ctx.remote.$mount never appeared')
      }
      attempt()
    }

    function apply(ctx) {
      getContext = () => ctx
      ctx.locale.register(NS, { zh, en })
      const t = ctx.locale.bind(NS)
      const api = createApi(() => ctx)
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        locale: NS,
        inject: () => ({ t, api }),
      }, Page))
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        locale: NS,
        label: () => t('panel'),
      }, PanelIcon))
      ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
        name: 'settings.models.footer',
        id: PANEL_ID,
        locale: NS,
        inject: () => ({ t }),
      }, SettingsEntry))
      mountWhenReady(ctx, { package: PKG, descriptors: INVOCATIONS })
    }

    return { inject: ['slots', 'locale', 'remote'], apply }
  },
})
