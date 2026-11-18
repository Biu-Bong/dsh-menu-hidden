#!/usr/bin/env node
/**
 * patch-shell-menu.mjs —— 给 DeepSeek Harness 外壳打开「刷新页面 / 重启应用与 Host」两项。
 *
 * 背景：官方本来就有这两项，只是 lib/main.js 的 applicationItems() 里挂在
 * `...development ? [...] : []` 后面，打包版 development === false 就整段丢掉。
 * 这里只把那个条件改成自检版，别的一个字不动。幂等、可还原。
 *
 * 两种安装布局都认：
 *   - 解包布局（0.2.1 及以前）：`resources/app/lib/main.js` 是普通文件，直接改，留 .bak。
 *   - asar 布局（0.2.2 起）：`resources/app.asar/lib/main.js` 在归档里。
 *     归档正文一个字节不动，改成写 Electron 的 unpacked 覆盖层
 *     （`app.asar.unpacked/lib/main.js` + 头部条目 `unpacked: true`），
 *     所以还原 = 删覆盖文件，必然回到官方原样；代价是**改完要重启应用**。
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
import { join, resolve } from 'node:path'
import { clearOverride, hasAsarEntry, isBrokenOverride, isOverridden, readEffectiveText, splitAsarPath, writeOverride } from './asar-patch.mjs'

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
 * 这个路径是否真的存在（asar 内条目用归档助手判断，普通文件走 fs）。
 * @param {string} file - 绝对路径。
 * @returns {boolean} 存在与否。
 */
function fileExists(file) {
  const split = splitAsarPath(file)
  if (split === null) return existsSync(file)
  return hasAsarEntry(split.archive, split.entry)
}

/**
 * 读外壳正文：asar 内走覆盖层优先，普通文件直接读。
 * @param {string} file - 绝对路径。
 * @returns {string} 正文。
 */
function readShellText(file) {
  const split = splitAsarPath(file)
  if (split === null) return readFileSync(file, 'utf8')
  return readEffectiveText(split.archive, split.entry)
}

/**
 * 猜外壳 main.js 的位置。
 * @returns {string | null} 绝对路径（可能带 `.asar`）。
 */
function guessFile() {
  const explicit = argValue('--file')
  if (explicit !== undefined) return resolve(explicit)

  const installs = [
    // 显式指定安装目录（绿色版 / 装在 D 盘时用得上）。
    process.env.DSH_APP_DIR,
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness'),
    process.env.ProgramFiles && join(process.env.ProgramFiles, 'DeepSeek Harness'),
  ].filter((root) => typeof root === 'string' && root !== '')

  const candidates = [process.env.DSH_SHELL_MAIN_JS]
  for (const root of installs) {
    candidates.push(join(root, 'resources', 'app', 'lib', 'main.js'))
    candidates.push(join(root, 'resources', 'app.asar', 'lib', 'main.js'))
  }

  // 装在非系统盘时上面几条都猜不到，扫一下各盘根目录下的常见安装目录名。
  for (const drive of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    for (const folder of ['DeepSeekApp', 'DeepSeek Harness']) {
      const root = `${drive}:\\${folder}`
      if (!existsSync(root)) continue
      candidates.push(join(root, 'resources', 'app.asar', 'lib', 'main.js'))
      candidates.push(join(root, 'resources', 'app', 'lib', 'main.js'))
    }
  }

  candidates.push(join(process.cwd(), '..', 'lib', 'main.js'))
  for (const candidate of candidates) {
    if (typeof candidate !== 'string' || candidate === '') continue
    try {
      if (fileExists(candidate) && readShellText(candidate).includes(SHELL_MARK)) return resolve(candidate)
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
if (!fileExists(file)) {
  console.error(`文件不存在：${file}`)
  process.exit(2)
}

const split = splitAsarPath(file)
const asar = split !== null
const text = readShellText(file)
const originalHits = text.split(MARK_ORIGINAL).length - 1
const patchedHits = text.split(MARK_PATCHED).length - 1
const legacyHits = text.split(MARK_PATCHED_LEGACY).length - 1
const patched = patchedHits > 0 || legacyHits > 0
/** 计数当前正文的命中数，写入后回读校验用。 */
const countOf = (body) => ({
  patched: body.split(MARK_PATCHED).length - 1,
  legacy: body.split(MARK_PATCHED_LEGACY).length - 1,
})

const report = {
  file,
  asar,
  patched,
  mode: patchedHits > 0 ? 'self-check' : legacyHits > 0 ? 'always' : null,
  originalHits,
  patchedHits,
  legacyHits,
  // asar 布局不动归档正文，没有备份文件这回事。
  backup: asar ? null : file + BACKUP_SUFFIX,
  backupExists: asar ? false : existsSync(file + BACKUP_SUFFIX),
  override: asar ? isOverridden(split.archive, split.entry) : false,
  // 残局：条目 unpacked 但覆盖文件不在 —— 只有这种组合会让应用起不来，--revert 能修。
  broken: asar ? isBrokenOverride(split.archive, split.entry) : false,
  needsRestart: asar,
}

/**
 * 写入后回读校验，结果拼进报告。
 * @param {'patched' | 'reverted'} wrote - 刚做了什么。
 * @returns {{ ok: boolean, patched: boolean, mode: string | null, override: boolean }} 校验结果。
 */
function verify(wrote) {
  const after = readShellText(file)
  const counts = countOf(after)
  const afterPatched = counts.patched > 0 || counts.legacy > 0
  return {
    ok: wrote === 'patched' ? afterPatched : !afterPatched,
    patched: afterPatched,
    mode: counts.patched > 0 ? 'self-check' : counts.legacy > 0 ? 'always' : null,
    override: asar ? isOverridden(split.archive, split.entry) : false,
  }
}

if (has('--apply') || has('--revert')) {
  const enable = has('--apply')
  if (enable && originalHits !== 1 && legacyHits !== 1) {
    console.error(JSON.stringify({ ...report, ok: false, error: `定位失败：原样标记命中 ${originalHits} 处（期望 1 处）` }, null, 2))
    process.exit(3)
  }
  if (!enable && patchedHits === 0 && legacyHits === 0 && !report.override && !report.broken) {
    // 归档正文是官方原样、也没有可卸的覆盖层、更没有半改残局 —— 本来就没打补丁，revert 当成功。
    console.log(JSON.stringify({ ...report, ok: true, changed: false, reason: 'already-clean' }, null, 2))
    process.exit(0)
  }
  if (!enable && patchedHits !== 1 && legacyHits !== 1 && !report.override && !report.broken) {
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
  const wrote = enable ? 'patched' : 'reverted'
  if (asar) {
    if (enable) {
      writeOverride(split.archive, split.entry, next)
    } else {
      // 先卸覆盖层（最干净）；卸完还是补丁态说明归档正文本身被改过，那就就地换回原样再写覆盖层。
      clearOverride(split.archive, split.entry)
      const now = readShellText(file)
      if (countOf(now).patched > 0 || countOf(now).legacy > 0) {
        const back = countOf(now).patched === 1 ? MARK_PATCHED : MARK_PATCHED_LEGACY
        writeOverride(split.archive, split.entry, now.replace(back, MARK_ORIGINAL))
      }
    }
  } else {
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
  }
  const checked = verify(wrote)
  const result = { ...report, ...checked, wrote }
  if (!checked.ok) {
    console.error(JSON.stringify({ ...result, ok: false, error: '写入后回读状态不对' }, null, 2))
    process.exit(4)
  }
  console.log(JSON.stringify(result, null, 2))
  process.exit(0)
}

console.log(JSON.stringify({ ...report, ok: true, action: 'status' }, null, 2))
