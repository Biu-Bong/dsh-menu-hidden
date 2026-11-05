// 启动安全回归：服务缺失 / 依赖永远是 pending 时，apply 不许抛异常。
// 背景：web boot 只要有一条 entry 不是 active 就 `throw new Error("web boot: N entries did not activate")`，
// 整个前端白屏。所以插件在任何「服务没到」的宿主上都必须是「少个功能但活着」，不是「拖死整个前端」。
import fs from 'node:fs'
import { JSDOM } from 'jsdom'

const file = process.argv[2]
const src = fs.readFileSync(file, 'utf8')

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', {
  url: 'http://example.invalid/',
})
const { window } = dom
globalThis.window = window
globalThis.document = window.document
globalThis.MutationObserver = window.MutationObserver
globalThis.localStorage = window.localStorage
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0)
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({ ok: false, error: 'stub' }) })
window.fetch = globalThis.fetch

let mod = null
const stubFn = function () {}
const requireStub = () => new Proxy(stubFn, {
  get: (_t, k) => (k === 'default' ? {} : k === '__esModule' ? true : new Proxy(stubFn, {})),
  apply: () => null,
})
window.__ModuleLoader__ = { load: ({ factory }) => { mod = factory((name) => requireStub(name)) } }

const results = []
const tryBoot = (label, ctx) => {
  try {
    mod.apply(ctx)
    results.push({ case: label, threw: false, ok: true })
  } catch (error) {
    results.push({ case: label, threw: true, ok: false, error: `${error.name}: ${error.message}` })
  }
}

try {
  new Function(src)()
} catch (error) {
  console.log(JSON.stringify({ evaluated: false, error: `${error.name}: ${error.message}` }, null, 2))
  process.exit(1)
}

const base = {
  effect(fn) { const d = fn(); return () => { if (typeof d === 'function') d() } },
  on() {},
}

// A：老宿主，没有 scoped inject，ctx.get 直接抛（等价于服务一个都没到）
tryBoot('no-inject-get-throws', {
  ...base,
  get() { throw new Error('service "slots" is not available') },
})

// B：有 scoped inject，但依赖永远 pending —— 回调根本不会被调用
tryBoot('inject-pending-forever', {
  ...base,
  get() { throw new Error('service is pending') },
  inject() { /* 故意不回调，模拟 slots / locale 永远到不了 */ },
})

// C：inject 回调来了，但 slots 是坏的（没有 inject 方法）
tryBoot('inject-arrives-without-slots', {
  ...base,
  get() { return null },
  inject(_deps, callback) { callback(this) },
})

// D：完全空 ctx，连 effect 都没有（最坏情况，验证每个入口都有兜底）
tryBoot('bare-ctx', {})

await new Promise((r) => setTimeout(r, 30))
const ok = results.every((r) => r.ok)
console.log(JSON.stringify({ ok, results }, null, 2))
if (!ok) process.exitCode = 1
