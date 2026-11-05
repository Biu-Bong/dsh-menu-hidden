/**
 * dsh-menu-hidden · 宿主半（Cordis 插件）
 *
 * 客户端半（client.js）负责 DOM 层面的隐藏，跑在浏览器里，改开关立刻生效。
 * 但「应用菜单里退出上方多两项：刷新页面 / 重启应用与 Host」这件事落不到浏览器里 ——
 * 那个菜单是 Electron 主进程用 Menu.buildFromTemplate() 现拼的（win32 下由自定义
 * 标题栏点「应用」时 popup 出来），Renderer 摸不到。
 *
 * 好消息是官方本来就有这两项，只是挂在 `development` 门后面：
 *   lib/main.js  applicationItems() 里  ...development ? [ {刷新页面}, {重启应用与 Host} ] : []
 * 所以宿主半只做一件事：把那处 `development` 门打开（幂等、留备份、可还原），
 * 并把状态用一条本机路由告诉设置页。写完要重启一次应用，菜单在启动时才读这段代码。
 *
 * 路由：GET|POST /dsh-menu-hidden/api/shell-menu
 *   GET              → 读状态
 *   POST ?action=enable    → 写入补丁
 *   POST ?action=disable   → 还原补丁
 *   POST ?action=status    → 同 GET
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync, watch } from 'node:fs'
import { LEVELS, applyReasoning, auditLevels, configFiles as configFilesForWatch, readState as readReasoningState, readStatus } from './reasoning.js'
import { copyFile, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/** 路由挂在 Host 的 webServer 服务上；Cordis 里不声明就拿不到 ctx.webServer。 */
export const inject = ['webServer']

const ROUTE = '/dsh-menu-hidden/api/shell-menu'
const REASONING_ROUTE = '/dsh-menu-hidden/api/reasoning'
const UPDATE_ROUTE = '/dsh-menu-hidden/api/update'
const REPO_SLUG = 'Biu-Bong/dsh-menu-hidden'
const REPO_URL = `https://github.com/${REPO_SLUG}`
const UPDATE_TTL_MS = 30 * 60 * 1000
const BACKUP_SUFFIX = '.menuhidden.bak'
/** 当前 profile 名：优先问 profileContext，其次环境变量，最后按桌面默认。 */
function currentProfile(ctx) {
  try {
    const context = ctx.get('profileContext')
    const name = context === null || context === undefined ? null : context.name
    if (typeof name === 'string' && name !== '') return name
  } catch {
    // 没有 profileContext 的宿主（纯 web）就往下走。
  }
  const fromEnv = process.env.DSH_PROFILE
  if (typeof fromEnv === 'string' && fromEnv !== '') return fromEnv
  return 'desktop'
}

/** 桌面版自带的 dsh CLI：<app>/resources/cli/bin/dsh.cmd（相对 main.js 的 resources 目录）。 */
function resolveCli() {
  const candidates = []
  const push = (value) => { if (typeof value === 'string' && value !== '' && !candidates.includes(value)) candidates.push(value) }
  const executable = process.argv[0]
  if (typeof executable === 'string' && executable !== '') push(join(dirname(executable), 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'))
  for (const root of [process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness'), process.env.ProgramFiles && join(process.env.ProgramFiles, 'DeepSeek Harness')]) {
    if (root) push(join(root, 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'))
  }
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

/** 官方原样：development 为 false 时整段被丢掉。 */
const MARK_ORIGINAL = '...development ? ['
/** 打完补丁后的样子：条件恒真，两个菜单项无条件保留。 */
const MARK_PATCHED = '...(development || true) ? ['
/** 用来确认「这个文件真的是外壳 main.js」而不是同名别的东西。 */
const MARK_SHELL = 'applicationItems'

/**
 * 找一个像外壳 main.js 的文件。
 *
 * 宿主是 Electron 用 node 模式拉起来的独立进程（main.js 里 spawn 的），拿不到
 * electron API，但 process.argv 里带着足够的信息：
 *   argv[0] = "<安装目录>\\DeepSeek Harness.exe"
 *   argv[2] = "<app>\\resources\\app\\dsh"（runtimeDir）
 * 两条路都试，再兜一层环境变量和两处常见安装位置。
 * @returns {{ tried: string[], file: string | null }}
 */
function resolveShellMain() {
  const tried = []
  const push = (candidate) => {
    if (typeof candidate !== 'string' || candidate === '') return
    const absolute = resolve(candidate)
    if (!tried.includes(absolute)) tried.push(absolute)
  }
  push(process.env.DSH_SHELL_MAIN_JS)
  const executable = process.argv[0]
  if (typeof executable === 'string' && executable !== '') push(join(dirname(executable), 'resources', 'app', 'lib', 'main.js'))
  for (const argument of process.argv.slice(1)) {
    if (typeof argument !== 'string' || argument === '') continue
    if (!existsSync(join(argument, 'package.json'))) continue
    push(join(argument, '..', 'lib', 'main.js'))
  }
  // 兜底：Windows 上常见的两处安装位置。别写死某台机器的目录。
  for (const root of [process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness'), process.env.ProgramFiles && join(process.env.ProgramFiles, 'DeepSeek Harness')]) {
    if (root) push(join(root, 'resources', 'app', 'lib', 'main.js'))
  }
  return { tried, file: tried.find((candidate) => looksLikeShellMain(candidate)) ?? null }
}

/**
 * 这个路径是不是外壳 main.js。
 * @param {string} file - 候选绝对路径。
 * @returns {boolean} 里面有没有 applicationItems 那一套。
 */
function looksLikeShellMain(file) {
  try {
    if (!existsSync(file)) return false
    return readFileSync(file, 'utf8').includes(MARK_SHELL)
  } catch {
    return false
  }
}

/**
 * 读当前补丁状态。
 * @returns {{ found: boolean, file: string | null, patched: boolean, original: boolean, tried: string[] }} 状态。
 */
function shellState() {
  const { tried, file } = resolveShellMain()
  if (file === null) return { found: false, file: null, patched: false, original: false, tried }
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    // 更新过程里文件会被独占，读不到就当「没打补丁」，别把整条状态路由带成 500。
    return { found: true, file, patched: false, original: false, tried, error: `读取失败：${describe(error)}` }
  }
  return {
    found: true,
    file,
    patched: text.includes(MARK_PATCHED),
    original: text.includes(MARK_ORIGINAL),
    tried,
  }
}

/**
 * 写入或还原补丁。幂等；第一次写入前留一份 .menuhidden.bak。
 * @param {boolean} enabled - true 打开菜单项，false 还原。
 * @returns {Promise<{ ok: boolean, changed?: boolean, reason?: string, error?: string } & ReturnType<typeof shellState>>} 结果。
 */
async function setShellPatch(enabled) {
  const state = shellState()
  if (!state.found || state.file === null) {
    return { ...state, ok: false, error: '没找到外壳 main.js；可用环境变量 DSH_SHELL_MAIN_JS 指定绝对路径。' }
  }
  if (enabled && state.patched) return { ...state, ok: true, changed: false, reason: 'already-patched' }
  if (!enabled && !state.patched) return { ...state, ok: true, changed: false, reason: 'already-clean' }
  let text
  try {
    text = await readFile(state.file, 'utf8')
  } catch (error) {
    return { ...state, ok: false, error: `读取失败：${describe(error)}` }
  }
  const hits = text.split(MARK_ORIGINAL).length - 1
  const patchedHits = text.split(MARK_PATCHED).length - 1
  if (enabled) {
    if (hits !== 1) return { ...state, ok: false, error: `定位失败：main.js 里 "${MARK_ORIGINAL}" 命中 ${hits} 处（期望 1 处）。这个版本的外壳结构变了，补丁没有写入。` }
    try {
      // 每次打补丁都刷新备份：DSH 更新会换掉整个 main.js，旧备份留着只会误导人。
      await copyFile(state.file, state.file + BACKUP_SUFFIX)
      await swap(state.file, text.replace(MARK_ORIGINAL, MARK_PATCHED))
    } catch (error) {
      return { ...state, ok: false, error: `写入失败：${describe(error)}` }
    }
    const after = shellState()
    if (after.patched !== true) return { ...after, ok: false, error: '写入后回读没看到补丁标记，外壳文件可能被别的进程改回去了。' }
    return { ...after, ok: true, changed: true }
  }
  if (patchedHits !== 1) return { ...state, ok: false, error: `定位失败：main.js 里 "${MARK_PATCHED}" 命中 ${patchedHits} 处（期望 1 处）。` }
  try {
    await swap(state.file, text.replace(MARK_PATCHED, MARK_ORIGINAL))
  } catch (error) {
    return { ...state, ok: false, error: `还原失败：${describe(error)}` }
  }
  const reverted = shellState()
  if (reverted.patched === true) return { ...reverted, ok: false, error: '还原后回读仍是补丁状态，外壳文件可能被别的进程改回去了。' }
  return { ...reverted, ok: true, changed: true }
}

/**
 * 原子换文件：先写同目录临时文件再改名。
 *
 * 直接 writeFile 到 main.js，写到一半崩了就是「外壳入口文件被截断」，
 * 下次启动直接白屏；临时文件 + rename 在 Windows 上也是替换性的，最坏情况只是补丁没生效。
 * @param {string} file - 目标文件。
 * @param {string} content - 新内容。
 * @returns {Promise<void>} 完成。
 */
async function swap(file, content) {
  const staged = `${file}.menuhidden.tmp`
  try {
    await writeFile(staged, content, 'utf8')
    await rename(staged, file)
  } catch (error) {
    await unlink(staged).catch(() => {})
    throw error
  }
}

/**
 * 错误对象转一句人话。
 * @param {unknown} error - 任意错误。
 * @returns {string} 文本。
 */
function describe(error) {
  if (error === null || error === undefined) return '未知错误'
  return String((error && error.message) || error)
}

/**
 * 请求是不是本机来的。
 * @param {import('node:http').IncomingMessage} request - 请求。
 * @returns {boolean} 回环地址才算。
 */
function loopbackPeer(request) {
  const address = request.socket?.remoteAddress ?? ''
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/**
 * 信任栅栏：回环 + Host/Origin 一致。
 * @param {import('node:http').IncomingMessage} request - 请求。
 * @returns {boolean} 是否可信。
 */
function trustedRequest(request) {
  if (!loopbackPeer(request)) return false
  const host = request.headers.host
  if (host === undefined) return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    const parsed = new URL(origin)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host
  } catch {
    return false
  }
}

/**
 * 平台自带的浏览器鉴权（可选依赖）：没带会话 cookie 的本机进程会被挡在 401。
 * @param {{ get?: (name: string) => unknown }} ctx - 宿主上下文。
 * @param {import('node:http').IncomingMessage} request - 请求。
 * @returns {401 | 403 | null} 拒绝码；放行返回 null。
 */
function platformFence(ctx, request) {
  let connection
  try {
    connection = typeof ctx?.get === 'function' ? ctx.get('connection') : undefined
  } catch {
    return null
  }
  if (connection === undefined || connection === null || typeof connection.requestRejection !== 'function') return null
  try {
    const rejection = connection.requestRejection(request)
    if (rejection === 401 || rejection === 403) return rejection
  } catch {
    return null
  }
  return null
}

/**
 * 读 JSON 请求体。
 * @param {import('node:http').IncomingMessage} request - 请求。
 * @param {number} [limit] - 字节上限。
 * @returns {Promise<object>} 解析结果；坏数据返回空对象。
 */
function readJsonBody(request, limit = 64 * 1024) {
  return new Promise((resolve) => {
    let size = 0
    const chunks = []
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        request.destroy()
        resolve({})
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        resolve(parsed !== null && typeof parsed === 'object' ? parsed : {})
      } catch {
        resolve({})
      }
    })
    request.on('error', () => resolve({}))
  })
}

/**
 * 插件入口。
 * @param {object} ctx - 宿主上下文。
 * @param {object} [config] - 预留配置。
 */
/** 本插件的版本号：读自己旁边的 package.json。 */
function readVersion() {
  try {
    return JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version
  } catch {
    return '0.0.0'
  }
}

/** 只比 major.minor.patch，预发布后缀（-rc.1）先剥掉。 */
function compareVersions(a, b) {
  const parse = (value) => String(value).replace(/^v/, '').split('-')[0].split('.').map((part) => Number.parseInt(part, 10) || 0)
  const left = parse(a)
  const right = parse(b)
  for (let index = 0; index < 3; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

let updateCache = { at: 0, payload: null }

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'dsh-menu-hidden' },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 最新版本号。api.github.com 未登录时限流很凶（这台机器上就直接 403），
 * 所以先读 raw 上的 package.json，再退到 jsdelivr，最后才试 GitHub API。
 */
async function latestRelease() {
  if (updateCache.payload !== null && Date.now() - updateCache.at < UPDATE_TTL_MS) return updateCache.payload
  const sources = [
    async () => ({ latest: String((await fetchJson(`https://raw.githubusercontent.com/${REPO_SLUG}/main/package.json`, 8000)).version ?? '') }),
    async () => ({ latest: String((await fetchJson(`https://cdn.jsdelivr.net/gh/${REPO_SLUG}@main/package.json`, 8000)).version ?? '') }),
    async () => ({ latest: String((await fetchJson(`https://api.github.com/repos/${REPO_SLUG}/releases/latest`, 8000)).tag_name ?? '').replace(/^v/, '') }),
  ]
  let lastError = null
  for (const load of sources) {
    try {
      const { latest } = await load()
      if (latest === '') throw new Error('版本号是空的')
      const payload = { latest, url: `${REPO_URL}/releases` }
      updateCache = { at: Date.now(), payload }
      return payload
    } catch (error) {
      lastError = error
    }
  }
  throw lastError ?? new Error('没有可用的版本源')
}

export function apply(ctx, config = {}) {
  void config
  const info = (line) => {
    try {
      ctx.logger('dsh-menu-hidden').info('%s', line)
    } catch {
      /* 没有 logger 就安静 */
    }
  }

  const handler = async (request, response) => {
    const send = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      response.end(JSON.stringify(body))
    }
    if (!trustedRequest(request)) {
      send(403, { ok: false, error: '只接受来自本机页面的请求' })
      return
    }
    let action = 'status'
    try {
      action = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams.get('action') ?? 'status'
    } catch {
      send(400, { ok: false, error: '请求地址无法解析' })
      return
    }
    if (request.method === 'GET' || action === 'status') {
      const state = shellState()
      send(200, { ok: state.found, ...state })
      return
    }
    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'GET, POST' })
      response.end()
      return
    }
    const refusal = platformFence(ctx, request)
    if (refusal !== null) {
      send(refusal, { ok: false, error: refusal === 401 ? '需要浏览器会话凭据：请从 DeepSeek Harness 的设置页操作。' : '被信任栅栏拒绝：Host / Origin 不符。' })
      return
    }
    if (action !== 'enable' && action !== 'disable') {
      send(400, { ok: false, error: `未知操作：${action}` })
      return
    }
    const result = await setShellPatch(action === 'enable')
    info(`shell menu patch ${action}: ok=${String(result.ok)} file=${String(result.file)}`)
    send(200, result)
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: ROUTE, handler }), 'dsh-menu-hidden: shell menu route')
  info(`route mounted: ${ROUTE}`)

  const reasoningHandler = async (request, response) => {
    const send = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      response.end(JSON.stringify(body))
    }
    if (!trustedRequest(request)) {
      send(403, { ok: false, error: '只接受来自本机页面的请求' })
      return
    }
    if (request.method === 'GET') {
      const status = readStatus()
      send(200, { ok: true, levels: LEVELS, ...status })
      return
    }
    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'GET, POST' })
      response.end()
      return
    }
    const refusal = platformFence(ctx, request)
    if (refusal !== null) {
      send(refusal, { ok: false, error: refusal === 401 ? '需要浏览器会话凭据：请从 DeepSeek Harness 的设置页操作。' : '被信任栅栏拒绝：Host / Origin 不符。' })
      return
    }
    const body = await readJsonBody(request)
    const featureMode =
      typeof body.autoReasoning === 'boolean' || typeof body.autoContextWindow === 'boolean' || typeof body.autoImageInput === 'boolean'
    const saved = featureMode ? readReasoningState() : null
    const global = featureMode
      ? saved.global
      : (typeof body.global === 'string' && LEVELS.includes(body.global) ? body.global : null)
    const overrides = {}
    const incoming = featureMode
      ? (saved.overrides ?? {})
      : (body.overrides !== null && typeof body.overrides === 'object' ? body.overrides : {})
    for (const [id, value] of Object.entries(incoming)) {
      // JSON 里的 __proto__ 会改掉这个对象自己的原型，不挡就会悄悄污染状态文件。
      if (id === '__proto__' || id === 'constructor' || id === 'prototype') continue
      if (value === null) overrides[id] = null
      else if (typeof value === 'string' && LEVELS.includes(value)) overrides[id] = value
    }
    const extra = featureMode
      ? {
          skipReasoningLines: true,
          ...(typeof body.autoReasoning === 'boolean' ? { autoReasoning: body.autoReasoning } : {}),
          ...(typeof body.autoContextWindow === 'boolean' ? { autoContextWindow: body.autoContextWindow } : {}),
          ...(typeof body.autoImageInput === 'boolean' ? { autoImageInput: body.autoImageInput } : {}),
        }
      : {}
    let result
    try {
      result = applyReasoning(global, overrides, extra)
    } catch (error) {
      send(500, { ok: false, error: `写配置失败：${String((error && error.message) || error)}` })
      return
    }
    info(`reasoning applied: changed=${String(result.changed)} files=${String(result.files.length)}`)
    result.skipped = featureMode ? [] : auditLevels(global, overrides)
    send(200, { ok: true, levels: LEVELS, ...readStatus(), changed: result.changed, written: result.files, skipped: result.skipped })
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: REASONING_ROUTE, handler: reasoningHandler }), 'dsh-menu-hidden: reasoning route')

  // 配置自愈：新加的模型缺推理档位 / 上下文窗口时按两个开关自动补上。
  // 每轮只 stat 两个配置文件（实测 ~0.09ms）；mtime 和大小都没变就直接返回，
  // 不读文件、不正则、不写盘。只跑 features（provider 的 reasoning 行留给「写入配置」按钮）。
  const fillMarks = new Map()
  const autoConfigOnce = (force) => {
    const state = readReasoningState()
    const needFeatures = state.autoReasoning !== false || state.autoContextWindow !== false || state.autoImageInput !== false
    if (!needFeatures) return
    if (force !== true) {
      let touched = false
      for (const entry of configFilesForWatch()) {
        try {
          const info = statSync(entry.file)
          const mark = String(info.mtimeMs) + ':' + String(info.size)
          if (fillMarks.get(entry.file) !== mark) {
            fillMarks.set(entry.file, mark)
            touched = true
          }
        } catch {
          touched = true
        }
      }
      if (!touched) return
    }
    try {
      const result = applyReasoning(state.global, state.overrides, {
        autoReasoning: state.autoReasoning,
        autoContextWindow: state.autoContextWindow,
        autoImageInput: state.autoImageInput,
        skipReasoningLines: true,
      })
      if (result.changed > 0) info('auto-config: ' + String(result.changed) + ' line(s) written')
    } catch (error) {
      info('auto-config failed: ' + describe(error))
    }
  }
  let fillDebounce = null
  const scheduleFill = () => {
    if (fillDebounce !== null) clearTimeout(fillDebounce)
    fillDebounce = setTimeout(() => {
      fillDebounce = null
      autoConfigOnce(false)
    }, 1500)
    if (typeof fillDebounce.unref === 'function') fillDebounce.unref()
  }

  ctx.effect(() => {
    autoConfigOnce(true)

    // 主通道：盯每个 profile 目录。DSH 写配置是「临时文件 + rename」，
    // 目录级的 rename 事件不会丢（盯单个文件才会，rename 之后句柄就废了）。
    const watchers = []
    const watched = new Set()
    for (const entry of configFilesForWatch()) {
      const dir = dirname(entry.file)
      if (watched.has(dir)) continue
      watched.add(dir)
      try {
        const watcher = watch(dir, { persistent: false }, () => { scheduleFill() })
        if (typeof watcher.unref === 'function') watcher.unref()
        watchers.push(watcher)
      } catch (error) {
        info('auto-config watch failed: ' + describe(error))
      }
    }

    // 兜底：60 秒 stat 一次（两个文件、不读内容），事件通道挂了也能补上。
    const poll = setInterval(() => { autoConfigOnce(false) }, 60000)
    if (typeof poll.unref === 'function') poll.unref()

    return () => {
      for (const watcher of watchers) {
        try { watcher.close() } catch { /* 已经关了 */ }
      }
      clearInterval(poll)
      if (fillDebounce !== null) { clearTimeout(fillDebounce); fillDebounce = null }
    }
  }, 'dsh-menu-hidden: reasoning auto-config')


  const updateHandler = async (request, response) => {
    const send = (code, body) => {
      response.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      response.end(JSON.stringify(body))
    }
    if (!trustedRequest(request)) {
      send(403, { ok: false, error: '请求来源不受信任。' })
      return
    }
    const current = readVersion()
    if (request.method === 'POST') {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (url.searchParams.get('action') !== 'install') {
        send(400, { ok: false, error: '未知操作' })
        return
      }
      const body = await readJsonBody(request)
      const latest = typeof body.latest === 'string' ? body.latest : ''
      if (!/^[0-9A-Za-z.+-]{1,32}$/.test(latest)) {
        send(400, { ok: false, error: '版本号不合法' })
        return
      }
      const cli = resolveCli()
      if (cli === null) {
        send(200, { ok: false, error: '没找到桌面版自带的 dsh，按下面的命令手工更新。' })
        return
      }
      const spec = `github:${REPO_SLUG}@v${latest}`
      const result = await new Promise((done) => {
        const child = spawn('cmd.exe', ['/c', cli, 'plugin', '--profile', currentProfile(ctx), 'add', spec], { windowsHide: true })
        let output = ''
        const collect = (chunk) => { if (output.length < 8000) output += String(chunk) }
        child.stdout.on('data', collect)
        child.stderr.on('data', collect)
        const timer = setTimeout(() => { try { child.kill() } catch { /* 已经退出 */ } }, 180000)
        child.on('error', (error) => { clearTimeout(timer); done({ ok: false, output: String(error.message), error: String(error.message) }) })
        child.on('close', (code) => { clearTimeout(timer); done({ ok: code === 0, output: output.trim(), error: code === 0 ? null : `退出码 ${String(code)}` }) })
      })
      info(`install ${spec}: ok=${String(result.ok)}`)
      send(200, { ok: result.ok, output: result.output, error: result.error, profile: currentProfile(ctx) })
      return
    }
    if (request.method !== 'GET') {
      response.writeHead(405, { allow: 'GET, POST' })
      response.end()
      return
    }
    try {
      const release = await latestRelease()
      send(200, {
        ok: true,
        current,
        latest: release.latest,
        hasUpdate: compareVersions(release.latest, current) > 0,
        url: release.url,
        repo: REPO_URL,
        profile: currentProfile(ctx),
        checkedAt: Date.now(),
      })
    } catch (error) {
      send(200, { ok: false, current, latest: null, hasUpdate: false, repo: REPO_URL, error: String((error && error.message) || error) })
    }
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: UPDATE_ROUTE, handler: updateHandler }), 'dsh-menu-hidden: update route')
  info(`route mounted: ${UPDATE_ROUTE}`)
  info(`route mounted: ${REASONING_ROUTE}`)
}
