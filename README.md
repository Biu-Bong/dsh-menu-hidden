# dsh-menu-hidden · 懒人菜单

DSH 插件。三件事，改完都在 **设置 → 懒人菜单** 里开关，立刻生效：

- **菜单隐藏** —— 模型选择框里重复的 DeepSeek 账号 / 官方 API 分组、设置里两行重复的选项卡、子智能体里的两组、侧边栏五项、账号菜单三项，14 个开关逐项管。
- **模型配置** —— 新模型自动补齐推理等级、上下文窗口、图片支持；全局默认 + 按供应商覆盖；新供应商、新模型自动补字段。
- **菜单增强** —— 应用菜单补上官方藏起来的「刷新页面」「重启应用与 Host」，写入前留备份，可一键还原。

## 安装

```bash
dsh plugin --profile desktop add github:Biu-Bong/dsh-menu-hidden
```

也可以在插件市场里搜「懒人菜单 / Lazy Menu」点安装。

装完**刷新一次页面**，「设置」里就多一页「懒人菜单」。想让应用菜单里出现「刷新页面」「重启应用与 Host」，再做两步：

1. 设置 → 懒人菜单 → 菜单增强，点「写入补丁」（自动备份 `main.js`）；
2. **重启一次应用**（应用菜单里还没有，就先退出再开）。

## 卸载

```bash
dsh plugin --profile desktop remove dsh-menu-hidden
```

- 0.2.28 起外壳补丁带运行时自检：插件卸掉，那两项菜单下次启动自动消失，不用手动还原。
- 想立刻把 `main.js` 还原成官方原文（逐字节一致），在设置页点「还原」，或：

```bash
node node_modules/dsh-menu-hidden/shell/patch-shell-menu.mjs --revert
```

## 效果

对比图按真实界面的文案、分组顺序和配色复刻。图里的第三方厂商与模型都是示例名字（GPT 6.1 Sol / GPT 6 Astra / Claude Opus 5.5 / Grok 4.6 / Grok 4.7），不代表任何真实账号。

**模型下拉框**　左：装之前（「DeepSeek 账号」和「DeepSeek」两组重复）　右：装之后（只剩 OpenAI / Anthropic / xAI）

<p><img src="docs/model-menu-before.png" width="290"> <img src="docs/model-menu-after.png" width="290"></p>

**设置 · 模型**　左：装之前（两行 DeepSeek，其中一行带「已登录」）　右：装之后

<p><img src="docs/settings-models-before.png" width="430"> <img src="docs/settings-models-after.png" width="430"></p>

**账号菜单**　左：装之前（设置 / 意见反馈 / 退出登录）　右：装之后

<p><img src="docs/account-menu-before.png" width="185"> <img src="docs/account-menu-after.png" width="185"></p>

**应用菜单**　左：装之前　右：写入补丁并重启之后

<p><img src="docs/app-menu-before.png" width="200"> <img src="docs/app-menu-after.png" width="200"></p>

**设置 → 懒人菜单**（插件自己的页面，三个标签）

| 菜单隐藏 | 模型配置 | 菜单增强 |
|---|---|---|
| ![菜单隐藏](preview/settings-0.2.26-1.png) | ![模型配置](preview/settings-0.2.26-2.png) | ![菜单增强](preview/settings-0.2.26-3.png) |

> 截图里的供应商名称与 id 均为示例数据。

## 三块功能

### 一、菜单隐藏（14 个开关）

| 位置 | 藏什么 | 开关 |
|---|---|---|
| 模型选择框 | 「DeepSeek 账号」「DeepSeek」官方 API 两个分组，整组收起 | 2 |
| 子智能体 | 模型列表里对应的两组供应商 | 2 |
| 设置 · 模型 | 两行重复的 provider 选项卡（编辑 / 删除一起走） | 2 |
| 侧边栏 | Logo / 新会话 / 插件 / 定时任务 / 更多 | 5 |
| 账号菜单 | 设置 / 意见反馈 / 退出登录 | 3 |

隐藏只给节点加一条 `style="display:none!important"` 并打上 `data-dshmh-hidden`（值记着原来的整个 `style`），不删节点、不动 React props。关掉开关就把 `style` 原样还回去，所以随时可逆，也不会影响任何功能。

### 二、模型配置

- **自动开启推理等级**：补齐 off / minimal / low / medium / high / max 六档，老模型缺 `max` 也补。
- **自动配置上下文窗口**：GPT 272K、Grok 200K、其余 1M。
- **自动开启图片支持**：自动补 `input: image`。
- **按供应商覆盖**：全局默认一档，单独给 OpenAI 走 `max`、Grok 走 `high`、Gemini 走 `medium`；写完热读生效，不用重启，下一条消息就带上新档位。
- **新供应商、新模型也自动补**：上面三个开关同时盯 profile 目录，新加的供应商按全局默认补一行 `reasoning`，新模型往 `reasoningEfforts` 里补一条 —— 只加不改，手写的值一个字不动，1.5 秒防抖。
- **思考深度只留六档（常开）**：聊天框那个思考深度菜单里不再出现 `Xhigh`，配置里 `reasoningEfforts` 的那一行也删掉；只删这一行，别的档位和注释一个字不动。
- **隐藏推理菜单里的 `Default`（常开）**：中转站常把「没指定」当成关掉思考，这个选项直接藏掉，免得误选；同一菜单里没有别的档位时不动手。

### 三、菜单增强

- 应用菜单「退出」上方加「刷新页面」「重启应用与 Host」。
- 写入前自动备份成 `main.js.menuhidden.bak`，点「还原」逐字节回到官方原文。
- 带运行时自检：插件在，菜单项在；插件卸了，下次启动自动消失。
- 页头三颗胶囊：GitHub / 问题反馈 / 检查更新（已是最新时显示「✓ 已是最新」，有新版本变红点，点开是更新窗口）。

## 设置页

三个标签、14 个开关，全部存在 `localStorage` 的 `dsh-menu-hidden:v1`；翻一下立刻重扫 DOM，不用刷新页面。

- 菜单隐藏：四个并列标题（模型选择框 / 设置 · 模型 / 侧边栏 / 账号菜单），底部两行外壳操作。
- 模型配置：三个自动补齐开关 + 全局默认 + 按供应商覆盖；面板重新获得焦点会自动重读，也可以点「重新读取」刷出刚加的供应商。这三个开关写进 profile 的 `cordis.patch.yml`，其它 14 个藏在 `localStorage`。
- 菜单增强：显示外壳当前状态（已写入 / 未改动 / 没找到文件）+ 写入 / 还原按钮，最后一行是「现在刷新一次界面」。
- 语言跟随应用当前语言（中文 / English 两套齐全）。

## 常见问题

**会不会把官方菜单删掉？**
不会。只加样式、不删节点，开关一关界面和没装过一样。

**升级 DSH 之后菜单项没了？**
应用更新会整份替换 `main.js`，补丁跟着消失，设置页那一行会显示「未改动」。点一下「写入补丁」再重启，不用重装插件。

**要重启吗？**
设置页里所有开关立刻生效；推理等级是热读的，写完下一条消息就带新档位；只有应用菜单那两项要重启一次才出现。

**卸载干净吗？**
卸载只删插件本体。0.2.28 起补丁带自检，下次启动菜单项自动消失；想立刻还原就跑 `--revert`。

**支持哪些供应商？**
按 provider id 认，OpenAI、Anthropic、Grok、Google 这类第三方供应商都在内，模型名不受限制 —— 新加什么模型，字段都按同一套逻辑补。

**为什么有时候整页变英文？**
DSH 查字典用的是应用当前语言的原样小写标签（`zh-CN` → `zh-cn`），只注册 `zh` 一份就会掉进英文。插件注册了 `zh` / `zh-CN` / `zh-Hans` / `en` 四份，标签怎么解析都能命中。

## 已知边界

- **外壳补丁会被应用更新冲掉**：更新后点一次「写入补丁」即可，不需要重装。
- **只认文字与结构，不认内部 id**：官方改了分组标题或 class 后缀，对应那一条会静默失效，其它条不受影响，设置页不会报错。
- **同名供应商会被一起藏**：自己加了一个 displayName 正好叫 `DeepSeek` 的供应商，也会被「隐藏官方 API」一起藏掉。
- **改的是本机文件**：推理等级写 `$DSH_HOME/profiles/*/cordis.patch.yml`，外壳补丁写安装目录里的 `main.js`；换机器、换用户目录都要重来一遍。

## 排障

**装完一重启，整个界面起不来**
先看日志，别猜：`resources/app` 同级的 `logs` 目录里，`*-web-boot.log` 是前端半，`*-host.log` 是宿主半。

```powershell
Get-ChildItem "$env:APPDATA/@deepseek-ai/dsh-desktop/logs" -Filter 'crash-*.log' |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1 | Get-Content
```

三步处理，代价从轻到重：

1. `node tools/install-local.mjs --check <安装目录>`，它会直接说出哪一处不一致；
2. `dsh plugin --profile desktop remove dsh-menu-hidden`，重启，插件卸掉不影响会话与凭据；
3. 进不去界面时用干净 profile 救：`dsh --profile rescue`，把可疑插件关掉，再回 desktop。

**换过插件文件之后，一按「刷新页面」就白屏**
Host 启动时扫一遍 `node_modules` 建好模块清单，之后一直拿着这份清单。运行期间替换了 `client.js`，刷新时前端按新包要模块、Host 手里还是旧清单，导入失败一次，而 `web boot` 是「有一项没激活就整体不启动」。**换完文件要重启应用，不要只按刷新页面** —— 重启后它自己就恢复正常。

**日志里是 `duplicate factory registration`**
`client.js` 注册的 id 和包名不一致：boot 按包名没找到，又拿单独 URL 拉一次同一份字节，第二次执行撞上重复注册。把 `client.js` 的 loader id 改成包名即可。

**日志里是 `module is not defined`**
用错了导出方式。`window.__ModuleLoader__` 的 factory 只给 `require`，导出要 `return { name, apply }`，不能写 `module.exports`。

## 开发

```
index.js                 宿主半：本机路由 + 外壳补丁 + 推理等级写入 + 新模型字段补齐
client.js                客户端半：DOM 隐藏引擎 + 设置页
reasoning.js             推理等级读写 cordis.patch.yml
cordis.patch.yml         宿主半挂载行
locale/{zh,en}.json      文案 + 列表标题
shell/patch-shell-menu.mjs   外壳菜单补丁 CLI（--status / --apply / --revert / --dry-run）
tools/install-local.mjs  本地覆盖安装 + 落盘前体检
test/*.mjs               回归测试（node test/client-dom.mjs 等，共 7 个）
manifest: market/index.json  插件市集条目
```

- 测试（前五个要吃 `client.js` 路径，`test/client-links.mjs` 与 `test/shell-selfcheck.mjs` 直接跑）：

```bash
node test/client-dom.mjs client.js
node test/client-degraded.mjs client.js
node test/client-load.mjs client.js
node test/client-subagent-off.mjs client.js
node test/locale.mjs client.js
node test/client-links.mjs
node test/shell-selfcheck.mjs
```
- 本地覆盖安装：`node tools/install-local.mjs`（先体检，不过就一个字节都不写）；`--dry-run` 只检查；`--check <目录>` 体检已装好的那份；`--from plugin` 从开发副本装并自动改包名。
- 插件列表里的图标来自 `package.json` 的 `icon`，标题和描述来自 `locale/*.json` 的 `meta.title` / `meta.description`；改完记得抬 `version`，否则字段清单缓存会继续用旧标题。

**认节点的方式**（官方改结构时会失效的那几条）

| 位置 | 选择器 | 稳定性 |
|---|---|---|
| 模型下拉框分组 | `section[data-menu-group]` + `[data-menu-group-heading]` | 官方 data 属性，稳 |
| 分组标题文字 | `DeepSeek 账号` / `DeepSeek Account`、`DeepSeek` | 官方 locale 与 displayName |
| 设置·模型 行名 | `[class*="_rowName"]`（取后缀，不认 hash） | 换版本不失效 |
| 已登录徽标 | `[class*="_accountStatus"]` | 同上 |
| 账号菜单项 | `[role="menuitem"]` + 文字 | 官方菜单没有 data 属性，只能按文字 |

**外壳补丁为什么必须动 `main.js`**：那两项官方本来就写好了，只是被 `development` 这个门挡着（打包版恒为 `false`）；Windows 的应用菜单是点开时现拼的原生菜单，浏览器端碰不到，只能在主进程那边把门打开。0.2.28 起门后面是「插件还在不在」的运行时自检（扫 `$DSH_HOME/profiles/*/node_modules/dsh-menu-hidden/package.json`，跳过 `_` 开头的探查 profile），所以卸载之后它会自己关上。

## 更新记录

- **0.2.30**：思考深度彻底去掉 `xhigh`。设置页下拉框早就只有六档，但聊天框那个思考深度菜单是按模型 `reasoningEfforts` 渲染的 —— 配置里声明了 `xhigh`，菜单里就还会多一项 `Xhigh`。现在两处一起处理：界面上把这一项藏掉，配置里那行也删掉（幂等，别的档位与注释不动）。
- **0.2.29**：推理等级去掉 `xhigh`，档位收敛成 off / minimal / low / medium / high / max 六档，下拉框里不再出现这一档；老配置里写过的 `xhigh` 会被当成「跟随全局」读回，不写盘也不删行。
- **0.2.28**：外壳补丁自愈。写进 `main.js` 的条件从恒真改成运行时自检，卸载后菜单项下次启动自动消失，重装又自动出现；老版本写进去的恒真补丁仍能被识别、还原并顺手升级。CLI 写入改成临时文件 + rename 原子替换。
- **0.2.27**：启动安全。顶层不再写 `inject`，改成 scoped `ctx.inject(...)` + 全程 try/catch —— 服务没到只降级，entry 始终 active，不会再让整个前端卡在 `web boot: N entries did not activate`。
- **0.2.26**：自动补齐从 5 秒轮询改成「目录事件 + 60 秒兜底 stat」，稳态 CPU 降一个量级。
- **0.2.25**：新增「隐藏推理等级里的 `Default`」。
- **0.2.21**：自动补齐真正接上定时器；切换供应商时不再整表重渲染。
- **0.2.20**：`__ModuleLoader__.load` 包 try/catch，重复注册不再拖垮 web boot。
- **0.2.17**：列表标题与描述走 `locale/*.json` 的 `meta`；新增 `tools/install-local.mjs`。
- **0.2.15**：页头三颗胶囊 + 检查更新。
- **0.2.7 / 0.2.8**：新增「侧边栏」分组、「隐藏新会话」。
- **0.2.4**：新增「账号菜单」分组；修 `zh-CN` 下整页英文。
- **0.2.0**：推理等级写入 `cordis.patch.yml`。
- **0.1.1**：修 0.1.0 启动白屏（`module.exports` → `return { name, apply }`）。

完整历史见 releases。
