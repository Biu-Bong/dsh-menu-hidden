import fs from 'node:fs'
import { JSDOM } from 'jsdom'

const file = process.argv[2]
const html = `<!doctype html><html><body>
<ul id="rows">
  <li class="h1_rowCard" id="accountRow"><div class="h1_rowHead"><span class="h1_rowIdentity"><span class="h1_rowName">DeepSeek 账号</span><span class="h1_accountStatus">已登录</span></span><span class="h1_rowActions">编辑 删除</span></div></li>
  <li class="h1_rowCard" id="officialRow"><div class="h1_rowHead"><span class="h1_rowIdentity"><span class="h1_rowName">DeepSeek</span></span><span class="h1_rowActions">编辑 删除</span></div></li>
  <li class="h1_rowCard" id="openaiRow"><div class="h1_rowHead"><span class="h1_rowIdentity"><span class="h1_rowName">OpenAI</span></span></div></li>
</ul>
<div id="menuHost"></div>
<button type="button" class="n1_newSession" id="navNewSession"><span class="n1_newSessionContent"><span class="n1_newSessionLabel">新会话</span></span></button>
<nav class="n1_nav" aria-label="全局面板" id="sideNav">
  <button type="button" class="n1_panelRow" id="navPlugins" aria-label="插件"><span class="n1_panelGlyph"></span><span class="n1_panelTitle">插件</span></button>
  <button type="button" class="n1_panelRow" id="navSchedules" aria-label="定时任务"><span class="n1_panelGlyph"></span><span class="n1_panelTitle">定时任务</span></button>
  <button type="button" class="n1_panelRow" id="navArchive" aria-label="归档会话"><span class="n1_panelGlyph"></span><span class="n1_panelTitle">归档会话</span></button>
  <button type="button" class="n1_panelRow" id="navMore" aria-label="更多" aria-haspopup="menu"><span class="n1_panelGlyph"></span><span class="n1_panelTitle">更多</span></button>
</nav>
<fieldset class="s1_models" id="subagentList">
  <legend>Agent 可选择的模型</legend>
  <div class="s1_modelGroup" id="sgAccount"><div class="s1_providerName">DeepSeek Account</div><label class="s1_model"><input type="checkbox" checked><span class="s1_modelName">DeepSeek-V4-Pro</span><span class="s1_route">DeepSeek Account · deepseek-account/deepseek-v4-pro</span></label></div>
  <div class="s1_modelGroup" id="sgOfficial"><div class="s1_providerName">DeepSeek</div><label class="s1_model"><input type="checkbox"><span class="s1_modelName">DeepSeek-V4.1-Flash</span><span class="s1_route">DeepSeek · deepseek-official/deepseek-flash</span></label></div>
  <div class="s1_modelGroup" id="sgOpenai"><div class="s1_providerName">OpenAI</div><label class="s1_model"><input type="checkbox"><span class="s1_modelName">GPT 6 Astra</span><span class="s1_route">OpenAI · openai/gpt-6-astra</span></label></div>
</fieldset>
<div id="acctMenu" role="menu" data-menu-material>
  <div role="presentation"><button role="menuitem">设置</button></div>
  <div role="presentation"><button role="menuitem">意见反馈</button></div>
  <div role="presentation"><button role="menuitem">退出登录</button></div>
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

// 记录 ModuleLoader 拿到的模块
let mod = null
window.__ModuleLoader__ = { load: ({ factory }) => { mod = factory((name) => requireStub(name)) } }

const stubFn = function () {}
const requireStub = () => new Proxy(stubFn, {
  get: (_t, k) => (k === 'default' ? {} : k === '__esModule' ? true : new Proxy(stubFn, {})),
  apply: () => null,
})

new Function(fs.readFileSync(file, 'utf8'))()

const hidden = (id) => {
  const el = window.document.getElementById(id)
  return el.style.display === 'none'
}

// 假 ctx：slots / locale
const registered = []
const ctx = {
  get(name) {
    if (name === 'slots') {
      return {
        inject: (slot, fn) => fn(),
        register: (opts, comp) => { registered.push(opts); return () => {} },
      }
    }
    if (name === 'locale') {
      return { register() {}, bind: () => (key) => key }
    }
    return null
  },
  effect(fn) { const d = fn(); return () => { if (typeof d === 'function') d() } },
  on() {},
}

mod.apply(ctx)
await new Promise((r) => setTimeout(r, 30))

const before = {
  accountRow: hidden('accountRow'),
  officialRow: hidden('officialRow'),
  openaiRow: hidden('openaiRow'),
  feedback: window.document.querySelectorAll('[role="menuitem"]')[1].style.display === 'none',
  signOut: window.document.querySelectorAll('[role="menuitem"]')[2].style.display === 'none',
  settingsKept: window.document.querySelectorAll('[role="menuitem"]')[0].style.display !== 'none',
  slot: registered.map((r) => r.id).join(','),
  subagentAccount: hidden('sgAccount'),
  subagentOfficial: hidden('sgOfficial'),
  subagentOpenai: hidden('sgOpenai'),
  navPlugins: hidden('navPlugins'),
  navSchedules: hidden('navSchedules'),
  navMore: hidden('navMore'),
  navArchive: hidden('navArchive'),
  navNewSession: hidden('navNewSession'),
}

// 再往菜单里追加一组，验证观察器同步生效（模拟点开菜单）
const host = window.document.getElementById('menuHost')
host.innerHTML = `<section data-menu-group><div data-menu-group-heading>DeepSeek 账号</div><button role="menuitemradio">DeepSeek-V4-Pro</button></section>
<section data-menu-group><div data-menu-group-heading>OpenAI</div><button role="menuitemradio">GPT 6 Astra</button></section>`
await new Promise((r) => setTimeout(r, 30))
const groups = [...window.document.querySelectorAll('section[data-menu-group]')].map((s) => ({
  name: s.querySelector('[data-menu-group-heading]').textContent,
  hidden: s.style.display === 'none',
}))

console.log(JSON.stringify({ before, groups }, null, 2))
