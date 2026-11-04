// 关掉开关之后，子智能体那两个供应商分组要原样回来（style 属性清干净）。
import fs from 'node:fs'
import { JSDOM } from 'jsdom'

const file = process.argv[2]
const html = `<!doctype html><html><body>
<fieldset class="s1_models">
  <legend>Agent 可选择的模型</legend>
  <div class="s1_modelGroup" id="sgAccount" style="border-top:1px solid red"><div class="s1_providerName">DeepSeek Account</div><label class="s1_model">DeepSeek-V4-Pro</label></div>
  <div class="s1_modelGroup" id="sgOfficial"><div class="s1_providerName">DeepSeek 官方 API</div><label class="s1_model">DeepSeek-V4.1-Flash</label></div>
</fieldset>
</body></html>`

const dom = new JSDOM(html, { url: 'http://127.0.0.1:1/' })
const { window } = dom
globalThis.window = window
globalThis.document = window.document
globalThis.MutationObserver = window.MutationObserver
globalThis.localStorage = window.localStorage
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({ ok: false, error: 'stub' }) })
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0)
window.fetch = globalThis.fetch

// 两个开关先关掉
window.localStorage.setItem('dsh-menu-hidden:v1', JSON.stringify({ subagentAccount: false, subagentOfficial: false }))

let mod = null
window.__ModuleLoader__ = { load: ({ factory }) => { mod = factory(() => new Proxy(function () {}, { get: () => new Proxy(function () {}, {}), apply: () => null })) } }
new Function(fs.readFileSync(file, 'utf8'))()

const ctx = {
  get(name) {
    if (name === 'slots') return { inject: (_s, fn) => fn(), register: () => () => {} }
    if (name === 'locale') return { register() {}, bind: () => (k) => k }
    return null
  },
  effect(fn) { const d = fn(); return () => { if (typeof d === 'function') d() } },
  on() {},
}

mod.apply(ctx)
await new Promise((r) => setTimeout(r, 30))

const read = (id) => {
  const el = window.document.getElementById(id)
  return { display: el.style.display || '(empty)', styleAttr: el.getAttribute('style') }
}

console.log(JSON.stringify({ account: read('sgAccount'), official: read('sgOfficial') }, null, 2))
