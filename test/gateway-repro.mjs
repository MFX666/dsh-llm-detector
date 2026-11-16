// Reproduce gateway host + our plugin + gateway client in one plain Node ctx.
// Observable errors instead of silent UI banners.
import { Context } from '/tmp/dsh-asar/dsh/node_modules/@deepseek-ai/cordis/lib/index.js'
import GatewayHost from '/tmp/dsh-asar/dsh/node_modules/@deepseek-ai/dsh-api-gateway/lib/index.js'
import { apply as GatewayClient } from '/tmp/dsh-asar/dsh/node_modules/@deepseek-ai/dsh-api-gateway/lib/client.node.js'
import Plugin from '../index.js'

const root = new Context()

root.plugin(GatewayHost)
root.plugin(GatewayClient)
root.plugin(Plugin)

await new Promise(r => setTimeout(r, 500))

const probe = root.extend({ provider: 'probe' })
probe.effect(() => {
  const api = probe.remote.llmDetector
  console.log('[probe] api object:', typeof api, api && Object.keys(api))
  try {
    const p = api.status({})
    console.log('[probe] status() returned:', p && p.constructor?.name)
    p.then(
      v => { console.log('[probe] status ok=', JSON.stringify(v).slice(0, 300)); process.exit(0) },
      e => { console.log('[probe] status rejected:', e && (e.stack || e.message)); process.exit(1) },
    )
  } catch (e) {
    console.log('[probe] status threw sync:', e && (e.stack || e.message))
    process.exit(1)
  }
}, 'probe: status call')

setTimeout(() => { console.log('[probe] TIMEOUT — no answer in 5s'); process.exit(2) }, 5000)
