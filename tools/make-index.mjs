// 生成插件市场索引（format 1）的脚本。
//
//   node tools/make-index.mjs            # 用当前 HEAD 写 market/index.json
//   node tools/make-index.mjs --check    # 只校验，不写盘
//
// 索引里每个版本的 source 都是 git，commit 钉死到该版本的提交，
// 所以装的是确定的那一版，不是「main 的最新状态」。
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const OUT = `${ROOT}market/index.json`
const REPO_URL = 'https://github.com/Biu-Bong/dsh-menu-hidden'

const pkg = JSON.parse(fs.readFileSync(`${ROOT}package.json`, 'utf8'))
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim()
const publishTimestamp = Number(
  execFileSync('git', ['log', '-1', '--format=%ct'], { cwd: ROOT, encoding: 'utf8' }).trim()
)

const pkgRepo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url ?? REPO_URL
const repoTarget = pkgRepo.replace(/^git\+/, '').replace(/\.git$/, '')

const index = {
  format: 1,
  title: { zh: '小胖鱼 DSH 插件', en: 'DSH plugins by Biu-Bong' },
  description: {
    zh: '自己维护的 DSH 组合包索引。',
    en: 'A hand-maintained index of DSH bundles.',
  },
  metadata: {
    categories: {
      interface: { title: { zh: '界面', en: 'Interface' } },
    },
    labels: {
      'zh-only': { title: { zh: '中文文档', en: 'Chinese docs' } },
      'no-network': { title: { zh: '不改网络请求', en: 'No network calls' } },
    },
    sortKeys: {
      order: { title: { zh: '手工排序', en: 'Curated order' }, order: 'asc' },
    },
  },
  plugins: [
    {
      name: pkg.name,
      title: { zh: '菜单隐藏', en: 'Menu Hiding' },
      description: {
        zh: '收起 DSH 里重复的 DeepSeek 账号 / 官方 API 入口，隐藏侧边栏项目、账号菜单的意见反馈与退出登录，给应用菜单补上刷新与重启；推理等级一键写死，新供应商新模型自动补齐。',
        en: 'Hide the duplicate DeepSeek account / official API entries, sidebar items and the Feedback / Sign out items; add Reload / Restart to the application menu; pin a reasoning level and auto-fill new providers and models.',
      },
      icon: 'icon.svg',
      author: 'Biu-Bong',
      homepage: 'https://github.com/Biu-Bong/dsh-menu-hidden#readme',
      repository: { url: repoTarget },
      metadata: {
        category: 'interface',
        keywords: ['menu', 'hide', 'deepseek', 'reasoning', 'settings', '菜单', '隐藏', '推理等级'],
        labels: ['zh-only', 'no-network'],
        sortKeys: { order: 10 },
      },
      versions: [
        {
          version: pkg.version,
          publishTimestamp,
          source: { type: 'git', url: repoTarget, commit },
          engines: { dsh: pkg.engines?.dsh ?? '>=0.2.0-rc.1' },
        },
      ],
    },
  ],
}

// 自校验：用 DSH 自带的校验器过一遍，过不了就别发布。
// 安装位置因机器而异，所以按环境变量 + 常见安装位逐个试，最后退回裸包名。
const validatorCandidates = []
for (const base of [process.env.DSH_INSTALL_DIR, process.env.DSH_APP_DIR]) {
  if (typeof base === 'string' && base.length > 0) {
    validatorCandidates.push(`${base}/resources/app/dsh/node_modules/@deepseek-ai/dsh-plugin-market-index/lib/index.js`)
  }
}
for (const base of [process.env.LOCALAPPDATA, process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']]) {
  if (typeof base === 'string' && base.length > 0) {
    validatorCandidates.push(`${base}/Programs/DeepSeek Harness/resources/app/dsh/node_modules/@deepseek-ai/dsh-plugin-market-index/lib/index.js`)
    validatorCandidates.push(`${base}/DeepSeek Harness/resources/app/dsh/node_modules/@deepseek-ai/dsh-plugin-market-index/lib/index.js`)
  }
}
validatorCandidates.push('@deepseek-ai/dsh-plugin-market-index')

let validator
for (const candidate of validatorCandidates) {
  try {
    validator = await import(candidate.startsWith('@') ? candidate : pathToFileURL(candidate).href)
    break
  } catch {
    /* 下一个 */
  }
}
if (validator === undefined) {
  console.error('没找到 @deepseek-ai/dsh-plugin-market-index，本次跳过 DSH 自带校验（索引仍会写出）')
}

const parsed = validator.parseMarketIndex(index, 'https://example.invalid/market/index.json')
const plugin = parsed.plugins[0]
const target = validator.marketInstallTarget(plugin.name, plugin.versions[0])
console.log(
  JSON.stringify(
    {
      ok: true,
      version: plugin.versions[0].version,
      icon: plugin.icon,
      spec: target.spec,
      commit,
    },
    null,
    1
  )
)

if (!process.argv.includes('--check')) {
  fs.mkdirSync(`${ROOT}market`, { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(index, null, 2) + '\n', 'utf8')
  console.log('written', OUT)
}
