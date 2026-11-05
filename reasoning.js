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
 * 另外两个开关（自动开启推理强度 / 自动配置上下文窗口）也存在这份状态里：
 * 宿主侧的目录监听要读它们，放 localStorage 宿主读不到。
 */
import { existsSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** DSH 认的推理等级取值（dsh-llm-pi-ai 的 THINKING_LEVELS）。 */
export const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'max']

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
 * @returns {{ global: string | null, overrides: Record<string, string | null>, autoReasoning: boolean, autoContextWindow: boolean, autoImageInput: boolean }} 状态。
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
    return {
      global,
      overrides,
      autoReasoning: parsed.autoReasoning !== false,
      autoContextWindow: parsed.autoContextWindow !== false,
      autoImageInput: parsed.autoImageInput !== false,
    }
  } catch {
    return { global: null, overrides: {}, autoReasoning: true, autoContextWindow: true, autoImageInput: true }
  }
}

/**
 * 写状态。
 * @param {{ global: string | null, overrides: Record<string, string | null>, autoReasoning?: boolean, autoContextWindow?: boolean, autoImageInput?: boolean }} state - 状态。
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
 * 只补不改：给缺 provider 级 reasoning 行的供应商补上默认档。
 *
 * 官方的「默认推理等级」只认 provider 级的 reasoning 行：没有这一行，模型就算
 * 声明了一堆档位，选择器也会当成「未指定」，默认档显示成 Default 或干脆空白。
 * 所以这里只补缺失的那一行，已有的（包括手动设的）一个字都不动，也不做删除。
 * @param {string} text - 文件内容（已统一成 \n）。
 * @param {string | null} global - 全局默认。
 * @param {Record<string, string | null>} overrides - 每个 provider 的覆盖。
 * @returns {{ text: string, changed: number, added: { provider: string, level: string }[] }} 结果。
 */
export function ensureProviderReasoningToText(text, global, overrides) {
  const lines = text.split('\n')
  const located = locate(lines)
  if (located === null) return { text, changed: 0, added: [] }
  const added = []
  for (const block of [...located.blocks].reverse()) {
    const hasOverride = Object.prototype.hasOwnProperty.call(overrides ?? {}, block.id)
    const level = hasOverride ? overrides[block.id] : global
    if (level === null || level === undefined || level === '') continue
    const fieldIndent = block.indent + 2
    let present = false
    let insertAt = block.end
    for (let i = block.keyLine + 1; i < block.end; i += 1) {
      const line = lines[i]
      if (line.match(/^\s*/)[0].length !== fieldIndent) continue
      if (/^\s*reasoning:/.test(line)) {
        present = true
        break
      }
      if (/^\s*models:\s*$/.test(line)) insertAt = i
    }
    if (present) continue
    const value = level === 'off' ? '"off"' : level
    lines.splice(insertAt, 0, `${' '.repeat(fieldIndent)}reasoning: ${value}`)
    added.push({ provider: block.id, level })
  }
  added.reverse()
  return { text: lines.join('\n'), changed: added.length, added }
}

/**
 * 从一段文本里读出每个 provider 现在的 reasoning（真读文件，不推测）。
 * @param {string} text - 文件内容（已统一成 \n）。
 * @returns {{ id: string, displayName: string, reasoning: string | null }[]} 列表。
 */
/**
 * 把 provider 的默认档补进每个模型的 reasoningEfforts。
 *
 * DSH 只在模型的 reasoningEfforts 里声明过某档时，才把 provider 的 reasoning 当成这个
 * 模型的默认档；没声明就静默退回 Default，而不少中转站把「没指定」当成关掉思考。
 * 所以「这个供应商默认 high」必须落到模型级的声明上，这一步就是补这个洞。
 *
 * 只加不改：已经声明过的档、没有 reasoningEfforts 的非推理模型，一律不碰。
 * @param {string} text - 文件内容（\n 分隔）。
 * @param {string | null} global - 全局默认档。
 * @param {Record<string, string | null>} overrides - provider 覆盖表。
 * @returns {{ text: string, changed: number, added: { provider: string, model: string, level: string }[] }} 结果。
 */
export function fillMissingToText(text, global, overrides) {
  const lines = text.split('\n')
  const located = locate(lines)
  if (located === null) return { text, changed: 0, added: [] }
  const added = []
  for (const block of [...located.blocks].reverse()) {
    const level = Object.prototype.hasOwnProperty.call(overrides, block.id) ? overrides[block.id] : global
    if (level === null || level === undefined || level === '') continue
    const value = level === 'off' ? 'null' : level
    const modelIndent = block.indent + 4
    const models = []
    for (let i = block.keyLine + 1; i < block.end; i += 1) {
      const match = /^(\s*)- id:\s*(\S+)\s*$/.exec(lines[i])
      if (match !== null && match[1].length === modelIndent) models.push({ id: match[2], at: i })
    }
    for (const model of [...models].reverse()) {
      let end = block.end
      for (let j = model.at + 1; j < block.end; j += 1) {
        if (lines[j].trim() === '') continue
        if (lines[j].match(/^\s*/)[0].length <= modelIndent) {
          end = j
          break
        }
      }
      let effortsAt = -1
      for (let j = model.at + 1; j < end; j += 1) {
        if (/^\s*reasoningEfforts:\s*$/.test(lines[j])) {
          effortsAt = j
          break
        }
      }
      if (effortsAt < 0) continue
      const effortsIndent = lines[effortsAt].match(/^\s*/)[0].length
      let declared = false
      let insertAt = effortsAt + 1
      for (let j = effortsAt + 1; j < end; j += 1) {
        if (lines[j].trim() === '') continue
        if (lines[j].match(/^\s*/)[0].length <= effortsIndent) break
        insertAt = j + 1
        if (new RegExp('^\\s*' + level + ':').test(lines[j])) {
          declared = true
          break
        }
      }
      if (declared) continue
      lines.splice(insertAt, 0, ' '.repeat(effortsIndent + 2) + level + ': ' + value)
      added.push({ provider: block.id, model: model.id, level })
    }
  }
  return { text: lines.join('\n'), changed: added.length, added }
}

/**
 * 按模型 id / name 决定默认上下文窗口大小。
 * GPT 系 272K、Grok 系 200K、其他一律 1M（十进制，跟官方 UI 的 K/M 换算一致）。
 * @param {string} id - 模型 id。
 * @param {string} name - 模型显示名。
 * @returns {number} token 数。
 */
export function contextWindowFor(id, name) {
  const label = `${id ?? ''} ${name ?? ''}`
  if (/gpt/i.test(label)) return 272000
  if (/grok/i.test(label)) return 200000
  return 1000000
}

/**
 * 给模型补齐默认配置：
 * 1. autoReasoning：模型块里没有 reasoningEfforts 时，按官方「推理等级」开关打开的写法
 *    补上 off/low/medium/high/max 五档，等于自动把推理强度开关打开；
 *    已经声明 reasoningEfforts 但缺 max 的模型，补上 max: max。
 * 2. autoContextWindow：模型块里没有 contextWindow 时，按 id/name 补上对应的窗口大小。
 *
 * 只补不改：已经写过的字段（包括显式的 reasoningEfforts: false）一律跳过，
 * 重复跑幂等，不会动用户手动设过的值。
 * @param {string} text - 文件内容（\n 分隔，已统一成 LF）。
 * @param {{ autoReasoning?: boolean, autoContextWindow?: boolean, autoImageInput?: boolean }} flags - 三个开关。
 * @returns {{ text: string, changed: number, added: { provider: string, model: string, field: string }[] }} 结果。
 */
export function autoConfigToText(text, flags = {}) {
  const autoReasoning = flags.autoReasoning !== false
  const autoContextWindow = flags.autoContextWindow !== false
  const autoImageInput = flags.autoImageInput !== false
  if (!autoReasoning && !autoContextWindow && !autoImageInput) return { text, changed: 0, added: [] }
  const lines = text.split('\n')
  const located = locate(lines)
  if (located === null) return { text, changed: 0, added: [] }
  const added = []
  // 从后往前，插行不影响前面 block 的行号。
  for (const block of [...located.blocks].reverse()) {
    const modelIndent = block.indent + 4
    const fieldIndent = block.indent + 6
    const childIndent = block.indent + 8
    const models = []
    for (let i = block.keyLine + 1; i < block.end; i += 1) {
      const match = /^(\s*)- id:\s*(\S+)\s*$/.exec(lines[i])
      if (match !== null && match[1].length === modelIndent) models.push({ id: match[2], at: i })
    }
    for (const model of [...models].reverse()) {
      let end = block.end
      for (let j = model.at + 1; j < block.end; j += 1) {
        if (lines[j].trim() === '') continue
        if (lines[j].match(/^\s*/)[0].length <= modelIndent) {
          end = j
          break
        }
      }
      let name = model.id
      let hasEfforts = false
      let effortsInline = false
      let effortsAt = -1
      let effortsInsertAt = -1
      let effortsChildPad = ' '.repeat(childIndent)
      let hasMax = false
      let hasContext = false
      let hasInput = false
      for (let j = model.at + 1; j < end; j += 1) {
        const line = lines[j]
        if (line.match(/^\s*/)[0].length !== fieldIndent) continue
        const nameMatch = /^\s*name:\s*(.+)$/.exec(line)
        if (nameMatch !== null) name = nameMatch[1].trim().replace(/^["']|["']$/g, '')
        const effortsMatch = /^\s*reasoningEfforts:\s*(.*)$/.exec(line)
        if (effortsMatch !== null) {
          hasEfforts = true
          effortsAt = j
          effortsInline = effortsMatch[1].trim() !== ''
        }
        if (/^\s*contextWindow:/.test(line)) hasContext = true
        if (/^\s*input:/.test(line)) hasInput = true
      }
      if (hasEfforts && effortsAt >= 0 && !effortsInline) {
        let lastChild = effortsAt
        for (let j = effortsAt + 1; j < end; j += 1) {
          const line = lines[j]
          if (line.trim() === '') continue
          const indent = line.match(/^\s*/)[0].length
          if (indent <= fieldIndent) break
          if (lastChild === effortsAt) effortsChildPad = ' '.repeat(indent)
          if (indent === effortsChildPad.length) {
            lastChild = j
            if (/^\s*max:\s*/.test(line)) hasMax = true
          }
        }
        effortsInsertAt = lastChild + 1
      }
      const pad = ' '.repeat(fieldIndent)
      const childPad = ' '.repeat(childIndent)
      const insert = []
      if (autoImageInput && !hasInput) {
        insert.push(`${pad}input: [text, image]`)
        added.push({ provider: block.id, model: model.id, field: 'input' })
      }
      if (autoReasoning && !hasEfforts) {
        insert.push(`${pad}reasoningEfforts:`)
        insert.push(`${childPad}off: null`)
        insert.push(`${childPad}low: low`)
        insert.push(`${childPad}medium: medium`)
        insert.push(`${childPad}high: high`)
        insert.push(`${childPad}max: max`)
        added.push({ provider: block.id, model: model.id, field: 'reasoningEfforts' })
      }
      if (autoContextWindow && !hasContext) {
        insert.push(`${pad}contextWindow: ${contextWindowFor(model.id, name)}`)
        added.push({ provider: block.id, model: model.id, field: 'contextWindow' })
      }
      if (insert.length > 0) lines.splice(end, 0, ...insert)
      if (autoReasoning && hasEfforts && !effortsInline && !hasMax && effortsInsertAt > 0) {
        lines.splice(effortsInsertAt, 0, `${effortsChildPad}max: max`)
        added.push({ provider: block.id, model: model.id, field: 'reasoningEfforts:max' })
      }
    }
  }
  return { text: lines.join('\n'), changed: added.length, added }
}

/**
 * 核对「每个模型真的吃得到这一档吗」。
 * DSH 只在模型的 reasoningEfforts 里声明过该档时，才会把它当成默认档；
 * 没声明的模型会静默退回 Default，界面上看着像「没生效」。
 * @param {string | null} global - 全局默认档。
 * @param {Record<string, string | null>} overrides - provider 覆盖表。
 * @returns {{ profile: string, provider: string, level: string, model: string, declared: string[] }[]} 吃不到该档的模型。
 */
export function auditLevels(global, overrides) {
  const rows = []
  for (const entry of configFiles()) {
    let text
    try {
      text = readFileSync(entry.file, 'utf8')
    } catch {
      continue
    }
    const lines = text.split(/\r?\n/)
    let provider = null
    let model = null
    let declared = []
    let inEfforts = false
    const flush = () => {
      if (provider === null || model === null || declared.length === 0) return
      const level = overrides[provider] === undefined ? global : overrides[provider]
      if (level === null || level === undefined || level === '') return
      if (declared.includes(level)) return
      rows.push({ profile: entry.profile, provider, level, model, declared: [...declared] })
    }
    for (const line of lines) {
      const providerId = /^ {6}([A-Za-z0-9_.-]+):\s*$/.exec(line)
      if (providerId !== null) {
        flush()
        provider = providerId[1]
        model = null
        declared = []
        inEfforts = false
        continue
      }
      const modelId = /^ {10}- id:\s*(\S+)\s*$/.exec(line)
      if (modelId !== null) {
        flush()
        model = modelId[1]
        declared = []
        inEfforts = false
        continue
      }
      if (/^ {12}reasoningEfforts:\s*$/.test(line)) {
        inEfforts = true
        continue
      }
      if (inEfforts) {
        const level = /^ {14}([a-z]+):/.exec(line)
        if (level !== null) {
          declared.push(level[1])
          continue
        }
        if (/^ {12}\S/.test(line)) inEfforts = false
      }
    }
    flush()
  }
  return rows
}

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
 * @returns {{ global: string | null, overrides: Record<string, string | null>, autoReasoning: boolean, autoContextWindow: boolean, autoImageInput: boolean, files: { profile: string, file: string }[], providers: { id: string, displayName: string, reasoning: string | null }[] }} 状态。
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
  return {
    global: state.global,
    overrides: state.overrides,
    autoReasoning: state.autoReasoning,
    autoContextWindow: state.autoContextWindow,
    autoImageInput: state.autoImageInput,
    files,
    providers: [...merged.values()],
  }
}

/**
 * 套用并写盘。
 * @param {string | null} global - 全局默认。
 * @param {Record<string, string | null>} overrides - 每个 provider 的覆盖。
 * @returns {{ ok: boolean, changed: number, files: { profile: string, file: string, changed: number, providers: object[] }[], autoReasoning: boolean, autoContextWindow: boolean, autoImageInput: boolean }} 结果。
 */
export function applyReasoning(global, overrides, extra = {}) {
  const files = configFiles()
  const written = []
  let changed = 0
  for (const entry of files) {
    const raw = readFileSync(entry.file, 'utf8')
    const crlf = raw.includes('\r\n')
    const normalized = crlf ? raw.split('\r\n').join('\n') : raw
    const previousForFlags = readState()
    const effectiveFlags = {
      autoReasoning: typeof extra.autoReasoning === 'boolean' ? extra.autoReasoning : previousForFlags.autoReasoning,
      autoContextWindow: typeof extra.autoContextWindow === 'boolean' ? extra.autoContextWindow : previousForFlags.autoContextWindow,
      autoImageInput: typeof extra.autoImageInput === 'boolean' ? extra.autoImageInput : previousForFlags.autoImageInput,
    }
    // 默认档必须先落到 provider 级的 reasoning 行上，官方的「默认推理等级」才认得。
    const ensured = ensureProviderReasoningToText(normalized, global, overrides)
    const applied = extra.skipReasoningLines === true
      ? { text: ensured.text, changed: 0, providers: parseProviders(ensured.text) }
      : applyToText(ensured.text, global, overrides)
    const configured = autoConfigToText(applied.text, effectiveFlags)
    const filled = extra.skipReasoningLines === true
      ? { text: configured.text, changed: 0, added: [] }
      : fillMissingToText(configured.text, global, overrides)
    const result = {
      text: filled.text,
      changed: ensured.changed + applied.changed + configured.changed + filled.changed,
      providers: applied.providers,
    }
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
  const previous = readState()
  const autoReasoning = typeof extra.autoReasoning === 'boolean' ? extra.autoReasoning : previous.autoReasoning
  const autoContextWindow = typeof extra.autoContextWindow === 'boolean' ? extra.autoContextWindow : previous.autoContextWindow
  const autoImageInput = typeof extra.autoImageInput === 'boolean' ? extra.autoImageInput : previous.autoImageInput
  const same = previous.global === global &&
    previous.autoReasoning === autoReasoning &&
    previous.autoContextWindow === autoContextWindow &&
    previous.autoImageInput === autoImageInput &&
    Object.keys(previous.overrides).length === Object.keys(overrides).length &&
    Object.entries(overrides).every(([id, value]) => previous.overrides[id] === value)
  if (!same) saveState({ global, overrides, autoReasoning, autoContextWindow, autoImageInput })
  return { ok: true, changed, files: written, autoReasoning, autoContextWindow, autoImageInput }
}
