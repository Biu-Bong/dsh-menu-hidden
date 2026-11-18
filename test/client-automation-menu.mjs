// 第三方定时任务插件的模型下拉框：DeepSeek 账号 / 官方 API 两组要整块藏，
// 第三方分组原样留着；不带 dsh-st-form-menu 的菜单一个像素都不许动。
import fs from 'node:fs'
import { JSDOM } from 'jsdom'

const file = process.argv[2]
const html = `<!doctype html><html><body>
<div id="host"></div>
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

// 真结构：role="menu" + 插件传的字面类名 dsh-st-form-menu，里面 viewport 是 role="presentation"，
// 分组标题是 div[role="presentation"]，选项是它后面的兄弟 div > button[role="menuitem"]。
const menuHTML = `
<div role="menu" class="_list_abc dsh-st-form-menu dense" id="autoMenu">
  <div role="presentation" class="_viewport_abc">
    <div role="presentation" class="_label_abc" id="lblAccount">DeepSeek 账号</div>
    <div class="_itemWrap_abc"><button type="button" role="menuitem" id="acctA">DeepSeek-V4.1-Flash 1017</button></div>
    <div class="_itemWrap_abc"><button type="button" role="menuitem" id="acctB">DeepSeek-V4-Pro</button></div>
    <div role="presentation" class="_label_abc" id="lblOfficial">DeepSeek</div>
    <div class="_itemWrap_abc"><button type="button" role="menuitem" id="offA">DeepSeek-V4.1-Flash 1017</button></div>
    <div class="_itemWrap_abc"><button type="button" role="menuitem" id="offB">DeepSeek-V4-Pro</button></div>
    <div role="presentation" class="_label_abc" id="lblWork">ThirdParty</div>
    <div class="_itemWrap_abc"><button type="button" role="menuitem" id="workA">Auto</button></div>
  </div>
</div>
<div role="menu" class="_list_other" id="otherMenu">
  <div role="presentation" class="_viewport_other">
    <div role="presentation" class="_label_other" id="lblOtherDeepSeek">DeepSeek</div>
    <div class="_itemWrap_other"><button type="button" role="menuitem" id="otherA">随便一个模型</button></div>
  </div>
</div>`
window.document.getElementById('host').innerHTML = menuHTML
// 菜单壳会被按住两帧（jsdom 没有 rAF 时是 2×16ms）再放开，等够 250ms 再断言。
await new Promise((r) => setTimeout(r, 250))

const hidden = (id) => {
  const el = window.document.getElementById(id)
  return el.style.display === 'none'
}
// 选项的 display:none 打在 itemWrap 上，按钮自己不带样式。
const hiddenItem = (id) => {
  const el = window.document.getElementById(id)
  return el.parentElement.style.display === 'none'
}

const result = {
  accountLabel: hidden('lblAccount'),
  accountModels: [hiddenItem('acctA'), hiddenItem('acctB')],
  officialLabel: hidden('lblOfficial'),
  officialModels: [hiddenItem('offA'), hiddenItem('offB')],
  thirdPartyLabel: hidden('lblWork'),
  thirdPartyModel: hiddenItem('workA'),
  otherMenuDeepSeek: hidden('lblOtherDeepSeek'),
  otherMenuModel: hiddenItem('otherA'),
  menuVisible: window.document.getElementById('autoMenu').style.visibility !== 'hidden',
}

const failures = []
if (result.accountLabel !== true) failures.push('账号分组标题没藏')
if (result.accountModels.some((v) => v !== true)) failures.push('账号分组的模型没跟着藏')
if (result.officialLabel !== true) failures.push('官方 API 分组标题没藏')
if (result.officialModels.some((v) => v !== true)) failures.push('官方 API 分组的模型没跟着藏')
if (result.thirdPartyLabel !== false || result.thirdPartyModel !== false) failures.push('第三方分组被误伤')
if (result.otherMenuDeepSeek !== false || result.otherMenuModel !== false) failures.push('非定时任务菜单被误伤')
if (result.menuVisible !== true) failures.push('菜单壳的 visibility 没还回去')

console.log(JSON.stringify(result, null, 2))
if (failures.length > 0) {
  console.error('FAIL: ' + failures.join('；'))
  process.exit(1)
}
console.log('OK 定时任务模型下拉框两组已按标题整块隐藏')
