import fs from 'node:fs'
import { JSDOM, VirtualConsole } from 'jsdom'
import React from 'react'
import { createRoot } from 'react-dom/client'

const navs = []
const vc = new VirtualConsole()
vc.on('jsdomError', (e) => { if (String(e.message).includes('navigation')) navs.push(String(e.message)) })
const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://127.0.0.1:1/', pretendToBeVisual: true, virtualConsole: vc })
const { window } = dom
for (const k of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'localStorage', 'getComputedStyle', 'requestAnimationFrame']) globalThis[k] = window[k]

let updateCalls = 0
let openCalls = 0
let openReturn = {}
window.open = () => { openCalls += 1; return openReturn }

globalThis.fetch = async (url) => {
  if (String(url).includes('/update')) {
    updateCalls += 1
    return { ok: true, status: 200, json: async () => ({ ok: true, current: '0.2.10', latest: '0.2.10', hasUpdate: false }) }
  }
  return { ok: true, status: 200, json: async () => ({ ok: true, found: false, levels: [], global: null, overrides: {}, providers: [] }) }
}
window.fetch = globalThis.fetch

let mod = null
window.__ModuleLoader__ = { load: ({ factory }) => { mod = factory((n) => (n === 'react' ? React : new Proxy(function () {}, { get: () => new Proxy(function () {}, {}), apply: () => null }))) } }
new Function(fs.readFileSync(process.argv[2], 'utf8'))()

let Section = null
mod.apply({
  get(n) {
    if (n === 'slots') return { inject: (slot, fn) => fn(), register: (o, c) => { Section = c; return () => {} } }
    if (n === 'locale') return { register() {}, bind: () => (k) => k }
    return null
  },
  effect(fn) { const d = fn(); return () => { if (typeof d === 'function') d() } },
  on() {},
})

const root = createRoot(window.document.getElementById('app'))
root.render(React.createElement(Section))
await new Promise((r) => setTimeout(r, 250))

const doc = window.document
const pills = [...doc.querySelectorAll('a.dshmh-pill')]
const beforeOpen = openCalls
pills[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
const afterFirst = { openCalls: openCalls - beforeOpen, navigations: navs.length }

openReturn = null
pills[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }))
const afterSecond = { navigations: navs.length }

console.log(JSON.stringify({
  updateCallsAfterMount: updateCalls,
  pillCount: pills.length,
  openSuccess: afterFirst,
  openBlocked: afterSecond,
}, null, 2))
