// 关掉这两个开关后，定时任务下拉框的两组要原样回来（style 属性清干净，不留 data-dshmh-hidden）。
import fs from 'node:fs'
import { JSDOM } from 'jsdom'

const file = process.argv[2]
const html = `<!doctype html><html><body>
<div role="menu" class="_list_abc dsh-st-form-menu" id="autoMenu">
  <div role="presentation" class="_viewport_abc">
    <div role="presentation" class="_label_abc" id="lblAccount">DeepSeek 账号</div>
    <div class="_itemWrap_abc"><button type="button" role="menuitem" id="acctA">DeepSeek-V4.1-Flash</button></div>
    <div role="presentation" class="_label_abc" id="lblOfficial">DeepSeek</div>
    <div class="_itemWrap_abc"><button type="button" role="menuitem" id="offA">DeepSeek-V4-Pro</button></div>
  </div>
</div>
</body></html>`

const dom = new JSDOM(html, { url: 'http://example.invalid/' })
const { window } = dom
globalThis.window = window
globalThis.document = window.document
globalThis.MutationObserver = window.MutationObserver
globalThis.localStorage = window.localStorage
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({ ok: false, error: 'stub' }) })
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0)
window.fetch = globalThis.fetch

// 两个开关先关掉
window.localStorage.setItem('dsh-menu-hidden:v1', JSON.stringify({ scheduleAccountGroup: false, scheduleOfficialGroup: false }))

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

const ids = ['lblAccount', 'acctA', 'lblOfficial', 'offA']
const state = {}
for (const id of ids) {
  const el = window.document.getElementById(id)
  state[id] = { display: el.style.display, marked: el.hasAttribute('data-dshmh-hidden') }
}
state.menuVisibility = window.document.getElementById('autoMenu').style.visibility

const failures = []
for (const id of ids) {
  if (state[id].display === 'none') failures.push(id + ' 仍被 display:none')
  if (state[id].marked === true) failures.push(id + ' 仍带 data-dshmh-hidden')
}
if (state.menuVisibility === 'hidden') failures.push('菜单壳仍被按住')

console.log(JSON.stringify(state, null, 2))
if (failures.length > 0) {
  console.error('FAIL: ' + failures.join('；'))
  process.exit(1)
}
console.log('OK 开关关闭后两组原样回来')
