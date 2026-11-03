/**
 * dsh-menu-hidden · 推理等级（宿主半）
 *
 * 各家中转站的模型列表里没有「推理等级」这一栏，DSH 只有在 provider 上显式写了
 * `reasoning: <level>` 才会把深度带进请求，后台才显示得出来；否则那边只画一道杠。
 * 手动给每个 provider 加一行、每加一个新 provider 再加一次，很烦。
 *
 * 这个模块做的事：把「全局默认 + 每个 provider 的单独覆盖」落到 profile 的
 * `cordis.patch.yml` 里 `- id: llm-pi-ai` 那一段的 `providers.<id>.reasoning`。
 *
 * 三个硬约束：
 * 1. 只动该动的那几行，注释、缩进、其余字段一个字不碰（纯行级编辑，不用 YAML 重排版）。
 * 2. 幂等：值已经对了就不写文件；首次写之前留一份 `.menuhidden.bak`。
 * 3. 可撤销：把某个 provider 设成「不设置」就把它那行删掉，恢复成上线前的样子。
 *
 * 状态（全局默认与覆盖表）存在 `$DSH_HOME/dsh-menu-hidden.reasoning.json`，
 * 免得把插件的私有状态塞进 profile 配置里。
 */
import { existsSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** DSH 认的推理等级取值（dsh-llm-pi-ai 的 THINKING_LEVELS）。 */
export const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** DSH 主目录。 */
export function dshHome() {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/** 状态文件路径。 */
export function statePath() {
  return join(dshHome(), 'dsh-menu-hidden.reasoning.json')
}

/**
 * 读状态：全局默认 + 每个 provider 的覆盖（null 表示「不设置」）。
 * @returns {{ global: string | null, overrides: Record<string, string | null> }} 状态。
 */
export function readState() {
  try {
    const parsed = JSON.parse(readFileSync(statePath(), 'utf8'))
    const global = typeof parsed.global === 'string' && LEVELS.includes(parsed.global) ? parsed.global : null
    const overrides = {}
    for (const [id, value] of Object.entries(parsed.overrides ?? {})) {
      if (value === null) overrides[id] = null
      else if (typeof value === 'string' && LEVELS.includes(value)) overrides[id] = value
    }
    return { global, overrides }
  } catch {
    return { global: null, overrides: {} }
  }
}

/**
 * 写状态。
 * @param {{ global: string | null, overrides: Record<string, string | null> }} state - 状态。
 */
export function saveState(state) {
  writeFileSync(statePath(), `${JSON.stringify(state, null, 2)}\n`, 'utf8')
}

/**
 * 找出所有「带 llm-pi-ai 条目」的 profile 补丁文件。
 * @returns {{ profile: string, file: string }[]} 文件列表。
 */
export function configFiles() {
  const root = join(dshHome(), 'profiles')
  const found = []
  let names = []
  try {
    names = readdirSync(root)
  } catch {
    return found
  }
  for (const name of names) {
    if (name.startsWith('_')) continue
    const file = join(root, name, 'cordis.patch.yml')
    if (!existsSync(file)) continue
    let text = ''
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    if (!/^\s*-\s*id:\s*llm-pi-ai\s*$/m.test(text)) continue
    found.push({ profile: name, file })
  }
  return found
}

/**
 * 把一段 YAML 文本切成「llm-pi-ai 条目 → providers → 每个 provider 块」。
 * @param {string[]} lines - 按 \n 切好的行。
 * @returns {{ start: number, end: number, blocks: { id: string, keyLine: number, indent: number, end: number }[] } | null} 结构；找不到返回 null。
 */
function locate(lines) {
  let start = -1;
  let startIndent = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const entry = /^(\s*)-\s*id:\s*llm-pi-ai\s*$/.exec(lines[i]);
    if (entry !== null) {
      start = i;
      startIndent = entry[1].length;
      break;
    }
  }
  if (start < 0) return null;

  // 同级的下一项（还是插在 insert 下面那种缩进）就算这一段的结尾。
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const sibling = /^(\s*)-\s/.exec(lines[i]);
    if (sibling !== null && sibling[1].length <= startIndent) {
      end = i;
      break;
    }
  }

  let providersAt = -1;
  for (let i = start; i < end; i += 1) {
    const key = /^(\s+)providers:\s*$/.exec(lines[i]);
    if (key !== null && key[1].length > startIndent) {
      providersAt = i;
      break;
    }
  }
  if (providersAt < 0) return null
  const providersIndent = lines[providersAt].match(/^\s*/)[0].length

  const blocks = []
  for (let i = providersAt + 1; i < end; i += 1) {
    const match = /^(\s+)([A-Za-z0-9_.@-]+):\s*$/.exec(lines[i])
    if (match === null) continue
    const indent = match[1].length
    if (indent <= providersIndent) break
    let blockEnd = end
    for (let j = i + 1; j < end; j += 1) {
      const line = lines[j]
      if (line.trim() === '' || /^\s*#/.test(line)) continue
      if (line.match(/^\s*/)[0].length <= indent) {
        blockEnd = j
        break
      }
    }
    blocks.push({ id: match[2], keyLine: i, indent, end: blockEnd })
    i = blockEnd - 1
  }
  return { start, end, blocks }
}

/**
 * 在一段文本里套用「全局默认 + 覆盖」。
 * @param {string} text - 文件内容（已统一成 \n）。
 * @param {string | null} global - 全局默认。
 * @param {Record<string, string | null>} overrides - 每个 provider 的覆盖。
 * @returns {{ text: string, changed: number, providers: { id: string, displayName: string, reasoning: string | null }[] }} 结果。
 */
export function applyToText(text, global, overrides) {
  const lines = text.split('\n')
  const located = locate(lines)
  if (located === null) return { text, changed: 0, providers: [] }

  const providers = []
  let changed = 0

  // 从后往前改：插行/删行都不影响前面 block 的行号。
  for (const block of [...located.blocks].reverse()) {
    const hasOverride = Object.prototype.hasOwnProperty.call(overrides, block.id)
    const effective = hasOverride ? overrides[block.id] : global

    let displayName = block.id
    let reasoningLine = -1
    let insertAt = -1
    for (let i = block.keyLine + 1; i < block.end; i += 1) {
      const line = lines[i]
      if (line.match(/^\s*/)[0].length !== block.indent + 2) continue
      const name = /^\s*displayName:\s*(.+)$/.exec(line)
      if (name !== null) displayName = name[1].trim().replace(/^["']|["']$/g, '')
      if (/^\s*reasoning:/.test(line)) reasoningLine = i
      if (insertAt < 0 && /^\s*models:\s*$/.test(line)) insertAt = i
    }
    if (insertAt < 0) insertAt = block.end
    const pad = ' '.repeat(block.indent + 2)

    if (effective === null) {
      if (reasoningLine >= 0) {
        lines.splice(reasoningLine, 1)
        changed += 1
      }
    } else if (reasoningLine >= 0) {
      const next = `${pad}reasoning: ${effective}`
      if (lines[reasoningLine] !== next) {
        lines[reasoningLine] = next
        changed += 1
      }
    } else {
      lines.splice(insertAt, 0, `${pad}reasoning: ${effective}`)
      changed += 1
    }
    providers.push({ id: block.id, displayName, reasoning: effective })
  }

  providers.reverse()
  return { text: lines.join('\n'), changed, providers }
}

/**
 * 从一段文本里读出每个 provider 现在的 reasoning（真读文件，不推测）。
 * @param {string} text - 文件内容（已统一成 \n）。
 * @returns {{ id: string, displayName: string, reasoning: string | null }[]} 列表。
 */
export function parseProviders(text) {
  const lines = text.split('\n')
  const located = locate(lines)
  if (located === null) return []
  const out = []
  for (const block of located.blocks) {
    let displayName = block.id
    let reasoning = null
    for (let i = block.keyLine + 1; i < block.end; i += 1) {
      const line = lines[i]
      if (line.match(/^\s*/)[0].length !== block.indent + 2) continue
      const name = /^\s*displayName:\s*(.+)$/.exec(line)
      if (name !== null) displayName = name[1].trim().replace(/^["']|["']$/g, '')
      const reason = /^\s*reasoning:\s*(.*)$/.exec(line)
      if (reason !== null) reasoning = reason[1].trim().replace(/^["']|["']$/g, '') || null
    }
    out.push({ id: block.id, displayName, reasoning })
  }
  return out
}

/**
 * 读一下现在配置里各 provider 的实际情况（不写盘）。
 * @returns {{ global: string | null, overrides: Record<string, string | null>, files: { profile: string, file: string }[], providers: { id: string, displayName: string, reasoning: string | null }[] }} 状态。
 */
export function readStatus() {
  const state = readState()
  const files = configFiles()
  // 取并集：desktop 和 headless 各有一份 provider 表，只看第一个文件会漏掉另一个 profile 独有的供应商。
  const merged = new Map()
  for (const entry of files) {
    let text = ''
    try {
      text = readFileSync(entry.file, 'utf8').split('\r\n').join('\n')
    } catch {
      continue
    }
    for (const provider of parseProviders(text)) {
      if (!merged.has(provider.id)) merged.set(provider.id, { ...provider, profile: entry.profile })
    }
  }
  return { global: state.global, overrides: state.overrides, files, providers: [...merged.values()] }
}

/**
 * 套用并写盘。
 * @param {string | null} global - 全局默认。
 * @param {Record<string, string | null>} overrides - 每个 provider 的覆盖。
 * @returns {{ ok: boolean, changed: number, files: { profile: string, file: string, changed: number, providers: object[] }[] }} 结果。
 */
export function applyReasoning(global, overrides) {
  const files = configFiles()
  const written = []
  let changed = 0
  for (const entry of files) {
    const raw = readFileSync(entry.file, 'utf8')
    const crlf = raw.includes('\r\n')
    const normalized = crlf ? raw.split('\r\n').join('\n') : raw
    const result = applyToText(normalized, global, overrides)
    if (result.changed > 0) {
      const backup = `${entry.file}.menuhidden.bak`
      if (!existsSync(backup)) writeFileSync(backup, raw, 'utf8')
      // 先写临时文件再改名：写到一半断电/崩溃也不会把 profile 配置截断成半截 YAML，
      // 那样下次 DSH 起不来，比「没写进去」严重得多。
      const staged = `${entry.file}.menuhidden.tmp`
      const next = crlf ? result.text.split('\n').join('\r\n') : result.text
      try {
        writeFileSync(staged, next, 'utf8')
        renameSync(staged, entry.file)
      } catch (error) {
        try { unlinkSync(staged) } catch {}
        throw error
      }
    }
    changed += result.changed
    written.push({ profile: entry.profile, file: entry.file, changed: result.changed, providers: result.providers })
  }
  saveState({ global, overrides })
  return { ok: true, changed, files: written }
}
