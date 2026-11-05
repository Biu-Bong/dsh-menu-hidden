#!/usr/bin/env node
/**
 * patch-shell-menu.mjs —— 给 DeepSeek Harness 外壳打开「刷新页面 / 重启应用与 Host」两项。
 *
 * 背景：官方本来就有这两项，只是 lib/main.js 的 applicationItems() 里挂在
 * `...development ? [...] : []` 后面，打包版 development === false 就整段丢掉。
 * 这里只把那个条件改成恒真，别的一个字不动。幂等、留备份、可还原。
 *
 * 用法：
 *   node patch-shell-menu.mjs --status                 # 看状态（默认动作）
 *   node patch-shell-menu.mjs --apply                  # 写入
 *   node patch-shell-menu.mjs --revert                 # 还原
 *   node patch-shell-menu.mjs --apply --file <main.js> # 指定别的文件（测试用）
 *   node patch-shell-menu.mjs --apply --dry-run        # 只算不写
 */
import { existsSync, readFileSync } from 'node:fs'
import { copyFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const MARK_ORIGINAL = '...development ? ['
/** 0.2.28 起写入的样子：条件里嵌了「插件还在不在」的运行时自检，卸载后自动失活。 */
const MARK_PATCHED = '...(development || (function(){try{const h=process.env.DSH_HOME||join(homedir(),".dsh");const d=join(h,"profiles");for(const n of readdirSync(d)){if(n.charAt(0)==="_")continue;if(existsSync(join(d,n,"node_modules","dsh-menu-hidden","package.json")))return true}return false}catch{return false}})()) ? ['
/** 0.2.26–0.2.27 写进去的老样子：条件恒真。 */
const MARK_PATCHED_LEGACY = '...(development || true) ? ['
const BACKUP_SUFFIX = '.menuhidden.bak'
const SHELL_MARK = 'applicationItems'

const args = process.argv.slice(2)

/**
 * 读一个 `--name value` 参数。
 * @param {string} name - 参数名。
 * @returns {string | undefined} 值。
 */
function argValue(name) {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

const has = (name) => args.includes(name)
const dryRun = has('--dry-run')

/**
 * 猜外壳 main.js 的位置。
 * @returns {string | null} 绝对路径。
 */
function guessFile() {
  const explicit = argValue('--file')
  if (explicit !== undefined) return resolve(explicit)
  const candidates = [
    process.env.DSH_SHELL_MAIN_JS,
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness', 'resources', 'app', 'lib', 'main.js'),
    process.env.ProgramFiles && join(process.env.ProgramFiles, 'DeepSeek Harness', 'resources', 'app', 'lib', 'main.js'),
    join(process.cwd(), '..', 'lib', 'main.js'),
  ].filter((candidate) => typeof candidate === 'string' && candidate !== '')
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate) && readFileSync(candidate, 'utf8').includes(SHELL_MARK)) return resolve(candidate)
    } catch {
      /* 下一个 */
    }
  }
  return null
}

const file = guessFile()
if (file === null) {
  console.error('没找到外壳 main.js，用 --file <绝对路径> 指定。')
  process.exit(2)
}
if (!existsSync(file)) {
  console.error(`文件不存在：${file}`)
  process.exit(2)
}

const text = readFileSync(file, 'utf8')
const originalHits = text.split(MARK_ORIGINAL).length - 1
const patchedHits = text.split(MARK_PATCHED).length - 1
const legacyHits = text.split(MARK_PATCHED_LEGACY).length - 1
const patched = patchedHits > 0 || legacyHits > 0

const report = {
  file,
  patched,
  mode: patchedHits > 0 ? 'self-check' : legacyHits > 0 ? 'always' : null,
  originalHits,
  patchedHits,
  legacyHits,
  backup: file + BACKUP_SUFFIX,
  backupExists: existsSync(file + BACKUP_SUFFIX),
}

if (has('--apply') || has('--revert')) {
  const enable = has('--apply')
  if (enable && originalHits !== 1 && legacyHits !== 1) {
    console.error(JSON.stringify({ ...report, ok: false, error: `定位失败：原样标记命中 ${originalHits} 处（期望 1 处）` }, null, 2))
    process.exit(3)
  }
  if (!enable && patchedHits !== 1 && legacyHits !== 1) {
    console.error(JSON.stringify({ ...report, ok: false, error: `定位失败：补丁标记命中 ${patchedHits} + ${legacyHits} 处（期望其中一版 1 处）` }, null, 2))
    process.exit(3)
  }
  const source = enable ? (legacyHits === 1 ? MARK_PATCHED_LEGACY : MARK_ORIGINAL) : (patchedHits === 1 ? MARK_PATCHED : MARK_PATCHED_LEGACY)
  const target = enable ? MARK_PATCHED : MARK_ORIGINAL
  const next = text.replace(source, target)
  if (dryRun) {
    console.log(JSON.stringify({ ...report, ok: true, dryRun: true, bytes: next.length }, null, 2))
    process.exit(0)
  }
  if (enable && !existsSync(file + BACKUP_SUFFIX)) await copyFile(file, file + BACKUP_SUFFIX)
  // 原子换：先写同目录临时文件再改名，避免写一半把外壳入口截断（截断 = 下次启动白屏）。
  const staged = file + '.menuhidden.tmp'
  try {
    await writeFile(staged, next, 'utf8')
    await rename(staged, file)
  } catch (error) {
    await unlink(staged).catch(() => {})
    throw error
  }
  const after = readFileSync(file, 'utf8')
  const afterSelf = after.split(MARK_PATCHED).length - 1
  const afterLegacy = after.split(MARK_PATCHED_LEGACY).length - 1
  console.log(JSON.stringify({
    ...report,
    patched: afterSelf > 0 || afterLegacy > 0,
    mode: afterSelf > 0 ? 'self-check' : afterLegacy > 0 ? 'always' : null,
    ok: true,
    wrote: enable ? 'patched' : 'reverted',
  }, null, 2))
  process.exit(0)
}

console.log(JSON.stringify({ ...report, ok: true, action: 'status' }, null, 2))
