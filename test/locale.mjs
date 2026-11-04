// 模拟 DSH locale 服务的解析规则（lib/client.js:1243）：
//   lookup 走 active 的声明回退链，键名是 localeKey(active) = 小写原样，最后落到 dict.en。
// 用来验：active 是 zh-CN 时不会再掉进英文；热重载重复注册不会把 t 废掉。
import fs from 'node:fs'
import { JSDOM } from 'jsdom'

const file = process.argv[2]
if (file === undefined) {
  console.error('用法: node test/locale.mjs <client.js 路径>')
  process.exit(1)
}
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://example.invalid/', pretendToBeVisual: true })
for (const k of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'localStorage', 'getComputedStyle', 'requestAnimationFrame']) globalThis[k] = dom.window[k]

function makeLocale(active) {
  const store = new Map() // `${ns}@${locale}` -> dict
  let registered = 0
  return {
    store,
    get throttled() { return registered },
    getSnapshot: () => ({ active, locales: [], revision: registered }),
    register(ns, a, b) {
      if (typeof a === 'string') {
        const key = `${ns}@${a.toLowerCase()}`
        if (store.has(key)) throw new Error(`locale namespace "${ns}" already has locale "${a}"`)
        store.set(key, b)
        registered += 1
        return () => {}
      }
      // 老的两参形式：{ zh, en }
      for (const [loc, dict] of Object.entries(a)) store.set(`${ns}@${loc.toLowerCase()}`, dict)
      return () => {}
    },
    bind(ns) {
      return (key) => {
        const chain = [...new Set([active.toLowerCase(), 'en'])]
        let value
        for (let i = chain.length - 1; i >= 0; i -= 1) value = (store.get(`${ns}@${chain[i]}`) ?? {})[key] ?? value
        return value ?? key
      }
    },
  }
}

function loadClient() {
  let mod = null
  dom.window.__ModuleLoader__ = { load: ({ factory }) => { mod = factory(() => new Proxy(function () {}, { get: () => new Proxy(function () {}, {}), apply: () => null })) } }
  new Function(fs.readFileSync(file, 'utf8'))()
  return mod
}

function boot(active) {
  const locale = makeLocale(active)
  let label = null
  const mod = loadClient()
  mod.apply({
    get(n) {
      if (n === 'locale') return locale
      if (n === 'slots') return { inject: (slot, fn) => { fn(); return () => {} }, register: (def) => { label = def.label; return () => {} } }
      return null
    },
    effect(fn) { fn(); return () => {} },
    on() {},
  })
  return { locale, label: label(), mod }
}

const out = {}
out.zhCN = boot('zh-CN').label
out.zhHans = boot('zh-Hans').label
out.zh = boot('zh').label
out.en = boot('en').label

// 热重载：同一进程里再 apply 一遍，注册会抛（重复），翻译函数必须还活着
const first = boot('zh-CN')
let secondLabel = null
first.mod.apply({
  get(n) {
    if (n === 'locale') return first.locale
    if (n === 'slots') return { inject: (slot, fn) => { fn(); return () => {} }, register: (def) => { secondLabel = def.label(); return () => {} } }
    return null
  },
  effect(fn) { fn(); return () => {} },
  on() {},
})
out.reload = secondLabel
out.registered = [...first.locale.store.keys()].sort()

console.log(JSON.stringify(out, null, 1))
