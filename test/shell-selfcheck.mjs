// 验证 0.2.28 的自愈补丁：写进 main.js 的那段条件真的会「插件在=开、插件不在=关」。
// 用法：node test/shell-selfcheck.mjs
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const cliPath = path.join(root, 'shell', 'patch-shell-menu.mjs')

let failures = 0
const check = (name, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` → got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`)
}

// ---- 1) 从 CLI 里抠出补丁标记，确认它是自检版 ----
const cliSource = fs.readFileSync(cliPath, 'utf8')
const matched = /const MARK_PATCHED = '([^']+)'/.exec(cliSource)
check('标记存在', Boolean(matched), true)
const marker = matched[1]
check('标记是自检版（不是恒真）', marker.includes('dsh-menu-hidden') && !marker.includes('development || true'), true)

const inner = /\.\.\.\(development \|\| (.*)\) \? \[$/.exec(marker)
check('能从标记里取出表达式', Boolean(inner), true)

// ---- 2) 用假 DSH_HOME 跑那段表达式 ----
const expression = inner[1]
const evaluate = (dshHome) => {
  const fn = new Function(
    'process',
    'join',
    'homedir',
    'readdirSync',
    'existsSync',
    `return ${expression}`,
  )
  return fn({ env: { DSH_HOME: dshHome } }, path.join, os.homedir, fs.readdirSync, fs.existsSync)
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'menuhidden-selfcheck-'))
const home = path.join(sandbox, 'dshhome')
const profiles = path.join(home, 'profiles')
const installInto = (profile) => {
  const dir = path.join(profiles, profile, 'node_modules', 'dsh-menu-hidden')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"dsh-menu-hidden","version":"0.2.28"}\n', 'utf8')
}

fs.mkdirSync(profiles, { recursive: true })
check('空 profiles → 关', evaluate(home), false)

installInto('desktop')
check('插件在 desktop → 开', evaluate(home), true)

fs.rmSync(path.join(profiles, 'desktop'), { recursive: true, force: true })
check('卸载后 → 关（这就是自愈）', evaluate(home), false)

installInto('_disabled')
check('_ 开头的 profile 不算', evaluate(home), false)

installInto('work')
check('装在别的 profile 也算', evaluate(home), true)

check('DSH_HOME 不存在 → 关且不抛', evaluate(path.join(sandbox, 'nope')), false)

// ---- 3) CLI 真跑一遍 apply / revert，文件必须逐字节还原 ----
const fakeMain = path.join(sandbox, 'main.js')
const original = [
  'const development = false',
  'const items = [',
  '  ...development ? [',
  "    { label: '刷新页面' },",
  "    { label: '重启应用与 Host' },",
  '  ] : [],',
  ']',
  '',
].join('\n')
fs.writeFileSync(fakeMain, original, 'utf8')

const run = (...args) => execFileSync(process.execPath, [cliPath, ...args], { encoding: 'utf8' })

const applied = JSON.parse(run('--apply', '--file', fakeMain))
check('apply ok', applied.ok, true)
check('apply 后是自检模式', applied.mode, 'self-check')
const patchedText = fs.readFileSync(fakeMain, 'utf8')
check('apply 后真的写进了自检代码', patchedText.includes('node_modules'), true)
check('apply 后把插件装到当前 DSH_HOME 会返回 true', (() => {
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  const value = evaluate(home)
  if (previous === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = previous
  return value
})(), true)

const reverted = JSON.parse(run('--revert', '--file', fakeMain))
check('revert ok', reverted.ok, true)
check('revert 后逐字节等于原始文件', fs.readFileSync(fakeMain, 'utf8') === original, true)

// 老版本（恒真）也要能被识别和还原
fs.writeFileSync(fakeMain, original.replace('...development ? [', '...(development || true) ? ['), 'utf8')
const legacyState = JSON.parse(run('--file', fakeMain))
check('老补丁被识别成 always', legacyState.mode, 'always')
const legacyReverted = JSON.parse(run('--revert', '--file', fakeMain))
check('老补丁能还原', legacyReverted.ok, true)
check('老补丁还原后逐字节一致', fs.readFileSync(fakeMain, 'utf8') === original, true)

fs.rmSync(sandbox, { recursive: true, force: true })
console.log(JSON.stringify({ ok: failures === 0, failures }))
process.exit(failures === 0 ? 0 : 1)
