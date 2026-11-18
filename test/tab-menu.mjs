import fs from 'node:fs'
import { JSDOM } from 'jsdom'

const file = process.argv[2] ?? new URL('../client.js', import.meta.url).pathname
const html = `<!doctype html><html><body>
<div class="tabStrip" role="tablist" data-dockkit-strip="pane1">
  <div class="stripTabs" data-dockkit-strip-tabs="pane1">
    <div role="tab" data-dockkit-tab="tab1" aria-selected="false" tabindex="-1">
      <span data-dockkit-tab-title="true">我的遇见</span>
      <button type="button" class="tabClose" aria-label="关闭" data-dockkit-tab-close="tab1">x</button>
    </div>
    <div role="tab" data-dockkit-tab="tab2" aria-selected="true" tabindex="0">
      <span data-dockkit-tab-title="true">post.so</span>
      <button type="button" class="tabClose" aria-label="关闭" data-dockkit-tab-close="tab2">x</button>
    </div>
    <div role="tab" data-dockkit-tab="tab3" aria-selected="false" tabindex="-1">
      <span data-dockkit-tab-title="true">01-官方</span>
      <button type="button" class="tabClose" aria-label="关闭" data-dockkit-tab-close="tab3">x</button>
    </div>
  </div>
</div>
</body></html>`

const dom = new JSDOM(html, { url: 'http://example.invalid/' })
const { window } = dom
globalThis.window = window
globalThis.document = window.document
globalThis.Element = window.Element
globalThis.Node = window.Node
globalThis.MutationObserver = window.MutationObserver
globalThis.localStorage = window.localStorage
globalThis.KeyboardEvent = window.KeyboardEvent
globalThis.PointerEvent = window.PointerEvent ?? window.MouseEvent
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({ ok: false, error: 'stub' }) })
window.fetch = globalThis.fetch
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0)
window.requestAnimationFrame = globalThis.requestAnimationFrame

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
    if (name === 'slots') return { inject: () => () => {}, register: () => () => {} }
    if (name === 'locale') return { register() {}, bind: () => (key) => key }
    return null
  },
  effect(fn) { const d = fn(); return () => { if (typeof d === 'function') d() } },
  on() {},
}
mod.apply(ctx)
await new Promise((r) => setTimeout(r, 20))

const clicks = []
for (const id of ['tab1', 'tab2', 'tab3']) {
  window.document.querySelector(`[data-dockkit-tab-close="${id}"]`)
    .addEventListener('click', () => clicks.push(id))
}

/** 模拟：右键某个标签 → React 在同一轮提交里把菜单 portal 到 body。 */
async function openMenu(tabId) {
  const tab = window.document.querySelector(`[data-dockkit-tab="${tabId}"]`)
  tab.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  // React 的 onContextMenu 在这一轮事件结束后 commit，这里用 0ms 模仿
  await new Promise((r) => setTimeout(r, 0))
  const menu = window.document.createElement('div')
  menu.setAttribute('role', 'menu')
  menu.setAttribute('data-dockkit-tab-menu', 'true')
  menu.innerHTML = '<button type="button" role="menuitem" data-dockkit-menu-close>关闭</button>'
  window.document.body.appendChild(menu)
  await new Promise((r) => setTimeout(r, 120))
  return menu
}

const results = {}
for (const tabId of ['tab1', 'tab2', 'tab3']) {
  const menu = await openMenu(tabId)
  const items = [...menu.querySelectorAll('[data-dshmh-tabmenu-item]')].map((node) => ({
    key: node.getAttribute('data-dshmh-tabmenu-item'),
    text: node.textContent,
    disabled: node.getAttribute('aria-disabled') === 'true',
  }))
  results[tabId] = { total: menu.children.length, items }
  if (tabId === 'tab2') {
    clicks.length = 0
    menu.querySelector('[data-dshmh-tabmenu-item="tabMenuCloseOthers"]').click()
    results.clickedOthers = [...clicks]
  }
  if (tabId === 'tab1') {
    clicks.length = 0
    menu.querySelector('[data-dshmh-tabmenu-item="tabMenuCloseRight"]').click()
    results.clickedRight = [...clicks]
  }
  if (tabId === 'tab3') {
    clicks.length = 0
    menu.querySelector('[data-dshmh-tabmenu-item="tabMenuCloseAll"]').click()
    results.clickedAll = [...clicks]
  }
  menu.remove()
  await new Promise((r) => setTimeout(r, 10))
}

// 补一条：第二次右键同一个菜单节点不应重复补（用新菜单验证 mark 生效）
console.log(JSON.stringify(results, null, 2))
