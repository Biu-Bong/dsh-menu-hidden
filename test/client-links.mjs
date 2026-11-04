// 外链只跳一次的回归测试：
//   浏览器 UA  → JS 完全不插手，交给 <a target="_blank">（只开一个新标签）
//   Electron UA → 拦掉默认跳转，改走 location.href（主进程 will-navigate 接住，shell.openExternal）
// 跑法：node test/client-links.mjs client.js
import fs from 'node:fs'
import { JSDOM, VirtualConsole } from 'jsdom'
import React from 'react'
import { createRoot } from 'react-dom/client'

const CLIENT = process.argv[2] ?? 'client.js'
const SOURCE = fs.readFileSync(CLIENT, 'utf8')

const UA_BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const UA_ELECTRON = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) dsh/0.2.1 Chrome/140.0.0.0 Electron/40.0.0 Safari/537.36'

async function run(userAgent) {
  const navs = []
  const vc = new VirtualConsole()
  vc.on('jsdomError', (e) => { if (String(e.message).includes('navigation')) navs.push(String(e.message)) })
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
    url: 'http://127.0.0.1:1/', pretendToBeVisual: true, virtualConsole: vc,
  })
  const { window } = dom
  for (const k of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'localStorage', 'getComputedStyle', 'requestAnimationFrame']) {
    globalThis[k] = window[k]
  }
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent }, configurable: true })

  let openCalls = 0
  window.open = () => { openCalls += 1; return null }
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ ok: true, found: false, levels: [], providers: [], current: '0.0.0', latest: '0.0.0', hasUpdate: false }),
  })
  window.fetch = globalThis.fetch

  let mod = null
  window.__ModuleLoader__ = {
    load: ({ factory }) => {
      mod = factory((n) => (n === 'react' ? React : new Proxy(function () {}, { get: () => new Proxy(function () {}, {}), apply: () => null })))
    },
  }
  new Function(SOURCE)()

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
  await new Promise((r) => setTimeout(r, 200))

  const pill = window.document.querySelector('a.dshmh-pill')
  const evt = new window.MouseEvent('click', { bubbles: true, cancelable: true })
  pill.dispatchEvent(evt)
  await new Promise((r) => setTimeout(r, 20))
  root.unmount()
  return { openCalls, navigations: navs.length, defaultPrevented: evt.defaultPrevented }
}

const browser = await run(UA_BROWSER)
const electron = await run(UA_ELECTRON)

console.log(JSON.stringify({ browser, electron }, null, 2))

// 浏览器：JS 一次 window.open 都不调，也不拦默认跳转（默认行为由浏览器自己开新标签）。
// Electron：拦下默认跳转（defaultPrevented true），改走 location.href，只发生一次跳转。
const ok = browser.openCalls === 0 && browser.defaultPrevented === false
  && electron.openCalls === 0 && electron.defaultPrevented === true && electron.navigations === 1
console.log(ok ? 'PASS: 每次点击只发生一次跳转' : 'FAIL: 仍然有重复跳转')
process.exitCode = ok ? 0 : 1
