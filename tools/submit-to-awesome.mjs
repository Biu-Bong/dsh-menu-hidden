// 把本插件投到 awesome-dsh-plugin 列表（dsh-market 的目录就来自那里）。
//
//   node tools/submit-to-awesome.mjs --dry-run   # 只打印要提交的文件与条件
//   node tools/submit-to-awesome.mjs             # 真提交：fork → 分支 → 文件 → PR
//
// 幂等：分支已存在就更新文件，PR 已开着就只报告，不再开第二个。
// 仓库创建不满 1 天时直接退出码 2（对方 CI 会拒），隔一会儿再跑。
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const UPSTREAM = 'awesome-dsh-plugin/awesome-dsh-plugin'
const OWNER = 'Biu-Bong'
const REPO = 'dsh-menu-hidden'
const BRANCH = 'add/biu-bong-dsh-menu-hidden'
const FILE = `data/plugins/${OWNER}__${REPO}.yml`
const MIN_AGE_MS = 24 * 60 * 60 * 1000

const dryRun = process.argv.includes('--dry-run')

const cred = execFileSync('git', ['credential', 'fill'], {
  input: 'protocol=https\nhost=github.com\n\n',
  encoding: 'utf8',
})
const token = /^password=(.*)$/m.exec(cred)[1].trim()

const api = async (path, init = {}) => {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      'user-agent': 'dsh-menu-hidden-submit',
      ...(init.headers ?? {}),
    },
  })
  const text = await response.text()
  const body = text === '' ? null : JSON.parse(text)
  if (!response.ok) {
    const error = new Error(`${init.method ?? 'GET'} ${path} -> ${response.status} ${body?.message ?? text.slice(0, 200)}`)
    error.status = response.status
    throw error
  }
  return body
}

const entry = `url: https://github.com/${OWNER}/${REPO}
name: ${OWNER}/${REPO}
category: ui
description:
  en: Lazy Menu for DSH — hide the duplicate DeepSeek account / official API entries in the model picker, in Settings → Models and in the subagent model list, plus sidebar and account-menu items (14 toggles); auto-fill reasoning levels (low / medium / high / max), context window and image input for new models; add Reload / Restart to the application menu with a backup and one-click restore.
  zh: 懒人菜单：收起模型选择框、设置·模型、子智能体里重复的 DeepSeek 账号 / 官方 API 分组，隐藏侧边栏五项与账号菜单三项（共 14 个开关）；给新模型自动补推理等级（low / medium / high / max）、上下文窗口与图片支持；应用菜单补上刷新与重启，写入前自动备份、可一键还原。
icon: https://raw.githubusercontent.com/${OWNER}/${REPO}/main/docs/icon-180.png
`

const repo = await api(`/repos/${OWNER}/${REPO}`)
const ageMs = Date.now() - Date.parse(repo.created_at)
const ageHours = (ageMs / 3_600_000).toFixed(1)
console.log(`仓库 ${repo.full_name} 创建于 ${repo.created_at}（${ageHours} 小时前），topics: ${(repo.topics ?? []).join(', ') || '无'}`)
console.log(`列表要求 ≥ 24 小时：${ageMs >= MIN_AGE_MS ? '满足' : '还不满足'}`)

const manifest = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
if (manifest.dsh?.bundle?.patch === undefined) throw new Error('package.json 没有 dsh.bundle.patch，列表会拒')
if (!fs.existsSync(new URL('../cordis.patch.yml', import.meta.url))) throw new Error('缺 cordis.patch.yml')

if (dryRun) {
  console.log(`\n将写入 ${UPSTREAM} 的 ${FILE}：\n`)
  console.log(entry)
  process.exit(0)
}

if (ageMs < MIN_AGE_MS) {
  console.error('还没到 24 小时，先别提交：对方 CI 会自动拒掉，过一会儿再跑这条命令。')
  process.exit(2)
}

// 1) fork（已存在就是 200/202 的老结果，照样能用）
try {
  await api(`/repos/${UPSTREAM}/forks`, { method: 'POST', body: '{}' })
} catch (error) {
  if (error.status !== 422) throw error
}
for (let attempt = 0; attempt < 20; attempt += 1) {
  try {
    await api(`/repos/${OWNER}/${UPSTREAM.split('/')[1]}`)
    break
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 3000))
  }
}

// 2) 分支（存在就复用）
const upstreamMain = await api(`/repos/${UPSTREAM}/git/ref/heads/main`)
try {
  await api(`/repos/${OWNER}/${UPSTREAM.split('/')[1]}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha: upstreamMain.object.sha }),
  })
  console.log('分支已建', BRANCH)
} catch (error) {
  if (error.status !== 422) throw error
  console.log('分支已存在，复用', BRANCH)
}

// 3) 文件（新文件不带 sha；已存在则先取 sha 再更新）
const fork = `${OWNER}/${UPSTREAM.split('/')[1]}`
let sha
try {
  sha = (await api(`/repos/${fork}/contents/${FILE}?ref=${BRANCH}`)).sha
} catch (error) {
  if (error.status !== 404) throw error
}
await api(`/repos/${fork}/contents/${FILE}`, {
  method: 'PUT',
  body: JSON.stringify({
    message: `Add ${OWNER}/${REPO}`,
    content: Buffer.from(entry, 'utf8').toString('base64'),
    branch: BRANCH,
    ...(sha === undefined ? {} : { sha }),
  }),
})
console.log('文件已提交', FILE)

// 4) PR（已开就报告）
const existing = await api(`/repos/${UPSTREAM}/pulls?head=${OWNER}:${BRANCH}&state=open`)
if (existing.length > 0) {
  console.log('PR 已存在：', existing[0].html_url)
  process.exit(0)
}
const pr = await api(`/repos/${UPSTREAM}/pulls`, {
  method: 'POST',
  body: JSON.stringify({
    title: `Add ${OWNER}/${REPO}`,
    head: `${OWNER}:${BRANCH}`,
    base: 'main',
    body: [
      `Adds **${OWNER}/${REPO}** — Lazy Menu for DSH: hides the duplicate DeepSeek account / official API entries (model picker groups, Settings rows and the subagent list), hides the sidebar and account-menu items (14 toggles in total), auto-fills reasoning levels (low / medium / high / max), context window and image input for new models, and adds Reload / Restart to the application menu with a backup and one-click restore.`,
      '',
      '- `package.json` declares `dsh.bundle` (`./cordis.patch.yml`) — installs with `dsh plugin add github:Biu-Bong/dsh-menu-hidden`.',
      '- 14 toggles in **Settings → 懒人菜单 → 菜单隐藏**; the application-menu patch is a button plus one restart, keeps `.menuhidden.bak` and can be reverted byte-for-byte.',
      '- Storefront icon added: `docs/icon-180.png` (the tile used to fall back to the owner avatar).',
      '- Repository topic `dsh-plugin` is set.',
      '',
      'Install:',
      '',
      '```bash',
      'dsh plugin --profile desktop add github:Biu-Bong/dsh-menu-hidden#v0.2.30',
      '```',
    ].join('\n'),
  }),
})
console.log('PR 已开：', pr.html_url)
