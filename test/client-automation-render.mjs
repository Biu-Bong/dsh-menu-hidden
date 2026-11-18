// 设置页烟测：SSR 渲一遍，确认「定时任务」这一组和两个开关真的在 DOM 里，
// 并且默认是开着的（面板点开就能看到，不需要先去别处找）。
import fs from 'node:fs'
import { JSDOM } from 'jsdom'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const file = process.argv[2]
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://example.invalid/', pretendToBeVisual: true })
const { window } = dom
globalThis.window = window
globalThis.document = window.document
globalThis.MutationObserver = window.MutationObserver
globalThis.localStorage = window.localStorage
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({ ok: false, error: 'stub' }) })
window.fetch = globalThis.fetch

let mod = null
let component = null
window.__ModuleLoader__ = {
  load: ({ factory }) => {
    mod = factory((name) => {
      if (name === 'react') return React
      // 拿不到官方组件库时插件会退回原生 input[type=checkbox]，开关状态才看得见。
      if (name === '@deepseek-ai/dsh-client-ui-primitives') return null
      return new Proxy(function () {}, { get: () => new Proxy(function () {}, {}), apply: () => null })
    })
  },
}
new Function(fs.readFileSync(file, 'utf8'))()

const ctx = {
  inject(_deps, callback) { callback(this) },
  get(name) {
    if (name === 'slots') {
      return {
        inject: (_slot, fn) => fn(),
        register: (opts, comp) => { component = comp; return () => {} },
      }
    }
    if (name === 'locale') return { register() {}, bind: () => (key) => key }
    return null
  },
  effect(fn) { const d = fn(); return () => { if (typeof d === 'function') d() } },
  on() {},
}

mod.apply(ctx)
await new Promise((r) => setTimeout(r, 30))

if (component === null) {
  console.error('FAIL: 设置页组件没注册')
  process.exit(1)
}

let html = ''
try {
  html = renderToStaticMarkup(React.createElement(component))
} catch (error) {
  console.error('FAIL: 设置页渲染抛错 ' + String((error && error.stack) || error))
  process.exit(1)
}

const at = (text) => html.indexOf(text)
const checks = {
  accountLabel: html.includes('隐藏定时任务里的「DeepSeek 账号」分组'),
  officialLabel: html.includes('隐藏定时任务里的「DeepSeek官方 API」分组'),
  accountHint: html.includes('「编辑定时任务」对话框里那个模型下拉框'),
  // 不单列分组：两个开关紧跟在「DeepSeek官方 API」开关后面，再往后才是子智能体那两项。
  inlineAfterOfficial: at('隐藏「DeepSeek官方 API」分组') < at('隐藏定时任务里的「DeepSeek 账号」分组') && at('隐藏定时任务里的「DeepSeek 账号」分组') < at('隐藏定时任务里的「DeepSeek官方 API」分组') && at('隐藏定时任务里的「DeepSeek官方 API」分组') < at('隐藏子智能体里的「DeepSeek Account」'),
  officialHint: html.includes('同一个下拉框里官方 API 那一组'),
  // 开关默认开：渲染出来的复选框带 checked
  switchesOn: (html.match(/<input[^>]*type="checkbox"[^>]*checked/g) ?? []).length >= 2,
}

const failures = Object.entries(checks).filter(([, ok]) => ok !== true).map(([name]) => name)
console.log(JSON.stringify(checks, null, 2))
if (failures.length > 0) {
  console.error('FAIL: ' + failures.join('、'))
  process.exit(1)
}
console.log('OK 两个开关并进「模型选择框」组，排在官方 API 开关后面，默认开着')
