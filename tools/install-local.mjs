#!/usr/bin/env node
/**
 * 把插件装进某个 profile 的 node_modules，并在落盘前做完所有会让 DSH 起不来的检查。
 *
 * 用法：
 *   node tools/install-local.mjs                      # repo/ → desktop profile，真装
 *   node tools/install-local.mjs --dry-run            # 只跑检查，不写盘
 *   node tools/install-local.mjs --from plugin        # 拿开发副本装（会自动改 id）
 *   node tools/install-local.mjs --profile web
 *   node tools/install-local.mjs --target D:\somewhere\dsh-menu-hidden
 *   node tools/install-local.mjs --check D:\path\to\dsh-menu-hidden   # 只体检目录
 *
 * 退出码：0 成功，1 检查没过（不会写任何文件）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))
const COPY = ['package.json', 'index.js', 'client.js', 'reasoning.js', 'cordis.patch.yml', 'icon.svg', 'locale', 'README.md', 'LICENSE']
const PKG_NAME = 'dsh-menu-hidden'
const DEV_ID = '@local/dsh-menu-hidden'

function arg(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return fallback
  const next = process.argv[index + 1]
  return next === undefined || next.startsWith('--') ? true : next
}

const dryRun = arg('dry-run', false) === true
const fromName = arg('from', 'repo')
const checkOnly = arg('check', null)
const devMode = arg('dev', false) === true
const profile = arg('profile', 'desktop')
const dshHome = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
const target = checkOnly ?? arg('target', path.join(dshHome, 'profiles', profile, 'node_modules', PKG_NAME))
const source = path.isAbsolute(fromName) ? fromName : path.join(ROOT, fromName)

const problems = []
const notes = []

function fail(message) { problems.push(message) }

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) }
  catch (error) { fail(`${file} 不是合法 JSON：${error.message}`); return null }
}

/** 只把开发包名改写成发布包名，不做判断。 */
function rewriteClient(text, name) {
  return text.split(DEV_ID).join(name)
}

/** 严格检查（不改写）：一次 load 调用、id 必须等于包名、导出形状正确。 */
function normaliseClient(text, name, { strict = true } = {}) {
  const loads = text.match(/__ModuleLoader__\.load\s*\(/g) ?? []
  if (loads.length !== 1) fail(`client.js 里 __ModuleLoader__.load 出现 ${loads.length} 次，必须正好 1 次`)

  const ids = [...text.matchAll(/\bid:\s*"([^"]+)"/g)].map((m) => m[1])
  const uniq = [...new Set(ids)]
  if (uniq.length !== 1) fail(`client.js 里出现多个 loader id：${uniq.join(', ')}`)
  else if (strict && uniq[0] !== name) fail(`client.js 的 loader id 是 "${uniq[0]}"，与包名 "${name}" 不一致`)

  if (/\bmodule\.exports\b/.test(text)) fail('client.js 里还有 module.exports —— 浏览器没有 CommonJS 的 module，必须 return { name, apply }')
  if (!/return\s*\{[^}]*\bapply\b/s.test(text)) fail('client.js 没有 return { name, apply } 形式的导出')
  // 顶层 inject 是硬依赖：服务缺一个这条 entry 就是 pending，
  // 前端 boot 只要有一条不是 active 就整体抛错（白屏）。依赖必须走 scoped ctx.inject。
  const exported = text.slice(text.lastIndexOf('return {'))
  if (/\binject\s*:/.test(exported)) fail('client.js 的模块导出上带了 inject —— 服务缺失时会让 web boot 白屏，改用 scoped ctx.inject([...], callback)')
  return text
}

function checkSyntax(file, text) {
  const tmp = path.join(os.tmpdir(), `dsh-menu-hidden-${process.pid}-${path.basename(file)}.mjs`)
  fs.writeFileSync(tmp, text, 'utf8')
  const run = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' })
  fs.rmSync(tmp, { force: true })
  if (run.status !== 0) fail(`${path.basename(file)} 语法不过：${(run.stderr ?? '').trim().split('\n')[0]}`)
}

/** 体检任意一个目录：清单、id、patch、语法、图标与语言文件。expect 为 null 时不比对包名（源目录允许是 @local 开发名）。 */
function inspect(dir, { expect = PKG_NAME } = {}) {
  const pkgFile = path.join(dir, 'package.json')
  if (!fs.existsSync(pkgFile)) { fail(`${pkgFile} 不存在`); return null }
  const pkg = readJson(pkgFile)
  if (pkg === null) return null

  if (expect !== null && pkg.name !== expect) fail(`package.json 的 name 是 "${pkg.name}"，应是 "${expect}"`)
  if (typeof pkg.version !== 'string' || pkg.version.length === 0) fail('package.json 缺 version')

  const clientFile = path.join(dir, 'client.js')
  if (!fs.existsSync(clientFile)) { fail(`${clientFile} 不存在`); return null }
  const client = normaliseClient(fs.readFileSync(clientFile, 'utf8'), pkg.name, { strict: expect !== null })
  checkSyntax('client.js', client)

  for (const entry of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    checkSyntax(entry, fs.readFileSync(path.join(dir, entry), 'utf8'))
  }

  const patchFile = path.join(dir, 'cordis.patch.yml')
  if (!fs.existsSync(patchFile)) fail(`${patchFile} 不存在`)
  else {
    const patch = fs.readFileSync(patchFile, 'utf8')
    const patchId = patch.match(/^\s*-\s*id:\s*["']?([^"'\n]+)/m)?.[1]
    const patchName = patch.match(/^\s*name:\s*["']?([^"'\n]+)/m)?.[1]
    if (expect === null) {
      if (patchId !== patchName) notes.push(`源目录 cordis.patch.yml 的 id "${patchId}" 与 name "${patchName}" 不一致，落盘时统一改成 ${PKG_NAME}`)
    } else {
      if (patchId !== pkg.name) fail(`cordis.patch.yml 的 id 是 "${patchId}"，与包名 "${pkg.name}" 不一致`)
      if (patchName !== pkg.name) fail(`cordis.patch.yml 的 name 是 "${patchName}"，与包名 "${pkg.name}" 不一致`)
    }
  }

  const icon = typeof pkg.icon === 'string' ? path.join(dir, pkg.icon) : null
  if (icon !== null && !fs.existsSync(icon)) fail(`清单写着 icon ${pkg.icon}，但文件不存在`)
  if (typeof pkg.icon !== 'string') notes.push('清单没写 icon，插件列表会用默认占位图')

  const localeDir = path.join(dir, 'locale')
  for (const lang of ['zh', 'en']) {
    const file = path.join(localeDir, `${lang}.json`)
    if (!fs.existsSync(file)) { notes.push(`缺 locale/${lang}.json，列表标题会退回包名`); continue }
    const meta = readJson(file)?.meta
    if (typeof meta?.title !== 'string') fail(`locale/${lang}.json 缺 meta.title`)
    if (typeof meta?.description !== 'string') fail(`locale/${lang}.json 缺 meta.description`)
  }

  if (pkg.exports?.['./locale/*.json'] === undefined) notes.push('exports 里没有 "./locale/*.json"，某些打包方式下 locale 读不到')
  if (pkg.exports?.['./icon'] === undefined) notes.push('exports 里没有 "./icon"')

  return { pkg, client }
}

// ---- 只体检 ----
if (checkOnly !== null) {
  const result = inspect(target, { expect: devMode ? null : PKG_NAME })
  report(result === null ? null : { pkg: result.pkg, dir: target })
  process.exit(problems.length === 0 ? 0 : 1)
}

// ---- 装 ----
if (!fs.existsSync(path.join(source, 'package.json'))) {
  console.error(`源目录没有 package.json：${source}`)
  process.exit(1)
}

const produced = inspect(source, { expect: null })
if (problems.length > 0) { report(null); process.exit(1) }

const { pkg } = produced
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-menu-hidden-stage-'))

function copyInto(dest) {
  for (const entry of COPY) {
    const from = path.join(source, entry)
    if (!fs.existsSync(from)) continue
    fs.cpSync(from, path.join(dest, entry), { recursive: true })
  }
}

copyInto(stage)

// 统一成发布形态：包名、loader id、patch 的 id/name 全部对齐到 PKG_NAME
const stagedPkg = readJson(path.join(stage, 'package.json'))
if (stagedPkg === null) { report(null); process.exit(1) }
stagedPkg.name = PKG_NAME
fs.writeFileSync(path.join(stage, 'package.json'), `${JSON.stringify(stagedPkg, null, 2)}\n`, 'utf8')

const clientText = rewriteClient(fs.readFileSync(path.join(stage, 'client.js'), 'utf8'), PKG_NAME)
fs.writeFileSync(path.join(stage, 'client.js'), clientText, 'utf8')

const stagedPatch = path.join(stage, 'cordis.patch.yml')
if (fs.existsSync(stagedPatch)) {
  const rewritten = fs.readFileSync(stagedPatch, 'utf8')
    .replace(/^(\s*-\s*id:\s*)["']?[^\s"'#]+["']?/m, `$1${PKG_NAME}`)
    .replace(/^(\s*name:\s*)["']?[^\s"'#]+["']?/m, `$1${PKG_NAME}`)
  fs.writeFileSync(stagedPatch, rewritten, 'utf8')
}

// 落盘前对「已经是发布形态」的暂存目录再体检一次，防止改写漏项
const verified = inspect(stage)
if (problems.length > 0) { report(null); fs.rmSync(stage, { recursive: true, force: true }); process.exit(1) }

if (dryRun) {
  report({ pkg: verified.pkg, dir: target, dryRun: true })
  fs.rmSync(stage, { recursive: true, force: true })
  process.exit(0)
}

fs.mkdirSync(path.dirname(target), { recursive: true })

// 目标可能是指向源码的目录联接 / 符号链接（pnpm 的 `link:` 依赖就是这样）。
// 这两种情况都不能走「备份 + 逐条目覆盖」：
//   1) cpSync 备份时要重建链接，Windows 上非管理员直接 EPERM；
//   2) 逐条目 rmSync 会顺着链接删掉源码目录里的真实文件。
// 链接本来就已经是「实时读源码」，只要它指对了，就什么都不用复制。
const targetStat = fs.lstatSync(target, { throwIfNoEntry: false })
if (targetStat !== undefined && targetStat.isSymbolicLink()) {
  const currentReal = fs.realpathSync(target)
  const sourceReal = fs.realpathSync(source)
  if (currentReal === sourceReal) {
    notes.push(`目标已是指向源码的链接，不用复制：${target} -> ${sourceReal}`)
  } else {
    fs.unlinkSync(target)
    fs.symlinkSync(sourceReal, target, process.platform === 'win32' ? 'junction' : 'dir')
    notes.push(`目标链接改指源码：${target} -> ${sourceReal}`)
  }
} else {
  if (arg('no-backup', false) !== true && fs.existsSync(path.join(target, 'package.json'))) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backup = `${target}.bak-${stamp}`
    fs.cpSync(target, backup, { recursive: true })
    notes.push(`旧目录已备份到 ${backup}`)
  }
  for (const entry of fs.readdirSync(stage)) {
    fs.rmSync(path.join(target, entry), { recursive: true, force: true })
    fs.cpSync(path.join(stage, entry), path.join(target, entry), { recursive: true })
  }
}
fs.rmSync(stage, { recursive: true, force: true })

// 装完顺手把 profile 的依赖 pin 到本地源码：不改的话，下一次 pnpm install 会按
// package.json 里的 github: spec 重新拉远端 tarball，把这里刚装的新版换回旧版。
const pinned = arg('no-pin', false) === true
  ? null
  : pinProfileDependency(path.dirname(path.dirname(target)), source)
if (pinned !== null) notes.push(pinned)

const finalCheck = inspect(target)
report({ pkg: finalCheck?.pkg ?? pkg, dir: target })
process.exit(problems.length === 0 ? 0 : 1)

/**
 * 把 profile 的 package.json / pnpm-lock.yaml 里这个包改成 `link:` 本地源码，
 * 这样后续 pnpm install 只会把它链到源码目录，不会再从 GitHub tarball 覆盖。
 * 返回一句提示；没做任何事就返回 null。
 */
function pinProfileDependency(profileDir, linkPath) {
  const manifestPath = path.join(profileDir, 'package.json')
  if (!fs.existsSync(manifestPath)) return null
  const manifest = readJson(manifestPath)
  if (manifest === null || manifest.dependencies?.[PKG_NAME] === undefined) return null

  const spec = `link:${linkPath.split(path.sep).join('/')}`
  const notesOut = []
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')

  if (manifest.dependencies[PKG_NAME] !== spec) {
    fs.cpSync(manifestPath, `${manifestPath}.bak-before-pin-${stamp}`)
    manifest.dependencies[PKG_NAME] = spec
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    notesOut.push(`依赖已 pin 成 ${spec}`)
  }

  const lockPath = path.join(profileDir, 'pnpm-lock.yaml')
  if (fs.existsSync(lockPath)) {
    const before = fs.readFileSync(lockPath, 'utf8')
    let lock = before
    lock = lock.replace(
      new RegExp(`(\\n      ${PKG_NAME}:\\n        specifier: )[^\\n]+(\\n        version: )[^\\n]+`),
      (_match, head, mid) => `${head}${spec}${mid}${spec}`,
    )
    lock = dropLockBlocks(lock, PKG_NAME)
    if (lock !== before) {
      fs.cpSync(lockPath, `${lockPath}.bak-before-pin-${stamp}`)
      fs.writeFileSync(lockPath, lock, 'utf8')
      notesOut.push('pnpm-lock.yaml 里的 tarball 条目已清掉，只剩 link 解析')
    }
    try {
      const yamlPath = path.join(profileDir, 'node_modules', 'js-yaml')
      if (fs.existsSync(yamlPath)) {
        const yaml = createRequire(yamlPath)(yamlPath)
        yaml.load(lock)
        notesOut.push('pnpm-lock.yaml 解析校验通过')
      }
    } catch (error) {
      notesOut.push(`pnpm-lock.yaml 解析校验没过：${error.message}`)
    }
  }

  return notesOut.length === 0 ? null : notesOut.join('；')
}

/** 删掉 packages / snapshots 段里这个包的 tarball 条目（保留 link: 那种）。 */
function dropLockBlocks(text, name) {
  const lines = text.split('\n')
  const out = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const isForeignBlock = line.startsWith(`  ${name}@`) && line.endsWith(':') && !line.startsWith(`  ${name}@link:`)
    if (!isForeignBlock) { out.push(line); continue }
    i += 1
    while (i < lines.length && (lines[i].startsWith('   ') || lines[i].trim() === '')) i += 1
    i -= 1
  }
  return out.join('\n')
}

function report(state) {
  const lines = []
  if (state !== null) {
    lines.push(`目录    ${state.dir}`)
    lines.push(`包名    ${state.pkg.name}@${state.pkg.version}`)
    lines.push(`loader  ${DEV_ID} → ${state.pkg.name}`)
    if (state.dryRun === true) lines.push('模式    干跑，没有写任何文件')
  }
  for (const note of notes) lines.push(`提示    ${note}`)
  for (const problem of problems) lines.push(`失败    ${problem}`)
  console.log(lines.join('\n'))
  console.log(problems.length === 0
    ? '\n装好了。要让它生效：退出 DeepSeek Harness 再打开（或应用菜单「重启应用与 Host」）。\n'
      + '只按「刷新页面」不行——Host 手里的模块清单还是旧的，刷新会报 “1 entry did not activate / import failed”。'
    : '\n检查没过，已停止，没有写入。')
}
