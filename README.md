# @local/dsh-menu-hidden · 菜单隐藏

把 DSH 界面上重复的 DeepSeek 账号 / 官方 API 入口收起来，并给应用菜单补上「刷新页面」「重启应用与 Host」。
开关在 **设置 → 菜单隐藏**，改完立刻生效，不用刷新页面。

## 对应关系

| # | 要的效果 | 实现方式 | 生效时机 |
|---|---|---|---|
| 1 | 模型选择框里隐藏「DeepSeek 账号」分组 | 客户端 DOM：`section[data-menu-group]` 按标题文字整组隐藏 | 立刻 |
| 2 | 模型选择框里隐藏「DeepSeek」（官方 API）分组 | 同上 | 立刻 |
| 3 | 设置 · 模型里隐藏「DeepSeek 账号」整行 | 客户端 DOM：整行 `li` 藏掉（编辑 / 删除一起走），先用 `[class*="_accountStatus"]` 认出这是账号行 | 立刻 |
| 4 | 设置 · 模型里隐藏「DeepSeek」官方 API 那一行 | 客户端 DOM：隐藏该行 `<li>` | 立刻 |
| 5 | 应用菜单「退出」上方加「刷新页面」「重启应用与 Host」 | 宿主半：给 `lib/main.js` 的 `applicationItems()` 打开官方留着的 `development` 门（幂等、留备份 `.menuhidden.bak`、可还原） | 改完**重启一次应用** |
| 6 | 账号菜单里隐藏「意见反馈」 | 客户端 DOM：按文字认菜单项，藏掉（只剩它一个时连容器一起藏） | 立刻 |
| 7 | 账号菜单里隐藏「退出登录」 | 同上，两个开关各管一项，认不到就跳过 | 立刻 |

## 为什么第 5 条要动外壳文件

官方本来就有这两项，写在 `lib/main.js` 的 `applicationItems()` 里：

```js
...development ? [
  { type: "separator" },
  { label: messages.reloadPageMenu, role: "reload" },
  { label: messages.restartAppHostMenu, click: () => { app.relaunch(); quitWithoutConfirmation() } }
] : [],
```

打包版 `development = !app.isPackaged` 恒为 `false`，整段被丢掉。Windows 上「应用」菜单是点开时用 `Menu.buildFromTemplate(items).popup()` 现拼的原生菜单，浏览器端碰不到，所以只能在主进程那边把门打开：

```js
...(development || true) ? [
```

改完 `Menu` 在下次启动时才重建，所以那两项要重启一次应用才出现。插件把这个动作做成了设置页上的两个按钮（写入补丁 / 还原），走一条本机路由，写入端带平台浏览器鉴权 —— 不带会话 cookie 的本机进程会被 401 挡回去。

## 推理等级（0.2.0）

各家中转站的后台只有在请求里带了推理等级时才显示得出来，DSH 只有在 provider 上写了
`reasoning: <level>` 才会带。手动给每个 provider 加一行、每加一个新供应商再加一次，很烦。

这个分区把这件事收成两档：

- **全局默认**：所有没单独设置的供应商都用这一档。
- **按供应商单独设置**：`跟随全局` / `不设置` / 具体档位（off, minimal, low, medium, high, xhigh, max）。

写入的是 profile 的 `cordis.patch.yml` 里 `- id: llm-pi-ai` → `config.providers.<id>.reasoning`：

- 纯行级编辑，注释、缩进、其它字段一个字不动；
- 幂等，值已经对了就不写盘；
- 写之前留 `cordis.patch.yml.menuhidden.bak`（每次写入都刷新，避免留着过期的旧备份）；
- 先写同目录临时文件再改名，写到一半中断也不会把配置截成半截 YAML；
- 只处理正式 profile（跳过 `_` 开头的探查 profile）；
- 状态存在 `$DSH_HOME/dsh-menu-hidden.reasoning.json`。

改完不用重启：模型配置是热读的（`llm-pi-ai` 监听 `internal/config`），下一条消息就带上新的推理等级。

## 设置页

说明文字走两种写法：「推理等级」是这一页里的第四个标题，和「模型选择框」「设置 · 模型」「账号菜单」用同一套样式（14px / 500），下面直接跟一行灰色小字说明；其余说明收进标题右边的 ⓘ，鼠标悬浮或 Tab 过去才浮出来。

设置 → 菜单隐藏，四个并列标题（模型选择框 / 设置 · 模型 / 账号菜单 / 推理等级）+ 底部两行外壳操作：

1. **模型选择框**：两开关，隐藏下拉框里的「DeepSeek 账号」分组 / 「DeepSeek」官方 API 分组。
2. **设置 · 模型**：两开关，管设置页里的两行 provider（账号选项卡 / 官方 API 选项卡）。
3. **账号菜单**：两开关，管右下角头像菜单里的「意见反馈」「退出登录」。账号菜单是另一处界面，所以单独成组，和「设置 · 模型」并列。
4. **推理等级**：全局默认（带 ⓘ）+ 按供应商覆盖，写入 profile 配置；面板重新获得焦点时会自动重读，也可以点「重新读取」手动刷出刚加的供应商。

十二个开关都存 `localStorage` 的 `dsh-menu-hidden:v1`，翻一下立刻重扫 DOM。
- 「应用菜单」那一行显示当前外壳状态（已写入 / 未改动 / 没找到文件）+ 写入 / 还原按钮。
- 最后一行是「现在刷新一次界面」，等同应用菜单里的「刷新页面」。
- 「推理等级」是大类标题，不带 ⓘ；「全局默认」保留 ⓘ。
- 语言按应用当前语言走（中文 / English 两套齐全）。

隐藏只改 `style="display:none!important"` 并在节点上打 `data-dshmh-hidden`（值 = 隐藏前的整个 `style` 属性），不删节点、不动 React props。关掉开关就把 `style` 原样还回去，所以随时可逆。

## 语言：为什么有时候整页变英文

DSH 查字典用的是应用当前语言的**原样小写标签**：渲染进程的 locale 是 `zh-CN`（启动日志里 `locale: zh-CN` 那一行），查表键就是 `zh-cn`，查不到才沿回退链落到 `en`。只注册 `zh` 一份，就会掉进英文——看着像「插件没翻译」，其实是键没命中。

插件的做法（`client.js` 里的 `bindLocale()`）：

- 用单 locale 形式 `register(ns, locale, dict)` 注册 `zh` / `zh-CN` / `zh-Hans` / `en` 四份，标签怎么解析都能命中；
- 热重载时同一个 namespace 重复注册会抛 `already has locale`，抛了也照样继续 `bind`，不会退回「原样返回键名」；
- 应用是中文而字典只回了英文（或回了键名）时，补中文兜底。

回归测试：`test/locale.mjs`，模拟 DSH 的查表规则，断言 `zh-CN` / `zh-Hans` / `zh` 都出中文、`en` 出英文、重复注册后翻译函数仍然活着。

## 图标与列表标题

插件列表里那一行由两个文件决定，都不在 `client.js` 里：

| 元素 | 来源 |
|---|---|
| 图标 | `package.json` 的 `icon`（这里是 `./icon.svg`），配 `exports["./icon"]` |
| 标题 / 描述 | `locale/zh.json`、`locale/en.json` 的 `meta.title`、`meta.description`，按界面语言自动切换 |

```json
// locale/zh.json
{ "meta": {
    "title": "菜单隐藏 (dsh-menu-hidden)",
    "description": "添加重启和刷新菜单；侧边栏项目、官方模型分组、重复选项卡一键隐藏，可改默认推理等级（避免中转站取不到推理强度）。"
} }
```

三点经验：标题照 `中文名 (英文名)` 写，和「IM 机器人 (dsh-im)」那种条目排在一起才整齐；`meta.description` 只写用户能看见的结果（藏什么、加了什么菜单），别写实现；改完 `locale` 记得抬 `version`，否则清单缓存会继续用旧标题。

## 更新记录

- **0.2.17**：图标改白底；列表标题与描述走 `locale/*.json` 的 `meta`（标题变成「菜单隐藏 (dsh-menu-hidden)」）；新增 `tools/install-local.mjs`（装进 profile 前校验包名、loader id、patch id 三处一致，含覆盖安装与体检模式）。
- **0.2.16**：把发布描述改成短句，补 `descriptionEn`。
- **0.2.15**：头部三颗胶囊（GitHub / 问题反馈 / 检查更新）；「已是最新」态；更新弹窗（运行版本、最新版本、目标 profile、手工命令、自动更新）。
- **0.2.14**：头部不再折行，版本号常驻。
- **0.2.13**：功能分组标题加粗。
- **0.2.12**：版本号与标题共享基线；外链不再跳两次。
- **0.2.8**：新增「隐藏新会话」与「检查更新」。
- **0.2.7**：新增「侧边栏」分组（插件 / 定时任务 / 更多）。
- **0.2.6**：子智能体分组按 provider id 认，官方那组标题也叫 `DeepSeek` 时也能藏。
- **0.2.4**：新增「账号菜单」分组（意见反馈 / 退出登录）；修 `zh-CN` 下整页英文。
- **0.2.0**：推理等级写入 `cordis.patch.yml`。
- **0.1.4**：菜单壳按住两帧，消掉隐藏时的闪烁。
- **0.1.1**：修 0.1.0 的启动白屏（`module.exports` → `return { name, inject, apply }`）。

## 认节点的方式

| 位置 | 选择器 | 稳定性 |
|---|---|---|
| 模型下拉框分组 | `section[data-menu-group]` + `[data-menu-group-heading]` | 官方 MenuGroup 的 data 属性，稳 |
| 分组标题文字 | `DeepSeek 账号` / `DeepSeek Account`、`DeepSeek` | 官方 locale 与 provider displayName |
| 设置·模型 行名 | `[class*="_rowName"]`（Vite CSS Modules 的 `_hash_rowName`） | 用后缀，换版本不失效 |
| 已登录徽标 | `[class*="_accountStatus"]` | 同上 |
| 账号菜单项 | `[role="menuitem"]` 且文字是 `意见反馈` / `Feedback` | 官方菜单没有 data 属性，只能按文字 |

找不到就安静跳过，不抛错、不碰别的地方。

## 已知边界

- **外壳补丁会被应用更新冲掉**：DSH 更新会整份替换 `resources/app/lib/main.js`，补丁随之消失。设置页那一行会显示「未改动」，点一下「写入补丁」即可，不需要重装插件。
- **只认文字与结构，不认内部 id**：模型下拉框靠 `section[data-menu-group]` + 分组标题文字，设置行靠 class 后缀 `_rowName` / `_accountStatus`，账号菜单靠菜单项文字。官方把这些结构改名后，对应那一条会静默失效（其它条不受影响），设置页不会报错。
- **同名供应商会被一起藏**：如果你自己加了一个 displayName 恰好叫 `DeepSeek` 的供应商，它和官方那一行看起来一样，也会被「隐藏官方 API」一起藏掉。
- **改的是本机文件**：推理等级写的是 `$DSH_HOME/profiles/*/cordis.patch.yml`，外壳补丁写的是安装目录里的 `main.js`；换机器、换用户目录都要重来一遍。

## 安装 / 卸载

- 安装：`dsh plugin --profile desktop add github:Biu-Bong/dsh-menu-hidden`，或插件市场里点安装。
- 卸载：`dsh plugin --profile desktop remove dsh-menu-hidden`。
- 外壳补丁独立于插件存在：卸载插件不会把 `main.js` 改回去。要还原就先点「还原」，或直接跑
  `node <项目目录>/shell/patch-shell-menu.mjs --revert`。

## 本地覆盖安装 / 体检

往 profile 的 `node_modules` 里手工拷文件是这类插件最容易出事的一步：拷的时候包名、`client.js` 的 loader id、`cordis.patch.yml` 的 id 必须三处一致，漏一处就是整个界面起不来。用这个脚本代劳：

```bash
# 从发布副本装进 desktop profile（落盘前会先体检，不过就一个字节都不写）
node tools/install-local.mjs

# 只检查，不动文件
node tools/install-local.mjs --dry-run

# 检查任意一个已经装好的目录
node tools/install-local.mjs --check "$DSH_HOME/profiles/desktop/node_modules/dsh-menu-hidden"

# 从开发副本装（自动把 @local/dsh-menu-hidden 改成 dsh-menu-hidden）
node tools/install-local.mjs --from plugin

# 装到别的 profile，或整个别的目录
node tools/install-local.mjs --profile web
node tools/install-local.mjs --target D:/somewhere/dsh-menu-hidden
```

它落盘前会依次确认：

| 检查 | 不通过时的后果 |
|---|---|
| `package.json.name`、`client.js` 的 `id`、`cordis.patch.yml` 的 `id`/`name` 四处一致 | 前端 boot 找不到 factory，**整个应用停在 Failed to load plugins** |
| `__ModuleLoader__.load(...)` 正好出现一次 | 同一份 bundle 被执行两次 → `duplicate factory registration` |
| 没有 `module.exports`，有 `return { name, inject, apply }` | `module is not defined`，同上 |
| 每个 `.js` 过一遍 `node --check` | 语法错误会让整条 bundle 报废 |
| `icon` 指向的文件存在、`locale/zh.json` 与 `locale/en.json` 都有 `meta.title` / `meta.description` | 列表退回默认占位图与包名 |

覆盖已有目录时会先把旧目录备份成 `<目录>.bak-<时间戳>`；`--no-backup` 可关掉（备份 `repo/` 这种带 `.git` 的目录会很慢）。

## 排障：装完一重启，整个界面起不来

表现是启动后停在「Failed to load plugins」，或者只能看到白屏；重启没用，因为坏文件就在 profile 里，每次启动重放同一份失败。

先看日志，别猜：

```powershell
Get-ChildItem "$env:USERPROFILE\AppData\Roaming\@deepseek-ai\dsh-desktop\logs" -Filter 'crash-*.log' |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1 | Get-Content
```

`*-web-boot.log` 是前端半，`*-host.log` 是宿主半。

最常见的两句原文与含义：

```text
duplicate factory registration for "@local/dsh-menu-hidden"
  (bundle executed twice without invalidate?)
```
包里 `client.js` 注册的 id 和包名不一致：boot 按包名没找到，就拿单独 URL 再拉一次同一份字节，第二次执行撞上重复注册。**把 `client.js` 的 loader id 改成包名**。

```text
@scope/pkg: import failed: module is not defined
```
`client.js` 用了 CommonJS 的 `module.exports`；`window.__ModuleLoader__` 的 factory 只给 `require`，导出要 `return { name, inject, apply }`。

三步处理，代价从轻到重：

1. 跑 `node tools/install-local.mjs --check <安装目录>`，它会直接说出哪一处不一致。
2. `dsh plugin --profile desktop remove dsh-menu-hidden`，重启；插件卸掉不影响会话与凭据。
3. 进不去界面时用干净 profile 救：`dsh --profile rescue`（把可疑插件在设置里关掉），再回 desktop。

整份 `~/.dsh` 不用删，重装应用也不用——这类故障基本都是一行 id 的问题。
