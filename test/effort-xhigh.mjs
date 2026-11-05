// 思考深度菜单里不许出现 Xhigh：只藏菜单项，模型列表里同名模型不动。
// 用法：node test/effort-xhigh.mjs client.js
import fs from 'node:fs'
import { JSDOM } from 'jsdom'

const file = process.argv[2]
if (file === undefined) {
  console.error('用法: node test/effort-xhigh.mjs client.js')
  process.exit(1)
}

const html = `<!doctype html><html><body>
<div id="menuHost">
  <div role="menu" id="effortMenu" data-menu-material>
    <div role="menuitemradio" id="lvlOff">Off</div>
    <div role="menuitemradio" id="lvlLow">Low</div>
    <div role="menuitemradio" id="lvlHigh">High</div>
    <div role="menuitemradio" id="lvlXhigh">Xhigh</div>
    <div role="menuitemradio" id="lvlMax">Max</div>
  </div>
  <div role="menu" id="modelMenu" data-menu-material>
    <div role="menuitemradio" class="modelOption" id="modelXhigh">Xhigh</div>
    <div role="menuitemradio" class="modelOption" id="modelOther">GPT 6 Astra</div>
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

let mod = null
window.__ModuleLoader__ = { load: ({ factory }) => { mod = factory((name) => requireStub(name)) } }

const stubFn = function () {}
const requireStub = () => new Proxy(stubFn, {
  get: (_t, k) => (k === 'default' ? {} : k === '__esModule' ? true : new Proxy(stubFn, {})),
  apply: () => null,
})

new Function(fs.readFileSync(file, 'utf8'))()

const ctx = {
  inject(_deps, callback) { callback(this) },
  get(name) {
    if (name === 'slots') return { inject: (slot, fn) => fn(), register: () => () => {} }
    if (name === 'locale') return { register() {}, bind: () => (key) => key }
    return null
  },
  effect(fn) { const d = fn(); return () => { if (typeof d === 'function') d() } },
  on() {},
}

mod.apply(ctx)
await new Promise((r) => setTimeout(r, 40))

const hidden = (id) => window.document.getElementById(id).style.display === 'none'
const report = {
  xhighHidden: hidden('lvlXhigh'),
  offKept: !hidden('lvlOff'),
  lowKept: !hidden('lvlLow'),
  highKept: !hidden('lvlHigh'),
  maxKept: !hidden('lvlMax'),
  modelItemKept: !hidden('modelXhigh'),
  modelOtherKept: !hidden('modelOther'),
}

// 菜单后来才挂上来时，观察器也要立刻处理
const host = window.document.getElementById('menuHost')
const late = window.document.createElement('div')
late.setAttribute('role', 'menu')
late.innerHTML = '<div role="menuitemradio" id="lateXhigh">Xhigh</div><div role="menuitemradio" id="lateHigh">High</div>'
host.appendChild(late)
await new Promise((r) => setTimeout(r, 40))
report.lateXhighHidden = hidden('lateXhigh')
report.lateHighKept = !hidden('lateHigh')

const failed = Object.entries(report).filter(([, ok]) => ok !== true).map(([k]) => k)
console.log(JSON.stringify(report, null, 2))
if (failed.length > 0) {
  console.error('FAIL: ' + failed.join(', '))
  process.exit(1)
}
console.log('OK')
