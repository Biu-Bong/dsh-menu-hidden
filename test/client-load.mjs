import fs from 'node:fs'
const file = process.argv[2]
const src = fs.readFileSync(file, 'utf8')

const stub = new Proxy(function () {}, {
  get: (_t, k) => (k === 'default' ? {} : k === '__esModule' ? true : stub),
  apply: () => stub,
  construct: () => stub,
})

let loaded = null
globalThis.window = {
  __ModuleLoader__: {
    load({ id, factory }) {
      loaded = { id, module: factory(stub) }
    },
  },
  location: { reload() {}, origin: 'http://example.invalid' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: undefined,
}
globalThis.document = { body: null, addEventListener() {}, documentElement: null }
globalThis.localStorage = globalThis.window.localStorage
globalThis.fetch = async () => ({ ok: false, json: async () => null })

try {
  new Function(src)()
  const m = loaded?.module
  // 回归守卫：模块导出上不许有顶层 inject。
  // web boot 只要发现一条 entry 不是 active 就 `throw new Error("web boot: N entries did not activate")`，
  // 顶层 inject 一旦缺服务就是 pending，等于整个前端白屏。依赖必须走 scoped ctx.inject。
  const topLevelInject = m?.inject
  console.log(JSON.stringify({
    evaluated: true,
    id: loaded?.id,
    hasApply: typeof m?.apply === 'function',
    inject: topLevelInject,
    bootSafe: topLevelInject === undefined,
  }))
  if (topLevelInject !== undefined) {
    console.error('FAIL: 模块导出上出现了顶层 inject，缺服务时会拖垮 web boot')
    process.exitCode = 1
  }
} catch (error) {
  console.log(JSON.stringify({ evaluated: false, error: `${error.name}: ${error.message}` }))
  process.exitCode = 1
}
