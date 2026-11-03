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
  location: { reload() {}, origin: 'http://127.0.0.1:1' },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  document: undefined,
}
globalThis.document = { body: null, addEventListener() {}, documentElement: null }
globalThis.localStorage = globalThis.window.localStorage
globalThis.fetch = async () => ({ ok: false, json: async () => null })

try {
  new Function(src)()
  const m = loaded?.module
  console.log(JSON.stringify({
    evaluated: true,
    id: loaded?.id,
    hasApply: typeof m?.apply === 'function',
    inject: m?.inject,
  }))
} catch (error) {
  console.log(JSON.stringify({ evaluated: false, error: `${error.name}: ${error.message}` }))
}
