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
import { existsSync, readFileSync } from 'node:fs'
import { copyFile, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/** 路由挂在 Host 的 webServer 服务上；Cordis 里不声明就拿不到 ctx.webServer。 */
export const inject = ['webServer']

const ROUTE = '/dsh-menu-hidden/api/shell-menu'
const BACKUP_SUFFIX = '.menuhidden.bak'
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
 * 两条路都试，再兜一层环境变量和一个本机绝对路径。
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
  const localAppData = process.env.LOCALAPPDATA
  if (typeof localAppData === 'string' && localAppData !== '') push(join(localAppData, 'Programs', 'DeepSeek Harness', 'resources', 'app', 'lib', 'main.js'))
  for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
    if (typeof base === 'string' && base !== '') push(join(base, 'DeepSeek Harness', 'resources', 'app', 'lib', 'main.js'))
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
  const text = readFileSync(file, 'utf8')
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
      if (!existsSync(state.file + BACKUP_SUFFIX)) await copyFile(state.file, state.file + BACKUP_SUFFIX)
      await writeFile(state.file, text.replace(MARK_ORIGINAL, MARK_PATCHED), 'utf8')
    } catch (error) {
      return { ...state, ok: false, error: `写入失败：${describe(error)}` }
    }
    return { ...shellState(), ok: true, changed: true }
  }
  if (patchedHits !== 1) return { ...state, ok: false, error: `定位失败：main.js 里 "${MARK_PATCHED}" 命中 ${patchedHits} 处（期望 1 处）。` }
  try {
    await writeFile(state.file, text.replace(MARK_PATCHED, MARK_ORIGINAL), 'utf8')
  } catch (error) {
    return { ...state, ok: false, error: `还原失败：${describe(error)}` }
  }
  return { ...shellState(), ok: true, changed: true }
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
 * 插件入口。
 * @param {object} ctx - 宿主上下文。
 * @param {object} [config] - 预留配置。
 */
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
}
