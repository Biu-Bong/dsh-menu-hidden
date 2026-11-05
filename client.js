/**
 * dsh-menu-hidden · 客户端半（Web）
 *
 * 六个动作里，五个是纯 DOM 的（模型选择框两个分组、设置·模型两处、账号菜单的意见反馈），
 * 第六个（应用菜单里的刷新 / 重启）落在外壳主进程，交给宿主半打补丁，这里只负责开关和状态。
 *
 * 设计上的三条硬约束：
 * 1. 只改 style / 打标记，不删节点、不动 React 的 props。React 重渲染时我们的 display:none
 *    不会被覆盖（它只在 props 里写了 className，没写 style），所以流式输出、切换会话都不会闪回来。
 * 2. 一律可逆。关掉开关就把 style 原样还回去 —— 用户不用刷新页面。
 * 3. 认节点靠稳定的结构标记，不靠哈希类名：菜单分组用官方 MenuGroup 渲染出来的
 *    section[data-menu-group] + [data-menu-group-heading]；设置页那两行没有 data 属性，
 *    只能退一步用 class 后缀（*_rowName / *_accountStatus），所以写了两套识别方式并在
 *    找不到时安静跳过，不报错、不影响别处。
 *
 * 开关存在 localStorage（键 dsh-menu-hidden:v1），保存即生效。
 */

function registerClient() {
	return window.__ModuleLoader__.load({
	// factory id 必须等于 package.json 的包名，否则 boot 图里找不到 factory。
	id: "dsh-menu-hidden",
	factory: (require) => {
		const React = require("react");

		/** 官方共享组件库；拿不到就退回原生 input，界面不会崩。 */
		let UI = null;
		try {
			UI = require("@deepseek-ai/dsh-client-ui-primitives");
		} catch {
			UI = null;
		}
		const OfficialSwitch = UI && typeof UI.Switch === "function" ? UI.Switch : null;
		const OfficialButton = UI && typeof UI.Button === "function" ? UI.Button : null;

		const ID = "dsh-menu-hidden";
		const LOCALE_NS = "dsh-menu-hidden";
		const STORE_KEY = "dsh-menu-hidden:v1";
		/** 打在被隐藏节点上的标记；值 = 隐藏前的整个 style 属性，用来原样还原。 */
		const MARK = "data-dshmh-hidden";
		const SHELL_ROUTE = "/dsh-menu-hidden/api/shell-menu";
		const REASONING_ROUTE = "/dsh-menu-hidden/api/reasoning";
		const UPDATE_ROUTE = "/dsh-menu-hidden/api/update";
		/** 一分钟内只自动查一次：面板来回切、React 重挂载都不会连打两炮。 */
		const UPDATE_DEDUPE_MS = 60 * 1000;
		let updateCheckedAt = 0;
		const REPO_URL = "https://github.com/Biu-Bong/dsh-menu-hidden";
		const REPO_SLUG = "Biu-Bong/dsh-menu-hidden";
		/** 内置版本号：页面一挂载就能显示，不等后端返回。发布时由 tools/sync-repo.mjs 改写。 */
		const VERSION = "0.2.30";
		const SETTINGS_SECTION_SLOT = "settings.section";

		// ── §1 文案（跟随应用语言） ────────────────────────────────────────────
		const DICT = {
			zh: {
				sectionLabel: "懒人菜单",
				title: "懒人菜单",
				desc: "1. 应用菜单增加刷新与重启功能。\n2. 新模型自动补足推理等级、上下文窗口和图片支持。\n3. 侧边栏、账号菜单、模型配置等多项隐藏。",
				tabHide: "菜单隐藏",
				tabModels: "模型配置",
				tabEnhance: "菜单增强",
				groupPicker: "模型选择框",
				groupSettings: "设置 · 模型",
				accountGroupLabel: "隐藏「DeepSeek 账号」分组",
				accountGroupHint: "模型下拉框里那个带账号图标的分组，连它的模型一起藏。",
				subagentAccountLabel: "隐藏子智能体里的「DeepSeek Account」",
				subagentAccountHint: "子智能体的模型选择里，「Agent 可选择的模型」那一块按供应商分组，这里藏掉 DeepSeek Account 那一组。",
				subagentOfficialLabel: "隐藏子智能体里的「DeepSeek 官方 API」",
				subagentOfficialHint: "同一个列表里的 DeepSeek 官方 API 那一组，连它的模型一起藏。",
				officialGroupLabel: "隐藏「DeepSeek官方 API」分组",
				officialGroupHint: "模型下拉框里官方 API 那一组。两组都关掉，下拉框会只剩第三方模型。",
				accountRowLabel: "隐藏「DeepSeek 账号」选项卡",
				accountRowHint: "设置 · 模型里账号那一条整行消失，右边的编辑 / 删除一起走 —— 不是只藏「已登录」三个字。",
				officialRowLabel: "隐藏「DeepSeek官方 API」选项卡",
				officialRowHint: "设置 · 模型里只留一个 DeepSeek 账号，不再出现第二个 DeepSeek 行。整行藏掉后，改官方 API 的入口也一起没了。",
				groupModelFeatures: "模型功能",
				hostFeatureHint: "宿主侧插件还是旧版本，这几个开关要重启应用后才生效；现在点不会写配置。",
				modelFeaturesDesc: "添加新模型、或发现已有档位缺 max 时，按下面三个开关自动补齐配置；只补缺失的字段，已经设过的值不改。",
				autoReasoningLabel: "自动开启推理等级",
				autoReasoningHint: "新添加的模型没有推理等级开关时，自动写入 off / low / medium / high / max 五档；已有档位但缺 max 的模型自动补上 max: max。已经写过的字段不改。",
				autoReasoningOn: "已开启自动开启推理等级。",
				autoReasoningOff: "已关闭自动开启推理等级，新模型要自己点「写入配置」。",
				autoContextLabel: "自动配置上下文窗口大小",
				autoContextHint: "新添加的模型没设置上下文窗口时自动补上：GPT 系 272K、Grok 系 200K、其他模型 1M；已经设过的模型不改。",
				autoContextOn: "已开启自动配置上下文窗口。",
				autoContextOff: "已关闭自动配置上下文窗口，新模型沿用官方默认值。",
				autoImageLabel: "自动开启图片支持",
				autoImageHint: "新添加的模型没声明输入类型时，自动写上 input: [text, image]；已经声明过输入类型的模型不改。",
				autoImageOn: "已开启自动开启图片支持。",
				autoImageOff: "已关闭自动开启图片支持，新模型只收文字。",
				groupReasoning: "推理等级",
				reasoningDesc: "给每个模型供应商写一行 reasoning，中转站后台才显示得出推理等级；不写那边只画一道杠。",
				reasoningGlobal: "全局默认",
				reasoningGlobalHint: "所有没单独设置的供应商都用这一档。",
				reasoningNone: "不设置",
				reasoningFollow: "跟随全局",
				reasoningProviders: "按供应商单独设置",
				reasoningApply: "写入配置",
				reasoningReload: "重新读取",
				reasoningApplied: "已写入，新会话生效。",
				reasoningSkipped: "；但这些模型没声明这一档，仍会显示 Default：{models}",
				reasoningUnchanged: "配置一致，无改动。",
				reasoningReloaded: "已重新读取。",
				reasoningFailed: "写入失败：",
				reasoningEmpty: "没找到带 llm-pi-ai 的 profile 配置。",
				groupAccount: "账号菜单",
				groupSidebar: "侧边栏",
				sidebarPluginsLabel: "隐藏侧边栏的「插件」",
				sidebarPluginsHint: "左栏那排图标里的插件入口。藏掉之后还能从「更多」或命令面板进。",
				sidebarSchedulesLabel: "隐藏侧边栏的「定时任务」",
				sidebarSchedulesHint: "同一排图标里的定时任务入口。",
				sidebarMoreLabel: "隐藏侧边栏的「更多」",
				sidebarMoreHint: "那排图标最后的「更多」，点开是没固定在侧栏的面板。藏掉之后它们只能靠命令面板进。",
				sidebarNewSessionLabel: "隐藏侧边栏的「新会话」",
				sidebarNewSessionHint: "那个大按钮。点左上角的 LOGO 一样能开新会话，Ctrl+N 也还在。",
				sidebarLogoLabel: "隐藏 DeepSeek Harness Logo",
				sidebarLogoHint: "左上角那条品牌行（图标加名字）。折叠按钮和新建会话都还在。",
				updateCheck: "检查更新",
				updateChecking: "检查中…",
				updateLatest: "已是最新",
				updateNew: "有新版本",
				updateFailed: "检查失败",
				updateRepo: "项目地址",
				updateDownload: "去下载",
				dialogUpdateSuffix: "更新",
				dialogClose: "关闭",
				dialogScope: "仅检查并更新当前插件，不会联动安装其他插件。",
				dialogRunning: "运行版本",
				dialogLatest: "最新版本",
				dialogProfile: "目标 profile",
				dialogFound: "发现新版本",
				dialogManual: "手工更新",
				dialogManualNote: "自动更新失败时，先把 DSH 完全退出，再用桌面版自带的 dsh 执行下面这条命令。",
				dialogCopy: "复制命令",
				dialogCopied: "已复制",
				dialogRecheck: "重新检查",
				dialogAuto: "自动更新",
				dialogInstalling: "正在更新…",
				dialogInstallDone: "已更新，重启一次 DSH 生效。",
				githubLabel: "GitHub",
				issueLabel: "问题反馈",
				hideSettingsLabel: "隐藏「设置」",
				hideSettingsHint: "账号菜单里的「设置」。藏掉之后点左下角头像会直接打开设置面板，入口不会丢；要用菜单里的意见反馈或退出登录，先把这个开关关掉。",
				feedbackLabel: "隐藏「意见反馈」",
				feedbackHint: "右下角头像点开的那份菜单里的「意见反馈」。",
				signOutLabel: "隐藏「退出登录」",
				signOutHint: "同一份菜单里的「退出登录」。藏掉之后账号菜单只剩「设置」；需要退出时把这里关掉即可。",
				shellLabel: "应用菜单：补上「刷新页面」「重启应用与 Host」",
				shellHint: "改的是应用外壳的开关，随时可还原，重启生效。",
				shellStateOn: "已写入",
				shellStateOff: "未改动",
				shellStateMissing: "没找到外壳 main.js",
				shellApply: "写入补丁",
				shellRollback: "还原",
				shellWrote: "已写入。",
				shellReverted: "已还原。",
				shellUnchanged: "状态已经是这样，没有改动文件。",
				shellFailed: "失败：",
				refreshLabel: "刷新页面",
				refreshHint: "重新加载渲染进程，不重启 Host，正在跑的任务不受影响。",
				refreshAction: "刷新页面",
			},
			en: {
				sectionLabel: "Lazy Menu",
				title: "Lazy Menu",
				desc: "1. Reload and Restart land in the app menu.\n2. New models get reasoning levels, context window and image input filled automatically.\n3. Sidebar items, account-menu items and model-picker groups can be hidden one by one.",
				tabHide: "Menu hiding",
				tabModels: "Model setup",
				tabEnhance: "Menu tools",
				groupPicker: "Model picker",
				groupSettings: "Settings · Models",
				accountGroupLabel: "Hide the \"DeepSeek Account\" group",
				accountGroupHint: "The account group at the top of the model dropdown, models included.",
				subagentAccountLabel: "Hide \"DeepSeek Account\" in the Subagent model list",
				subagentAccountHint: "The Subagent settings page lists allowed models by provider; this hides the DeepSeek Account group, models included.",
				subagentOfficialLabel: "Hide \"DeepSeek official API\" in the Subagent model list",
				subagentOfficialHint: "The same list\u2019s DeepSeek official API group, models included.",
				officialGroupLabel: "Hide the \"DeepSeek official API\" group",
				officialGroupHint: "The official API group in the model dropdown. Hiding both leaves only third-party models.",
				accountRowLabel: "Hide the \"DeepSeek Account\" tab",
				accountRowHint: "The entire row disappears from the Models page, buttons included — not just the Signed in text.",
				officialRowLabel: "Hide the \"DeepSeek official API\" tab",
				groupModelFeatures: "Model features",
				hostFeatureHint: "The host plugin is still the old build; restart the app to activate these toggles. Nothing is written until then.",
				modelFeaturesDesc: "When a model is added or an existing model lacks max, these three toggles fill in missing config. Existing values are never overwritten.",
				autoReasoningLabel: "Auto-enable reasoning level",
				autoReasoningHint: "For a newly added model with no reasoning-level switch, write off / low / medium / high / max. Models that already declare efforts but lack max get max: max added. Existing values are never overwritten.",
				autoReasoningOn: "Auto-enable reasoning level is on.",
				autoReasoningOff: "Auto-enable reasoning level is off; new models wait for Write to config.",
				autoContextLabel: "Auto-configure context window",
				autoContextHint: "For a newly added model with no context window, fill 272K for GPT, 200K for Grok, 1M for everything else. Existing values are never overwritten.",
				autoContextOn: "Auto-configure context window is on.",
				autoContextOff: "Auto-configure context window is off; new models use the provider default.",
				autoImageLabel: "Auto-enable image input",
				autoImageHint: "For a newly added model with no input modalities declared, write input: [text, image]. Models that already declare input are left alone.",
				autoImageOn: "Auto-enable image input is on.",
				autoImageOff: "Auto-enable image input is off; new models accept text only.",
				groupReasoning: "Reasoning level",
				reasoningDesc: "Writes one reasoning line per provider so the relay dashboard can show a reasoning level instead of a dash.",
				reasoningGlobal: "Global default",
				reasoningGlobalHint: "Every provider without its own setting follows this level.",
				reasoningNone: "Not set",
				reasoningFollow: "Follow global",
				reasoningProviders: "Per provider",
				reasoningApply: "Write to config",
				reasoningReload: "Reload",
				reasoningApplied: "Written. Takes effect in a new session.",
				reasoningSkipped: "; but these models do not declare that level and still show Default: {models}",
				reasoningUnchanged: "Config matches; nothing to change.",
				reasoningReloaded: "Reloaded.",
				reasoningFailed: "Failed: ",
				reasoningEmpty: "No profile config with llm-pi-ai was found.",
				officialRowHint: "Leaves a single account row on the Models page. The row is the only entry point for editing the official API key.",
				groupAccount: "Account menu",
				groupSidebar: "Sidebar",
				sidebarPluginsLabel: "Hide \"Plugins\" in the sidebar",
				sidebarPluginsHint: "The Plugins entry in the left rail. It stays reachable from More or the command palette.",
				sidebarSchedulesLabel: "Hide \"Scheduled tasks\" in the sidebar",
				sidebarSchedulesHint: "The Scheduled tasks entry in the same rail.",
				sidebarMoreLabel: "Hide \"More\" in the sidebar",
				sidebarMoreHint: "The More launcher at the end of the rail; the panels it opens stay reachable from the command palette.",
				sidebarNewSessionLabel: "Hide \"New session\" in the sidebar",
				sidebarNewSessionHint: "The big button. The brand mark and Ctrl+N still start a session.",
				sidebarLogoLabel: "Hide the DeepSeek Harness logo",
				sidebarLogoHint: "The brand row at the top-left (mark plus name). The collapse toggle and new-session shortcut still work.",
				updateCheck: "Check for updates",
				updateChecking: "Checking…",
				updateLatest: "Up to date",
				updateNew: "New version",
				updateFailed: "Check failed",
				updateRepo: "Project",
				updateDownload: "Download",
				dialogUpdateSuffix: "update",
				dialogClose: "Close",
				dialogScope: "Checks and updates this plugin only. No other plugin is touched.",
				dialogRunning: "Running",
				dialogLatest: "Latest",
				dialogProfile: "Profile",
				dialogFound: "New version",
				dialogManual: "Update by hand",
				dialogManualNote: "Quit DSH completely first, then run this with the dsh that ships with the desktop app.",
				dialogCopy: "Copy",
				dialogCopied: "Copied",
				dialogRecheck: "Check again",
				dialogAuto: "Update now",
				dialogInstalling: "Updating…",
				dialogInstallDone: "Updated. Restart DSH once.",
				githubLabel: "GitHub",
				issueLabel: "Feedback",
				hideSettingsLabel: "Hide \"Settings\"",
				hideSettingsHint: "The Settings item in the account menu. With it hidden, clicking the avatar at the bottom left opens Settings directly, so the entry never goes missing. Turn this off when you need Feedback or Sign out from that menu.",
				feedbackLabel: "Hide \"Feedback\"",
				feedbackHint: "The Feedback item in the account menu opened from the avatar at the bottom right.",
				signOutLabel: "Hide \"Sign out\"",
				signOutHint: "The Sign out item in the same menu. With it hidden the menu keeps only Settings; turn it back on here when you need to sign out.",
				shellLabel: "Application menu: add Reload Page and Restart App and Host",
				shellHint: "Flips a switch in the app shell. Reversible, takes effect after one restart.",
				shellStateOn: "Written",
				shellStateOff: "Not applied",
				shellStateMissing: "Shell main.js not found",
				shellApply: "Apply patch",
				shellRollback: "Revert",
				shellWrote: "Written.",
				shellReverted: "Reverted.",
				shellUnchanged: "Already in that state; the file was not touched.",
				shellFailed: "Failed: ",
				refreshLabel: "Reload page",
				refreshHint: "Reloads the renderer without restarting the Host, so running tasks keep going.",
				refreshAction: "Reload page",
			},
		};
		/** apply() 里由 ctx.locale.bind() 换成真翻译函数；没绑上时原样返回键名。 */
		let t = (key) => key;

		// ── §2 开关（默认全开：插件的存在意义就是把这些东西收起来） ────────────
		const DEFAULTS = {
			accountGroup: true,
			officialGroup: true,
			sidebarPlugins: true,
			sidebarSchedules: true,
			sidebarMore: true,
			sidebarNewSession: true,
			sidebarLogo: true,
			subagentAccount: true,
			subagentOfficial: true,
			accountRow: true,
			officialRow: true,
			feedback: true,
			signOut: true,
			hideSettings: true,
		};
		const prefs = { ...DEFAULTS };

		function loadPrefs() {
			try {
				const raw = window.localStorage.getItem(STORE_KEY);
				if (raw === null) return;
				const parsed = JSON.parse(raw);
				for (const key of Object.keys(DEFAULTS)) {
					if (typeof parsed[key] === "boolean") prefs[key] = parsed[key];
				}
			} catch {
				/* 坏数据就当没有，用默认值 */
			}
		}

		function savePrefs() {
			try {
				window.localStorage.setItem(STORE_KEY, JSON.stringify(prefs));
			} catch {
				/* 隐私模式下写不进去，本次会话内仍然生效 */
			}
		}

		// ── §3 认节点用的常量 ─────────────────────────────────────────────────
		/** 模型下拉框里账号分组的标题：官方 t("provider.account")。 */
		const ACCOUNT_GROUP_LABELS = ["DeepSeek 账号", "DeepSeek Account"];
		/** 官方 API 分组的标题就是 provider 的 displayName。 */
		const OFFICIAL_GROUP_LABELS = ["DeepSeek", "DeepSeek 官方 API", "DeepSeek 官方API", "DeepSeek Official API"];
		/** 子智能体设置页里按供应商分的组：标题是 provider 的 displayName。 */
		const SUBAGENT_ACCOUNT_LABELS = ["deepseekaccount", "deepseek账号"];
		const SUBAGENT_OFFICIAL_LABELS = ["deepseek官方api", "deepseekofficialapi"];
		/** 设置 · 模型页的 provider 行名。 */
		const ACCOUNT_ROW_LABELS = ["DeepSeek 账号", "DeepSeek Account"];
		const OFFICIAL_ROW_LABELS = ["DeepSeek"];
		/** 账号菜单里的意见反馈。 */
		const FEEDBACK_LABELS = ["意见反馈", "Feedback"];
		/** 账号菜单里的退出登录。 */
		const SIGN_OUT_LABELS = ["退出登录", "退出帳號", "Sign out", "Log out", "Sign Out"];
		/** 账号菜单里的设置。 */
		const SETTINGS_LABELS = ["设置", "Settings"];
		/** 左下角账号菜单的触发器：button[aria-haspopup="menu"][aria-label=t("menu")]。 */
		const ACCOUNT_TRIGGER_LABELS = ["账号菜单", "Account menu"];
		/** 设置页 provider 行的类名后缀（Vite CSS Modules：_hash_rowName）。 */
		const ROW_NAME_SELECTOR = '[class*="_rowName"]';
		const MENU_GROUP_SELECTOR = "section[data-menu-group]";
		const MENU_ITEM_SELECTOR = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';
		const DEFAULT_LABELS = ["Default", "默认"];
		/** 思考深度菜单里要藏掉的档位（只藏菜单项，不动模型列表、不动触发器）。 */
		const HIDDEN_EFFORT_LABELS = ["xhigh"];
		const EFFORT_RADIO_SELECTOR = '[role="menuitemradio"], [role="option"]';
		const DEFAULT_RADIO_SELECTOR = '[role="menuitemradio"]';
		const DEFAULT_TEXT_SELECTOR = '[class*="triggerEffort"], [class*="cellValue"]';
		const MENU_SURFACE_SELECTOR = '[role="menu"]';
		const ACCOUNT_BADGE_SELECTOR = '[class*="_accountStatus"]';
		/** 子智能体设置页的供应商分组（Vite CSS Modules：_hash_modelGroup / _hash_providerName）。 */
		const SUBAGENT_GROUP_SELECTOR = '[class*="_modelGroup"]';
		/** 子智能体列表每行的副标题：「DeepSeek · deepseek-official/deepseek-flash」，provider id 比显示名可靠。 */
		/** 侧边栏那排面板图标：button[class*="_panelRow"]，名字在 aria-label 上（收起时只有它）。 */
		const SIDEBAR_ROW_SELECTOR = 'button[class*="_panelRow"]';
		const SIDEBAR_PLUGINS_LABELS = ["插件", "Plugins"];
		const SIDEBAR_SCHEDULES_LABELS = ["定时任务", "Scheduled tasks", "Schedules"];
		const SIDEBAR_MORE_LABELS = ["更多", "More"];
		/** 「新会话」大按钮：button._newSession，收起时变成标题栏里的小图标，同样认类名。 */
		const SIDEBAR_NEW_SESSION_SELECTOR = 'button[class*="_newSession"]';
		const SIDEBAR_BRAND_SELECTOR = '[class*="brandIdentity"]';
		const SUBAGENT_ROUTE_SELECTOR = '[class*="_route"]';
		const SUBAGENT_PROVIDER_SELECTOR = '[class*="_providerName"]';

		// ── §4 隐藏 / 还原 ────────────────────────────────────────────────────
		/**
		 * 藏起或放回一个节点。只碰 style，节点本身留在 DOM 里，React 的 diff 不受影响。
		 * @param {Element | null} element - 目标节点。
		 * @param {boolean} hide - 是否隐藏。
		 */
		function setHidden(element, hide) {
			if (element === null || element === undefined || element.nodeType !== 1) return;
			if (hide) {
				// React 可能重写 style（动画帧、二次提交），MARK 还在但 display 被抹掉过，
				// 所以每次都补一次，而不是看到 MARK 就撒手。
				if (!element.hasAttribute(MARK)) element.setAttribute(MARK, element.getAttribute("style") ?? "");
				if (element.style.getPropertyValue("display") !== "none") element.style.setProperty("display", "none", "important");
				return;
			}
			if (!element.hasAttribute(MARK)) return;
			const previous = element.getAttribute(MARK) ?? "";
			element.removeAttribute(MARK);
			if (previous === "") element.removeAttribute("style");
			else element.setAttribute("style", previous);
		}

		/**
		 * 账号菜单里的「设置」后面可能跟着快捷键角标（⌘, / Ctrl+, …），按前缀认；
		 * 别的项没有角标，仍旧全等，免得「设置」把不相干的项也吃进来。
		 * @param {string[]} labels - 候选文案。
		 * @param {string} text - 节点文字（已 trim）。
		 * @returns {boolean} 命中与否。
		 */
		function matchesAccountItem(labels, text) {
			if (labels === SETTINGS_LABELS) return labels.some((label) => text.startsWith(label));
			return matches(labels, text);
		}
		/**
		 * 两套文案里有没有这条文字。
		 * @param {string[]} labels - 候选文案。
		 * @param {string} text - 节点文字（已 trim）。
		 * @returns {boolean} 命中与否。
		 */
		function matches(labels, text) {
			return labels.some((label) => label === text);
		}

		/**
		 * 从 DOM 节点摸到 React fiber，再往上找带 openSettings 的那个组件。
		 * 官方账号菜单里的「设置」点下去就是调它；我们要在没有菜单的情况下直接把设置面板开出来。
		 * @param {Element} element - 触发器节点。
		 * @returns {(() => void) | null} 打开设置的方法，摸不到就是 null。
		 */
		function openSettingsFrom(element) {
			let fiber = null;
			for (const key of Object.keys(element)) {
				if (key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")) {
					fiber = element[key];
					break;
				}
			}
			let depth = 0;
			while (fiber !== null && fiber !== undefined && depth < 80) {
				const props = fiber.memoizedProps;
				if (props !== null && typeof props === "object" && typeof props.openSettings === "function") return props.openSettings;
				fiber = fiber.return;
				depth += 1;
			}
			return null;
		}

		/**
		 * 挨个点一遍账号菜单里被藏起来的「设置」。display:none 的元素用 .click() 照样触发
		 * React 的 onClick，所以这条退路不依赖 fiber。
		 * @returns {boolean} 点到没有。
		 */
		function clickHiddenSettingsItem() {
			for (const item of document.querySelectorAll(MENU_ITEM_SELECTOR)) {
				const text = (item.textContent ?? "").trim();
				if (!matchesAccountItem(SETTINGS_LABELS, text)) continue;
				if (!item.hasAttribute(MARK)) continue;
				item.click();
				return true;
			}
			return false;
		}

		/** 已经挂过监听的触发器，React 重渲染换了节点会再挂一次。 */
		const fallbackWired = new WeakSet();

		/**
		 * 设置入口兜底：藏了账号菜单里的「设置」之后，点左下角头像得直接开设置面板，
		 * 否则用户手里一个设置入口都不剩。先摸 fiber 直接调 openSettings；摸不到就让菜单
		 * 照常打开，下一帧点那条藏起来的「设置」，两条路总有一条通。
		 */
		function wireAccountFallback() {
			if (typeof document === "undefined") return;
			for (const trigger of document.querySelectorAll('button[aria-haspopup="menu"]')) {
				const label = (trigger.getAttribute("aria-label") ?? "").trim();
				if (!matches(ACCOUNT_TRIGGER_LABELS, label)) continue;
				if (fallbackWired.has(trigger)) continue;
				fallbackWired.add(trigger);
				trigger.addEventListener("click", (event) => {
					if (prefs.hideSettings !== true) return;
					let opener = null;
					try {
						opener = openSettingsFrom(trigger);
					} catch (error) {
						console.error("[dsh-menu-hidden] openSettings lookup failed", error);
					}
					if (opener !== null) {
						event.preventDefault();
						event.stopPropagation();
						event.stopImmediatePropagation();
						try {
							opener();
						} catch (error) {
							console.error("[dsh-menu-hidden] openSettings failed", error);
						}
						return;
					}
					window.setTimeout(() => {
						clickHiddenSettingsItem();
					}, 30);
				}, true);
			}
		}

		/** 模型下拉框：按分组标题认，连标题带模型整组藏。 */
		function sweepModelMenu(root) {
			const sections = root.matches(MENU_GROUP_SELECTOR) ? [root, ...root.querySelectorAll(MENU_GROUP_SELECTOR)] : [...root.querySelectorAll(MENU_GROUP_SELECTOR)];
			for (const section of sections) {
				const heading = section.querySelector("[data-menu-group-heading]");
				if (heading === null) continue;
				const text = (heading.textContent ?? "").trim();
				if (matches(ACCOUNT_GROUP_LABELS, text)) {
					setHidden(section, prefs.accountGroup === true);
				} else if (matches(OFFICIAL_GROUP_LABELS, text)) {
					setHidden(section, prefs.officialGroup === true);
				} else {
					setHidden(section, false);
				}
			}
		}

		/** 设置 · 模型：藏官方 API 整行，藏账号行的「已登录」。 */
		function sweepSettingsRows(root) {
			const names = root.matches(ROW_NAME_SELECTOR) ? [root, ...root.querySelectorAll(ROW_NAME_SELECTOR)] : [...root.querySelectorAll(ROW_NAME_SELECTOR)];
			for (const name of names) {
				const row = name.closest('li, [class*="_rowCard"]');
				if (row === null) continue;
				const text = (name.textContent ?? "").trim();
				if (matches(OFFICIAL_ROW_LABELS, text)) {
					setHidden(row, prefs.officialRow === true);
					continue;
				}
				if (!matches(ACCOUNT_ROW_LABELS, text)) continue;
				setHidden(row, prefs.accountRow === true);
				// 旧版只藏过徽标，升级上来时把残留的 display:none 还回去。
				for (const badge of row.querySelectorAll(ACCOUNT_BADGE_SELECTOR)) setHidden(badge, false);
			}
		}

		/** 侧边栏面板图标：按 aria-label 认（收起时没有文字，只剩它）。 */
		function sweepSidebarNav(root) {
			const rows = root.matches(SIDEBAR_ROW_SELECTOR) ? [root, ...root.querySelectorAll(SIDEBAR_ROW_SELECTOR)] : [...root.querySelectorAll(SIDEBAR_ROW_SELECTOR)];
			const create = root.matches(SIDEBAR_NEW_SESSION_SELECTOR) ? [root, ...root.querySelectorAll(SIDEBAR_NEW_SESSION_SELECTOR)] : [...root.querySelectorAll(SIDEBAR_NEW_SESSION_SELECTOR)];
			for (const button of create) setHidden(button, prefs.sidebarNewSession === true);
			const brands = root.matches(SIDEBAR_BRAND_SELECTOR) ? [root, ...root.querySelectorAll(SIDEBAR_BRAND_SELECTOR)] : [...root.querySelectorAll(SIDEBAR_BRAND_SELECTOR)];
			for (const brand of brands) setHidden(brand, prefs.sidebarLogo === true);
			for (const row of rows) {
				const text = (row.getAttribute("aria-label") ?? row.textContent ?? "").trim();
				if (matches(SIDEBAR_PLUGINS_LABELS, text)) setHidden(row, prefs.sidebarPlugins === true);
				else if (matches(SIDEBAR_SCHEDULES_LABELS, text)) setHidden(row, prefs.sidebarSchedules === true);
				else if (matches(SIDEBAR_MORE_LABELS, text)) setHidden(row, prefs.sidebarMore === true);
			}
		}

		/**
		 * 子智能体设置页：整组藏。
		 * 先看行里的 route（provider id 稳定：deepseek-official / deepseek-account），
		 * 拿不到再退回标题文字 —— 这页的标题是 provider displayName，官方那组就叫「DeepSeek」。
		 */
		function sweepSubagentModels(root) {
			const norm = (text) => text.replace(/[\s\u3000]+/g, "").toLowerCase();
			const providerOf = (group) => {
				const route = group.querySelector(SUBAGENT_ROUTE_SELECTOR);
				if (route === null) return "";
				const text = (route.textContent ?? "").trim();
				const tail = text.includes("·") ? text.slice(text.lastIndexOf("·") + 1).trim() : text;
				return tail.split("/")[0].trim().toLowerCase();
			};
			const groups = root.matches(SUBAGENT_GROUP_SELECTOR) ? [root, ...root.querySelectorAll(SUBAGENT_GROUP_SELECTOR)] : [...root.querySelectorAll(SUBAGENT_GROUP_SELECTOR)];
			for (const group of groups) {
				const id = providerOf(group);
				if (id === "deepseek-official") {
					setHidden(group, prefs.subagentOfficial === true);
					continue;
				}
				if (id === "deepseek-account") {
					setHidden(group, prefs.subagentAccount === true);
					continue;
				}
				if (id !== "") continue;
				const name = group.querySelector(SUBAGENT_PROVIDER_SELECTOR);
				if (name === null) continue;
				const key = norm((name.textContent ?? "").trim());
				if (matches(SUBAGENT_ACCOUNT_LABELS, key)) setHidden(group, prefs.subagentAccount === true);
				else if (matches(SUBAGENT_OFFICIAL_LABELS, key) || key === "deepseek") setHidden(group, prefs.subagentOfficial === true);
			}
		}

		/** 账号菜单：藏「意见反馈」，连带把只剩它一个的容器一起藏，别留孤零零的分隔线。 */
		function sweepAccountMenu(root) {
			const items = root.matches(MENU_ITEM_SELECTOR) ? [root, ...root.querySelectorAll(MENU_ITEM_SELECTOR)] : [...root.querySelectorAll(MENU_ITEM_SELECTOR)];
			// 同一个菜单里两项各管各的：只认文字，认不到就跳过，不动别的菜单项。
			// 「设置」两个字太常见（别的菜单也可能有），只有确认这是账号菜单时才动它。
			const isAccount = items.some((item) => {
				const text = (item.textContent ?? "").trim();
				return matches(FEEDBACK_LABELS, text) || matches(SIGN_OUT_LABELS, text);
			});
			const wanted = [
				[SETTINGS_LABELS, prefs.hideSettings === true && isAccount],
				[FEEDBACK_LABELS, prefs.feedback === true],
				[SIGN_OUT_LABELS, prefs.signOut === true],
			];
			for (const item of items) {
				const text = (item.textContent ?? "").trim();
				for (const [labels, hide] of wanted) {
					if (!matchesAccountItem(labels, text)) continue;
					setHidden(item, hide);
					const holder = item.parentElement;
					if (holder === null || holder === root) continue;
					const only = holder.children.length === 1 && holder.getAttribute("role") === "presentation";
					if (only) setHidden(holder, hide);
				}
			}
		}

		/**
		 * 触发器把模型名和档位拼一起时，末尾的 Default 也算。
		 * @param {string} text - 已 trim 的文字。
		 * @returns {boolean} 命中与否。
		 */
		function endsWithDefault(text) {
			return DEFAULT_LABELS.some((label) => text.endsWith(" · " + label) || text.endsWith(": " + label) || text.endsWith(" - " + label));
		}
		
		/**
		 * 推理等级里的 Default 是官方在模型缺 defaultEffort 时补的「不指定」项。
		 * 新供应商没有 provider 级 reasoning 行时也会冒出来，这里常驻藏掉，不挂开关。
		 * 菜单项、触发器 span、根面板 span 三处都扫，谁都不许露脸。
		 * @param {Element | null} root - 扫描起点。
		 */
		function sweepProviderDefault(root) {
			if (root === null || root === undefined || root.nodeType !== 1) return;
			const radios = root.matches(DEFAULT_RADIO_SELECTOR)
				? [root, ...root.querySelectorAll(DEFAULT_RADIO_SELECTOR)]
				: [...root.querySelectorAll(DEFAULT_RADIO_SELECTOR)];
			for (const radio of radios) {
				const menu = radio.closest(MENU_SURFACE_SELECTOR);
				if (menu === null) continue;
				const id = String(radio.id ?? "");
				const cls = String(radio.className ?? "");
				if (id.includes("-model-") || cls.includes("modelOption")) continue;
				const text = (radio.textContent ?? "").trim();
				if (!matches(DEFAULT_LABELS, text) && !endsWithDefault(text)) continue;
				// 官方把焦点落在 aria-checked 那一项上；它正好是 Default 时，
				// display:none 会让焦点掉到 body，菜单 onBlur 立刻 close()。
				// 先把焦点挪到下一个可见档位，再藏。
				const active = document.activeElement;
				if (active === radio || active === document.body || active === null) {
					const next = [...menu.querySelectorAll(DEFAULT_RADIO_SELECTOR)].find((item) => item !== radio && !item.hasAttribute(MARK));
					if (next !== undefined) next.focus();
				}
				setHidden(radio, true);
			}
			const spans = root.matches(DEFAULT_TEXT_SELECTOR)
				? [root, ...root.querySelectorAll(DEFAULT_TEXT_SELECTOR)]
				: [...root.querySelectorAll(DEFAULT_TEXT_SELECTOR)];
			for (const span of spans) {
				const text = (span.textContent ?? "").trim();
				if (!matches(DEFAULT_LABELS, text) && !endsWithDefault(text)) {
					// 换档后同一个 span 的文字会变成 High，藏过的要放回来。
					setHidden(span, false);
					continue;
				}
				setHidden(span, true);
			}
		}
		
		/**
		 * 思考深度菜单里不再出现 Xhigh。
		 *
		 * 菜单项是按模型的 reasoningEfforts 渲染的：配置里声明了 xhigh，菜单就多一项。
		 * 这里只处理界面，配置里那行由宿主侧的 autoConfigToText 顺手删掉；两边都做，
		 * 才不会出现「菜单没了、配置还写着、换台机器又冒出来」。
		 * 模型列表里同名的模型不动 —— 和 Default 一样靠 id/class 区分。
		 * @param {Element | null} root - 扫描起点。
		 */
		function sweepEffortLevels(root) {
			if (root === null || root === undefined || root.nodeType !== 1) return;
			const items = root.matches(EFFORT_RADIO_SELECTOR)
				? [root, ...root.querySelectorAll(EFFORT_RADIO_SELECTOR)]
				: [...root.querySelectorAll(EFFORT_RADIO_SELECTOR)];
			for (const item of items) {
				const menu = item.closest(MENU_SURFACE_SELECTOR);
				if (menu === null) continue;
				const id = String(item.id ?? "");
				const cls = String(item.className ?? "");
				if (id.includes("-model-") || cls.includes("modelOption")) continue;
				const text = (item.textContent ?? "").trim().toLowerCase();
				if (!HIDDEN_EFFORT_LABELS.includes(text)) continue;
				if (document.activeElement === item) {
					const next = [...menu.querySelectorAll(EFFORT_RADIO_SELECTOR)].find((other) =>
						other !== item && !HIDDEN_EFFORT_LABELS.includes((other.textContent ?? "").trim().toLowerCase()));
					if (next !== undefined) next.focus();
				}
				setHidden(item, true);
			}
		}
		/**
		 * 对一棵子树（含它自己）跑各步。root 可以是 document.body，也可以是刚挂上来的节点 ——
		 * 只扫新增的那一小块，流式输出时不会因为每次都全量 querySelectorAll 把主线程拖住。
		 * @param {Element | null} root - 扫描起点。
		 */
		function sweepRoot(root) {
			if (root === null || root === undefined || root.nodeType !== 1) return;
			// 三步各自上保险：换版本后某一处结构变了，只让那一条失效，不连累另外两条。

			for (const step of [sweepModelMenu, sweepSettingsRows, sweepSubagentModels, sweepAccountMenu, sweepSidebarNav, sweepProviderDefault, sweepEffortLevels]) {
				try {
					step(root);
				} catch (error) {
					console.error("[dsh-menu-hidden] sweep step failed", error);
				}
			}
		}

		/** 全量扫一遍。启动、切开关、整块替换时用。 */
		function sweep() {
			sweepRoot(document.body);
			wireAccountFallback();
		}

		// ── §5 观察器 ─────────────────────────────────────────────────────────
		let observer = null;

		/**
		 * 回调里同步扫，不排队。MutationObserver 的回调是微任务，跑在浏览器绘制之前，
		 * 所以节点一挂上就被藏掉，不会出现「先画出来、再消失」的那一下。
		 * 早先版本用 120ms 定时器合并，等于把工作推到下一帧之后 —— 那正是闪烁的来源。
		 * 只观察 childList：自己设 display 是 attributes 变动，观察了会自触死循环。
		 */
		/** 正在被按住（visibility:hidden）等扫干净的菜单。 */
		const held = new Set();
		/** 下一帧：优先 rAF，没有就退回定时器（jsdom 之类的环境）。 */
		const nextFrame = typeof window.requestAnimationFrame === "function"
			? (cb) => window.requestAnimationFrame(cb)
			: (cb) => window.setTimeout(cb, 16);

		/**
		 * 菜单挂上来的那一瞬先按住不画：React 有时会在首帧之后再提交一次（焦点、动画回调），
		 * 那一帧里节点是新的、还没被我们藏。按住两帧、扫两遍再放出来，用户看到的是
		 * 「菜单晚一帧出现」，而不是「意见反馈闪一下」。
		 * @param {Element} node - 刚挂上来的节点。
		 */
		/**
		 * 这个菜单里有没有我们本来就要藏的东西？没有就别碰它。
		 * 模型下拉框、命令面板之类跟本插件无关的菜单，一个像素都不该被我们改。
		 * @param {Element} surface - 菜单壳。
		 * @returns {boolean} 有要藏的项时为 true。
		 */
		function worthHolding(surface) {
			if (prefs.accountRow === true && surface.querySelector('[class*="_accountStatus"]') !== null) return true;
			if (prefs.feedback === true || prefs.signOut === true) {
				for (const item of surface.querySelectorAll(MENU_ITEM_SELECTOR)) {
					const text = (item.textContent ?? "").trim();
					if (prefs.feedback === true && FEEDBACK_LABELS.includes(text)) return true;
					if (prefs.signOut === true && SIGN_OUT_LABELS.includes(text)) return true;
				}
			}
			return false;
		}

		function holdMenu(node) {
			const surfaces = [];
			if (node.matches('[role="menu"]')) surfaces.push(node);
			for (const el of node.querySelectorAll('[role="menu"]')) surfaces.push(el);
			for (const surface of surfaces) {
				if (held.has(surface)) continue;
				if (!worthHolding(surface)) continue;
				held.add(surface);
				surface.style.setProperty("visibility", "hidden");
				// 双保险：万一 rAF 一直不跑（窗口被隐藏、渲染被节流），也别让它一直看不见。
				window.setTimeout(() => {
					if (!held.has(surface)) return;
					held.delete(surface);
					surface.style.removeProperty("visibility");
				}, 150);
				release(surface);
			}
		}

		/**
		 * 两帧之后：再扫一遍，然后放出 visibility。
		 * @param {Element} surface - 被按住的菜单。
		 */
		function release(surface) {
			const step = () => {
				nextFrame(() => {
					nextFrame(() => {
						try {
							sweepRoot(surface);
						} catch (error) {
							console.error("[dsh-menu-hidden] sweep failed", error);
						}
						held.delete(surface);
						surface.style.removeProperty("visibility");
					});
				});
			};
			step();
		}

		function onMutations(records) {
			const seen = new Set();
			for (const record of records) {
				// 新挂上来的节点：先按住菜单壳、再扫。只对 addedNodes 做，
				// record.target 上的追加（高亮、hover）不该让菜单重新藏两帧。
				for (const node of record.addedNodes) {
					if (node === null || node === undefined || node.nodeType !== 1 || seen.has(node)) continue;
					seen.add(node);
					try {
						if (prefs.feedback === true || prefs.accountGroup === true || prefs.officialGroup === true) holdMenu(node);
						sweepRoot(node);
					} catch (error) {
						console.error("[dsh-menu-hidden] sweep failed", error);
					}
				}
				// React 就地改文字（characterData）不会产生 addedNodes，光看 childList 抓不到
				// 「Default -> High」这种换档；文字节点的父元素才是要重扫的 span。
				const target = record.type === "characterData" ? record.target.parentElement : record.target;
				if (target === null || target === undefined || target.nodeType !== 1 || seen.has(target)) continue;
				seen.add(target);
				try {
					sweepRoot(target);
				} catch (error) {
					console.error("[dsh-menu-hidden] sweep failed", error);
				}
			}
			wireAccountFallback();
		}

		function startObserver() {
			if (observer !== null) return;
			if (typeof MutationObserver !== "function") return;
			const root = document.body;
			if (root === null) {
				// 极端情况：factory 早于 body 执行。等一个 DOMContentLoaded 再挂。
				document.addEventListener("DOMContentLoaded", () => { startObserver(); }, { once: true });
				return;
			}
			observer = new MutationObserver(onMutations);
			observer.observe(root, { childList: true, subtree: true, characterData: true });
			sweep();
		}

		function stopObserver() {
			for (const surface of held) surface.style.removeProperty("visibility");
			held.clear();
			if (observer !== null) {
				observer.disconnect();
				observer = null;
			}
			for (const element of document.querySelectorAll("[" + MARK + "]")) setHidden(element, false);
			// 插件被停用/卸载：预藏属性、样式表、气泡层都撤掉，否则界面上还留着我们的痕迹。
			const html = document.documentElement;
			if (html !== null && html !== undefined) html.removeAttribute("data-dshmh-account-row");
			if (html !== null && html !== undefined) html.removeAttribute("data-dshmh-logo");
			const style = document.querySelector('style[data-plugin-css="' + ID + '"]');
			if (style !== null) style.remove();
			if (tipNode !== null) {
				tipNode.remove();
				tipNode = null;
			}
		}

		// ── §6 样式 ───────────────────────────────────────────────────────────
		const CSS = [
			".dshmh-page{box-sizing:border-box;display:flex;flex-direction:column;width:100%;max-width:720px;margin:0 auto;padding:24px}",
			".dshmh-headrow{display:flex;align-items:flex-end;flex-wrap:nowrap;gap:14px;margin:0 0 8px}",
			".dshmh-title{color:var(--dsw-alias-label-primary,inherit);margin:0;font-size:21px;font-weight:600;line-height:32px;display:flex;align-items:baseline;gap:10px;min-width:0;flex:0 1 auto;overflow:hidden;white-space:nowrap}",
			".dshmh-ver{color:var(--dsw-alias-label-secondary,#8b909a);font-size:15px;line-height:1;font-weight:400;font-variant-numeric:tabular-nums;flex:none;transform:translateY(1px);white-space:nowrap}",
			".dshmh-pills{display:flex;align-items:center;gap:6px;margin-left:auto;flex:0 0 auto;flex-wrap:nowrap;align-self:flex-end;height:32px}",
			".dshmh-pill{display:inline-flex;align-items:center;gap:5px;height:32px;box-sizing:border-box;padding:0 10px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));background:transparent;color:var(--dsw-alias-label-primary,inherit);font-size:13px;font-weight:400;line-height:20px;text-decoration:none;cursor:pointer;font-family:inherit}",
			".dshmh-pill:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.07))}",
			".dshmh-pill:disabled{opacity:.6;cursor:default}",
			"@media (max-width:560px){.dshmh-headrow{gap:8px}.dshmh-pill{padding:0 8px;font-size:12px}}",
			".dshmh-icon{width:15px;height:15px;flex:none}",
			".dshmh-update{display:flex;align-items:center;gap:8px;color:#ff8a8a}",
			".dshmh-error{color:#ff8a8a}",
			".dshmh-desc{color:var(--dsw-alias-label-secondary,inherit);margin:0;font-size:14px;line-height:22px;white-space:pre-line}",
			".dshmh-project{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:10px 0 4px;font-size:12px}",
			".dshmh-link{color:var(--dsw-alias-state-business-primary,#4d8dff);text-decoration:none;border-bottom:1px solid transparent}",
			".dshmh-link:hover{border-bottom-color:currentColor}",
			".dshmh-version{color:var(--dsw-alias-label-secondary,inherit);font-variant-numeric:tabular-nums}",
			".dshmh-new{display:inline-flex;align-items:center;gap:6px;color:#ff6b6b;font-weight:500}",
			".dshmh-dot{width:7px;height:7px;border-radius:50%;background:#ff4d4f;box-shadow:0 0 0 2px rgba(255,77,79,.18);display:inline-block}",
			".dshmh-find{color:#e0a33e;font-weight:600}",
			".dshmh-ok{color:#3fb950}",
			".dshmh-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".dshmh-updatebtn{display:flex;align-items:center;gap:8px;width:100%;text-align:left;font-family:inherit;cursor:pointer}",
			".dshmh-mask{position:fixed;inset:0;z-index:2147483200;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:24px}",
			".dshmh-dialog{box-sizing:border-box;width:min(560px,100%);max-height:calc(100vh - 48px);overflow:auto;padding:22px 24px 18px;border-radius:16px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));background:var(--dsw-alias-bg-layer-1,#1b1d22);box-shadow:0 24px 64px rgba(0,0,0,.5)}",
			".dshmh-dialoghead{display:flex;align-items:center;gap:12px}",
			".dshmh-dialogtitle{color:var(--dsw-alias-label-primary,inherit);font-size:17px;font-weight:700;line-height:26px}",
			".dshmh-x{margin-left:auto;width:28px;height:28px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#9aa0aa);font-size:20px;line-height:1;cursor:pointer;font-family:inherit}",
			".dshmh-x:hover{background:rgba(127,127,127,.16)}",
			".dshmh-dialogdesc{color:var(--dsw-alias-label-secondary,#9aa0aa);font-size:13px;line-height:20px;margin:12px 0 14px}",
			".dshmh-kv{display:grid;grid-template-columns:120px 1fr;gap:10px 16px;font-size:13px;line-height:20px;margin:0 0 16px}",
			".dshmh-kvlabel{color:var(--dsw-alias-label-secondary,#9aa0aa)}",
			".dshmh-kvval{color:var(--dsw-alias-label-primary,inherit);word-break:break-all}",
			".dshmh-manual{border-top:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.1));padding-top:14px;margin-top:2px}",
			".dshmh-manualtitle{font-size:14px;font-weight:700;line-height:22px;margin:0 0 6px}",
			".dshmh-cmdbox{position:relative;margin:10px 0 0;padding:12px 84px 12px 12px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));background:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.04));font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.7;word-break:break-all;color:var(--dsw-alias-label-primary,inherit)}",
			".dshmh-copy{position:absolute;right:10px;top:10px;height:28px;padding:0 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));background:transparent;color:inherit;font-size:12px;cursor:pointer;font-family:inherit}",
			".dshmh-dialogfoot{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}",
			".dshmh-primary{height:34px;padding:0 16px;border-radius:10px;border:0;background:var(--dsw-alias-brand-primary,#2f6fff);color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}",
			".dshmh-primary:disabled{opacity:.6;cursor:default}",
			".dshmh-inline{margin:0}",
			".dshmh-subtitle{color:var(--dsw-alias-label-primary,inherit);margin:24px 0 0;font-size:14px;font-weight:700;line-height:22px}",
			".dshmh-row{display:flex;align-items:center;gap:12px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2))}",
			".dshmh-text{display:flex;flex-direction:column;flex:1;gap:4px;min-width:0;padding-right:32px}",
			".dshmh-label{color:var(--dsw-alias-label-primary,inherit);font-size:14px;font-weight:400;line-height:22px}",
			".dshmh-hint{color:var(--dsw-alias-label-tertiary,inherit);font-size:12px;line-height:18px;overflow-wrap:anywhere}",
			".dshmh-hint[data-tone=error]{color:var(--dsw-alias-state-error-primary,#f85149)}",
			".dshmh-hint[data-tone=ok]{color:var(--dsw-alias-state-success-primary,#3fb950)}",
			".dshmh-side{display:flex;align-items:center;gap:8px;flex:none}",
			".dshmh-note{box-sizing:border-box;margin:16px 0 0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2));border-radius:12px;background:var(--dsw-alias-bg-layer-2,transparent);color:var(--dsw-alias-label-secondary,inherit);font-size:13px;line-height:20px}",
			".dshmh-btn{box-sizing:border-box;min-height:32px;padding:4px 12px;border:1px solid var(--dsw-alias-border-l3,rgba(127,127,127,.35));border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:13px;cursor:pointer}",
			".dshmh-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12))}",
			".dshmh-btn:disabled{opacity:.5;cursor:default}",
			".dshmh-btn:focus-visible{outline:2px solid var(--dsw-focus-ring-color,#4d6bfe);outline-offset:2px}",
			".dshmh-head{display:inline-flex;align-items:center;gap:6px}",
			".dshmh-info{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;border-radius:50%;border:1px solid currentColor;font-size:10px;font-style:normal;line-height:1;color:#8b909a;cursor:help;position:relative;flex:none}",
			".dshmh-info:hover,.dshmh-info:focus-visible{color:#e8eaed;outline:none}",
			".dshmh-tip{position:fixed;z-index:2147483000;max-width:300px;width:max-content;padding:7px 9px;border-radius:8px;background:#16181d;border:1px solid rgba(255,255,255,.12);color:#e8eaed;font-size:12px;font-weight:400;line-height:1.55;white-space:normal;text-align:left;box-shadow:0 10px 28px rgba(0,0,0,.5);pointer-events:none;opacity:0;visibility:hidden;transition:opacity .1s ease}",
			".dshmh-tip[data-open=\"1\"]{opacity:1;visibility:visible}",
			".dshmh-actions{display:inline-flex;align-items:center;gap:8px}",
			".dshmh-caption{display:block;margin:2px 0 4px;font-size:12px;line-height:1.5;color:#8b909a}",
			".dshmh-tabs{display:flex;align-items:center;gap:24px;margin:20px 0 0;overflow-x:auto;border-bottom:.5px solid var(--dsw-alias-border-l2,rgba(127,127,127,.2))}",
			".dshmh-tab{position:relative;appearance:none;background:none;border:0;margin:0;padding:0 0 9px;font:inherit;font-size:14px;font-weight:400;line-height:22px;color:var(--dsw-alias-label-secondary,#8b909a);cursor:pointer;white-space:nowrap}",
			".dshmh-tab:hover{color:var(--dsw-alias-label-primary,inherit)}",
			".dshmh-tab[data-active=true]{color:var(--dsw-alias-label-primary,inherit);font-weight:600}",
			".dshmh-tab[data-active=true]::after{content:'';position:absolute;left:0;right:0;bottom:-.5px;height:2px;border-radius:2px;background:currentColor}",
			".dshmh-tabs-main{margin-top:18px}",
			".dshmh-panel{display:block;padding-top:2px}",
			".dshmh-statusrow .dshmh-text{padding-right:0;flex:none}",
			".dshmh-status{flex:1;min-width:0;margin:0;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;line-height:18px;min-height:18px}",
			".dshmh-tabpanel{padding-top:2px}",
			".dshmh-select{appearance:none;min-width:132px;padding:6px 26px 6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:#202227;color:#e8eaed;font-size:13px;cursor:pointer}",
			"html[data-dshmh-account-row=\"1\"] li[class*=\"_rowCard\"]:has([class*=\"_accountStatus\"]){display:none!important}",
			"html[data-dshmh-logo=\"1\"] [class*=\"logoRow\"]{height:auto!important;min-height:0!important;padding-top:0!important;padding-bottom:0!important;margin-bottom:2px!important}",
			"html[data-dshmh-logo=\"1\"] [class*=\"brandIdentity\"]{display:none!important}",
		].join("");

		/** 账号行首屏预藏：CSS 在第一次绘制前就生效，不用等 JS 跑。 */
		function syncPreHide() {
			const html = document.documentElement;
			if (html === null || html === undefined) return;
			if (prefs.accountRow === true) html.setAttribute("data-dshmh-account-row", "1");
			else html.removeAttribute("data-dshmh-account-row");
			// 藏 logo 时整行只剩折叠按钮的高度，留着那 60px 空白等于没藏。
			if (prefs.sidebarLogo === true) html.setAttribute("data-dshmh-logo", "1");
			else html.removeAttribute("data-dshmh-logo");
		}

		function injectStyle() {
			if (typeof document === "undefined") return;
			if (document.querySelector('style[data-plugin-css="dsh-menu-hidden"]') !== null) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = ID;
			tag.dataset.pluginCss = ID;
			tag.textContent = CSS;
			// 极端情况 factory 早于 <head> 成形：挂到 documentElement 上，样式照样生效。
			(document.head ?? document.documentElement).appendChild(tag);
		}

		// ── §7 宿主路由：外壳补丁的开关与状态 ─────────────────────────────────
		/**
		 * 打宿主路由。
		 * @param {"enable" | "disable" | undefined} action - 省略即读状态。
		 * @returns {Promise<object>} 宿主返回的 JSON。
		 */
		async function shellFetch(action) {
			const url = action === undefined ? SHELL_ROUTE : SHELL_ROUTE + "?action=" + encodeURIComponent(action);
			const response = await fetch(url, {
				method: action === undefined ? "GET" : "POST",
				headers: { "content-type": "application/json" },
				credentials: "same-origin",
				body: action === undefined ? undefined : JSON.stringify({ action }),
			});
			let body = null;
			try {
				body = await response.json();
			} catch {
				body = null;
			}
			if (body === null) return { ok: false, error: "HTTP " + response.status };
			return body;
		}

		// ── §8 设置页 ─────────────────────────────────────────────────────────
		/**
		 * 一行开关。
		 * @param {{ label: string, hint?: string, checked: boolean, onChange: (next: boolean) => void }} props - 行参数。
		 * @returns {object} React 元素。
		 */
		/**
		 * 标题右边的 ⓘ：功能说明放这里，鼠标悬浮或键盘聚焦时浮出来。
		 * @param {{ text: string }} props - 说明文字。
		 * @returns {object} React 元素。
		 */
		let tipNode = null;

		/**
		 * 气泡层：直接挂 body，position:fixed。
		 * 挂在设置页容器里会被 overflow 裁掉，长文案只剩半句话。
		 * @returns {HTMLElement} 气泡节点。
		 */
		function tipLayer() {
			if (tipNode !== null && tipNode.isConnected === true) return tipNode;
			tipNode = document.createElement("div");
			tipNode.className = "dshmh-tip";
			tipNode.dataset.open = "0";
			document.body.appendChild(tipNode);
			// 滚一下、改个窗口大小，位置就过期了，直接收起来。
			window.addEventListener("scroll", hideTip, true);
			window.addEventListener("resize", hideTip);
			return tipNode;
		}

		/**
		 * 在图标正上方显示说明；上方放不下就翻到下方。
		 * @param {Element} target - 带 data-tip 的 ⓘ。
		 * @returns {void}
		 */
		function showTip(target) {
			const text = target.getAttribute("data-tip");
			if (text === null || text.length === 0) return;
			const tip = tipLayer();
			tip.textContent = text;
			tip.dataset.open = "1";
			const box = target.getBoundingClientRect();
			const width = tip.offsetWidth;
			const height = tip.offsetHeight;
			const limit = Math.max(8, window.innerWidth - width - 8);
			const left = Math.min(Math.max(8, box.left + box.width / 2 - width / 2), limit);
			let top = box.top - height - 8;
			if (top < 8) top = box.bottom + 8;
			tip.style.left = Math.round(left) + "px";
			tip.style.top = Math.round(top) + "px";
		}

		function hideTip() {
			if (tipNode === null) return;
			tipNode.dataset.open = "0";
		}

		/**
		 * 「（desktop、headless）」这种后缀，只列真的写了东西的 profile。
		 * @param {Array<{ profile: string, changed: number }>} written - 宿主回报的写入结果。
		 * @returns {string} 拼好的后缀，没有就空串。
		 */
	/** 把「没吃到这一档」的模型拼成一句尾巴。 */
	function skippedModels(rows) {
		if (!Array.isArray(rows) || rows.length === 0) return "";
		const names = rows.map((row) => (row && typeof row.model === "string" ? row.model : "")).filter((name) => name !== "");
		if (names.length === 0) return "";
		const unique = [...new Set(names)];
		const head = unique.slice(0, 3).join(" / ");
		return t("reasoningSkipped").replace("{models}", unique.length > 3 ? head + " …" : head);
	}

	function changedProfiles(written) {
			if (Array.isArray(written) !== true) return "";
			const names = written.filter((entry) => entry !== null && typeof entry === "object" && entry.changed > 0).map((entry) => String(entry.profile));
			return names.length === 0 ? "" : "（" + names.join("、") + "）";
		}

		function InfoIcon({ text }) {
			return React.createElement("span", {
				className: "dshmh-info",
				role: "img",
				tabIndex: 0,
				"aria-label": text,
				"data-tip": text,
				onMouseEnter: (event) => showTip(event.currentTarget),
				onMouseLeave: hideTip,
				onFocus: (event) => showTip(event.currentTarget),
				onBlur: hideTip,
				onKeyDown: (event) => {
					if (event.key === "Escape") hideTip();
				},
			}, "i");
		}

		function ToggleRow({ label, hint, checked, disabled, onChange }) {
			const control = OfficialSwitch !== null
				? React.createElement(OfficialSwitch, { checked, label, disabled, onChange: (next) => { if (disabled !== true) onChange(next === true); } })
				: React.createElement("input", {
					type: "checkbox",
					disabled,
					checked,
					"aria-label": label,
					onChange: (event) => { if (disabled !== true) onChange(event.target.checked === true); },
				});
			return React.createElement("div", { className: "dshmh-row" },
				React.createElement("span", { className: "dshmh-text" },
					React.createElement("span", { className: "dshmh-head" },
						React.createElement("span", { className: "dshmh-label" }, label),
						hint ? React.createElement(InfoIcon, { text: hint }) : null)),
				React.createElement("span", { className: "dshmh-side" }, control));
		}

		/**
		 * 插件自己的设置分区。
		 * @returns {object} React 元素。
		 */
		const ISSUE_URL = REPO_URL + "/issues/new";
		const iconProps = { width: 15, height: 15, viewBox: "0 0 16 16", "aria-hidden": "true", focusable: "false", className: "dshmh-icon" };
		const strokeProps = { width: 15, height: 15, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", focusable: "false", className: "dshmh-icon" };
		const GITHUB_ICON = React.createElement("svg", { ...iconProps, fill: "currentColor" },
			React.createElement("path", { d: "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" }));
		const ISSUE_ICON = React.createElement("svg", strokeProps,
			React.createElement("path", { d: "M15 3h6v6" }),
			React.createElement("path", { d: "M10 14 21 3" }),
			React.createElement("path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" }));
		const REFRESH_ICON = React.createElement("svg", strokeProps,
			React.createElement("path", { d: "M21 12a9 9 0 1 1-3-6.7" }),
			React.createElement("path", { d: "M21 3v6h-6" }));

		const CHECK_ICON = React.createElement("svg", strokeProps,
			React.createElement("path", { d: "M20 6 9 17l-5-5" }));

		/**
		 * 打开外部链接：Electron 里 window.open 会被 setWindowOpenHandler 拦掉，
		 * 退回 location.href 让 will-navigate 接住，交给 shell.openExternal。
		 * @param {MouseEvent} event - 点击事件。
		 * @param {string} url - 目标地址。
		 */
		function openExternal(event, url) {
			// 浏览器里什么都别做：<a target="_blank" rel="noreferrer"> 自己就只开一个新标签页。
			// 之前在这里 window.open 再补一次 location.href，于是「开一个新标签 + 当前页也跳过去」，
			// 看起来就是点了两下。带 noopener 的 window.open 永远返回 null，不能拿返回值判断。
			if (!/Electron/i.test(navigator.userAgent)) return;
			// Electron：主进程的 setWindowOpenHandler 会 deny 掉新窗口，改走 will-navigate，
			// 由它调 shell.openExternal 交给系统浏览器，只跳一次。
			event.preventDefault();
			window.location.href = url;
		}

		function SettingsSection() {
			const [, setTick] = React.useState(0);
			const [shell, setShell] = React.useState(null);
			const [busy, setBusy] = React.useState(false);
			const [note, setNote] = React.useState(null);
			const [reasoning, setReasoning] = React.useState(null);
			const [draftGlobal, setDraftGlobal] = React.useState(null);
			const [draftOverrides, setDraftOverrides] = React.useState({});
			const [reasoningBusy, setReasoningBusy] = React.useState(false);
			const [autoReasoningOn, setAutoReasoningOn] = React.useState(true);
			const [autoContextOn, setAutoContextOn] = React.useState(true);
			const [autoImageOn, setAutoImageOn] = React.useState(true);
			const [mainTab, setMainTab] = React.useState("hide");
			const [featureNote, setFeatureNote] = React.useState(null);
			const [hostFeatureReady, setHostFeatureReady] = React.useState(false);
			const [reasoningNote, setReasoningNote] = React.useState(null);
			const [update, setUpdate] = React.useState(null);

			React.useEffect(() => {
				let alive = true;
				shellFetch(undefined).then(
					(state) => { if (alive) setShell(state); },
					(error) => { if (alive) setNote({ tone: "error", text: t("shellFailed") + String((error && error.message) || error) }); },
				);
				return () => { alive = false; };
			}, []);

			const [updateDialog, setUpdateDialog] = React.useState(false);
			const [installBusy, setInstallBusy] = React.useState(false);
			const [installNote, setInstallNote] = React.useState(null);
			const [copied, setCopied] = React.useState(false);

			const checkUpdate = (force) => {
				const now = Date.now();
				if (force !== true && now - updateCheckedAt < UPDATE_DEDUPE_MS) return;
				updateCheckedAt = now;
				setUpdate((prev) => ({ ...(prev ?? {}), status: "loading" }));
				fetch(UPDATE_ROUTE, { credentials: "same-origin" }).then((response) => response.json()).then(
					(state) => {
						setUpdate({ status: "done", ...state });
						if (force === true && state !== null && state.hasUpdate === true) setUpdateDialog(true);
					},
					(error) => setUpdate({ status: "error", error: String((error && error.message) || error) }),
				);
			};

			React.useEffect(() => { checkUpdate(false); }, []);

			const toggle = (key) => (next) => {
				prefs[key] = next === true;
				savePrefs();
				syncPreHide();
				sweep();
				setTick((n) => n + 1);
			};

			const aliveRef = React.useRef(true);
			React.useEffect(() => () => {
				aliveRef.current = false;
				// 面板被关掉时鼠标还停着的 ⓘ 不会收到 mouseleave，气泡会留在屏幕上。
				hideTip();
			}, []);

			/**
			 * 读一次供应商现状。
			 * @param {boolean} keepDraft - true 时不动正在编辑的下拉框（面板重新获得焦点、手动刷新用）。
			 * @returns {void}
			 */
			const loadReasoning = (keepDraft, showNote) => {
				if (showNote === true) setReasoningNote({ tone: null, text: t("reasoningReloaded") });
				fetch(REASONING_ROUTE, { credentials: "same-origin" }).then((response) => response.json()).then((state) => {
					if (!aliveRef.current) return;
					setReasoning(state);
					setAutoReasoningOn(state.autoReasoning !== false);
					setAutoContextOn(state.autoContextWindow !== false);
					setAutoImageOn(state.autoImageInput !== false);
					setHostFeatureReady(typeof state.autoReasoning === "boolean" && typeof state.autoContextWindow === "boolean" && typeof state.autoImageInput === "boolean");
					if (keepDraft === true) return;					setReasoning(state);
					if (keepDraft === true) return;
					const savedGlobal = typeof state.global === "string" ? state.global : null;
					const savedOverrides = state.overrides !== null && typeof state.overrides === "object" ? state.overrides : {};
					if (savedGlobal !== null || Object.keys(savedOverrides).length > 0) {
						setDraftGlobal(savedGlobal);
						setDraftOverrides(savedOverrides);
						return;
					}
					// 还没存过状态：按配置文件里现有的值反推 —— 众数当全局，其余当单独覆盖。
					// 否则一进来是「全跟随全局」，点一下写入就把现有的 reasoning 全删了。
					const known = Array.isArray(state.providers) ? state.providers : [];
					const tally = new Map();
					for (const provider of known) {
						const level = provider.reasoning === null ? "(none)" : provider.reasoning;
						tally.set(level, (tally.get(level) ?? 0) + 1);
					}
					let top = null;
					let topCount = 0;
					for (const [level, count] of tally) {
						if (count > topCount) {
							top = level;
							topCount = count;
						}
					}
					setDraftGlobal(top === "(none)" ? null : top);
					const derived = {};
					for (const provider of known) {
						const level = provider.reasoning === null ? top : provider.reasoning;
						if (level !== top) derived[provider.id] = provider.reasoning;
					}
					setDraftOverrides(derived);
				}, () => { if (showNote === true) setReasoningNote({ tone: "error", text: t("reasoningFailed") }); });
			};

			React.useEffect(() => {
				loadReasoning(false);
				// 供应商是用户自己在「设置 · 模型」里加的，加完回到这一页就该看到新行。
				const onFocus = () => loadReasoning(true);
				const onVisible = () => { if (document.visibilityState === "visible") loadReasoning(true); };
				window.addEventListener("focus", onFocus);
				document.addEventListener("visibilitychange", onVisible);
				return () => {
					window.removeEventListener("focus", onFocus);
					document.removeEventListener("visibilitychange", onVisible);
				};
			}, []);

			const runShell = (action) => {
				setBusy(true);
				setNote(null);
				shellFetch(action).then(
					(result) => {
						setShell(result);
						if (result && result.ok === false) {
							setNote({ tone: "error", text: t("shellFailed") + String(result.error ?? "") });
						} else if (result && result.changed === false) {
							setNote({ tone: null, text: t("shellUnchanged") });
						} else {
							setNote({ tone: "ok", text: action === "enable" ? t("shellWrote") : t("shellReverted") });
						}
					},
					(error) => setNote({ tone: "error", text: t("shellFailed") + String((error && error.message) || error) }),
				).then(() => setBusy(false));
			};

			const shellPatched = shell !== null && shell.patched === true;
			const shellFound = shell !== null && shell.found === true;
			const shellState = shell === null
				? ""
				: shellFound
					? shellPatched ? t("shellStateOn") + " · " + String(shell.file ?? "") : t("shellStateOff") + " · " + String(shell.file ?? "")
					: t("shellStateMissing");

			const rows = [
				["accountGroup", "accountGroupLabel", "accountGroupHint"],
				["officialGroup", "officialGroupLabel", "officialGroupHint"],
				["subagentAccount", "subagentAccountLabel", "subagentAccountHint"],
				["subagentOfficial", "subagentOfficialLabel", "subagentOfficialHint"],
			].map(([key, label, hint]) => React.createElement(ToggleRow, {
				key,
				label: t(label),
				hint: t(hint),
				checked: prefs[key] === true,
				onChange: toggle(key),
			}));

			const settingRows = [
				["accountRow", "accountRowLabel", null],
				["officialRow", "officialRowLabel", null],
			].map(([key, label, hint]) => React.createElement(ToggleRow, {
				key,
				label: t(label),
				hint: hint === null ? undefined : t(hint),
				checked: prefs[key] === true,
				onChange: toggle(key),
			}));

			// 侧边栏是另一处界面，单独成组。
			const sidebarRows = [
				["sidebarLogo", "sidebarLogoLabel", "sidebarLogoHint"],
				["sidebarNewSession", "sidebarNewSessionLabel", "sidebarNewSessionHint"],
				["sidebarPlugins", "sidebarPluginsLabel", "sidebarPluginsHint"],
				["sidebarSchedules", "sidebarSchedulesLabel", "sidebarSchedulesHint"],
				["sidebarMore", "sidebarMoreLabel", "sidebarMoreHint"],
			].map(([key, label, hint]) => React.createElement(ToggleRow, {
				key,
				label: t(label),
				hint: t(hint),
				checked: prefs[key] === true,
				onChange: toggle(key),
			}));

			// 账号菜单是另一处界面，单独成组，和「设置 · 模型」并列。
			const accountRows = [
				["hideSettings", "hideSettingsLabel", "hideSettingsHint"],
				["feedback", "feedbackLabel", "feedbackHint"],
				["signOut", "signOutLabel", "signOutHint"],
			].map(([key, label, hint]) => React.createElement(ToggleRow, {
				key,
				label: t(label),
				hint: hint === null ? undefined : t(hint),
				checked: prefs[key] === true,
				onChange: toggle(key),
			}));

			// 四组直接列出来：只有两三项的组再点一次不值得，用副标题隔开就够了。
			const hideGroups = [
				{ key: "picker", label: t("groupPicker"), rows },
				{ key: "settings", label: t("groupSettings"), rows: settingRows },
				{ key: "sidebar", label: t("groupSidebar"), rows: sidebarRows },
				{ key: "account", label: t("groupAccount"), rows: accountRows },
			];

			const levels = reasoning !== null && Array.isArray(reasoning.levels)
				? reasoning.levels
				: ["off", "minimal", "low", "medium", "high", "max"];
			const providers = reasoning !== null && Array.isArray(reasoning.providers) ? reasoning.providers : [];
			const levelOption = (value, label) => React.createElement("option", { key: value, value }, label);
			const levelOptions = (extra) => [...extra, ...levels.map((level) => levelOption(level, level))];

			const globalRow = React.createElement("div", { className: "dshmh-row" },
				React.createElement("span", { className: "dshmh-text" },
					React.createElement("span", { className: "dshmh-head" },
						React.createElement("span", { className: "dshmh-label" }, t("reasoningGlobal")),
						React.createElement(InfoIcon, { text: t("reasoningGlobalHint") }))),
				React.createElement("span", { className: "dshmh-side" },
					React.createElement("select", {
						className: "dshmh-select",
						value: draftGlobal === null ? "" : draftGlobal,
						"aria-label": t("reasoningGlobal"),
						onChange: (event) => setDraftGlobal(event.target.value === "" ? null : event.target.value),
					}, levelOptions([levelOption("", t("reasoningNone"))]))));

			const providerRows = providers.map((provider) => {
				const current = Object.prototype.hasOwnProperty.call(draftOverrides, provider.id)
					? (draftOverrides[provider.id] === null ? "none" : draftOverrides[provider.id])
					: "";
				return React.createElement("div", { className: "dshmh-row", key: provider.id },
					React.createElement("span", { className: "dshmh-text" },
						React.createElement("span", { className: "dshmh-head" },
							React.createElement("span", { className: "dshmh-label" }, provider.displayName + " · " + provider.id))),
					React.createElement("span", { className: "dshmh-side" },
						React.createElement("select", {
							className: "dshmh-select",
							value: current,
							"aria-label": provider.displayName,
							onChange: (event) => {
								const next = { ...draftOverrides };
								const value = event.target.value;
								if (value === "") delete next[provider.id];
								else if (value === "none") next[provider.id] = null;
								else next[provider.id] = value;
								setDraftOverrides(next);
							},
						}, levelOptions([levelOption("", t("reasoningFollow")), levelOption("none", t("reasoningNone"))]))));
			});


			const setFeatureFlag = (flag, next, onText, offText) => {
				if (hostFeatureReady !== true) { setFeatureNote({ tone: "error", text: t("hostFeatureHint") }); return; }
				setFeatureNote(null);
				// 只发这一个开关；宿主 features 模式从状态文件里读另一个，连点时不会互相盖掉。
				const body = { [flag]: next };
				if (flag === "autoReasoning") setAutoReasoningOn(next);
				else if (flag === "autoContextWindow") setAutoContextOn(next);
				else setAutoImageOn(next);
				fetch(REASONING_ROUTE, {
					method: "POST",
					credentials: "same-origin",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(body),
				}).then((response) => response.json()).then((state) => {
					if (!aliveRef.current) return;
					setReasoning(state);
					setAutoReasoningOn(state.autoReasoning !== false);
					setAutoContextOn(state.autoContextWindow !== false);
					setAutoImageOn(state.autoImageInput !== false);
					setFeatureNote({ tone: null, text: t(next ? onText : offText) });
				}).catch(() => {});
			};

			const autoReasoningRow = React.createElement(ToggleRow, {
				label: t("autoReasoningLabel"),
				hint: t("autoReasoningHint"),
				checked: autoReasoningOn,
				disabled: hostFeatureReady !== true,
				onChange: (next) => setFeatureFlag("autoReasoning", next, "autoReasoningOn", "autoReasoningOff"),
			});

			const autoContextRow = React.createElement(ToggleRow, {
				label: t("autoContextLabel"),
				hint: t("autoContextHint"),
				checked: autoContextOn,
				disabled: hostFeatureReady !== true,
				onChange: (next) => setFeatureFlag("autoContextWindow", next, "autoContextOn", "autoContextOff"),
			});

			const autoImageRow = React.createElement(ToggleRow, {
				label: t("autoImageLabel"),
				hint: t("autoImageHint"),
				checked: autoImageOn,
				disabled: hostFeatureReady !== true,
				onChange: (next) => setFeatureFlag("autoImageInput", next, "autoImageOn", "autoImageOff"),
			});

			const applyReasoningNow = () => {
				setReasoningBusy(true);
				setReasoningNote(null);
				const overrides = {};
				for (const [id, value] of Object.entries(draftOverrides)) overrides[id] = value;
				fetch(REASONING_ROUTE, {
					method: "POST",
					credentials: "same-origin",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ global: draftGlobal, overrides }),
				}).then((response) => response.json()).then((state) => {
					setReasoning(state);
					setDraftGlobal(typeof state.global === "string" ? state.global : null);
					if (state.overrides !== null && typeof state.overrides === "object") setDraftOverrides(state.overrides);
					setReasoningNote({
						tone: state.changed > 0 ? "ok" : null,
						text: state.changed > 0 ? t("reasoningApplied") : t("reasoningUnchanged"),
						hint: state.changed > 0 ? changedProfiles(state.written) + skippedModels(state.skipped) : undefined,
					});
				}, (error) => setReasoningNote({ tone: "error", text: t("reasoningFailed") + String((error && error.message) || error) })).then(() => setReasoningBusy(false));
			};

			const reasoningButton = OfficialButton !== null
				? React.createElement(OfficialButton, { disabled: reasoningBusy, onClick: applyReasoningNow }, t("reasoningApply"))
				: React.createElement("button", { type: "button", className: "dshmh-btn", disabled: reasoningBusy, onClick: applyReasoningNow }, t("reasoningApply"));

			const reloadReasoningButton = OfficialButton !== null
				? React.createElement(OfficialButton, { disabled: reasoningBusy, onClick: () => loadReasoning(true, true) }, t("reasoningReload"))
				: React.createElement("button", { type: "button", className: "dshmh-btn", disabled: reasoningBusy, onClick: () => loadReasoning(true, true) }, t("reasoningReload"));

			const runInstall = () => {
				setInstallBusy(true);
				setInstallNote(null);
				const latest = update !== null && typeof update.latest === "string" ? update.latest : "";
				fetch(UPDATE_ROUTE + "?action=install", {
					method: "POST",
					credentials: "same-origin",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ latest }),
				}).then((response) => response.json()).then(
					(state) => {
						setInstallNote({ ok: state.ok === true, text: state.ok === true ? t("dialogInstallDone") : t("updateFailed") + " " + String(state.error ?? state.output ?? "") });
						if (state.ok === true) checkUpdate(true);
					},
					(error) => setInstallNote({ ok: false, text: t("updateFailed") + " " + String((error && error.message) || error) }),
				).then(() => setInstallBusy(false));
			};

			const copyCommand = (command) => {
				const done = () => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); };
				const fallback = () => {
					try {
						const area = document.createElement("textarea");
						area.value = command;
						area.style.position = "fixed";
						area.style.opacity = "0";
						document.body.appendChild(area);
						area.select();
						document.execCommand("copy");
						area.remove();
					} catch { /* 复制不可用时用户手动选中 */ }
					done();
				};
				if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
					navigator.clipboard.writeText(command).then(done, fallback);
					return;
				}
				fallback();
			};

			const renderUpdateDialog = () => {
				if (updateDialog !== true) return null;
				const latest = update !== null && typeof update.latest === "string" && update.latest !== "" ? update.latest : String(update === null ? "" : update.current ?? "");
				const running = update !== null && typeof update.current === "string" ? update.current : "";
				const profileName = update !== null && typeof update.profile === "string" ? update.profile : "desktop";
				const command = "dsh plugin --profile " + profileName + " add github:" + REPO_SLUG + "@v" + latest;
				const close = () => { setUpdateDialog(false); setInstallNote(null); };
				const kv = (label, value, hint) => [
					React.createElement("span", { key: label + "-k", className: "dshmh-kvlabel" }, label),
					React.createElement("span", { key: label + "-v", className: "dshmh-kvval" }, value, hint === null || hint === undefined ? null : React.createElement("span", { className: "dshmh-find" }, "  " + hint)),
				];
				return React.createElement("div", { className: "dshmh-mask", onClick: close },
					React.createElement("div", { className: "dshmh-dialog", role: "dialog", "aria-modal": "true", onClick: (event) => event.stopPropagation() },
						React.createElement("div", { className: "dshmh-dialoghead" },
							React.createElement("span", { className: "dshmh-dialogtitle" }, t("title") + " " + t("dialogUpdateSuffix")),
							React.createElement("button", { type: "button", className: "dshmh-x", onClick: close, "aria-label": t("dialogClose") }, "×")),
						React.createElement("p", { className: "dshmh-dialogdesc" }, t("dialogScope")),
						React.createElement("div", { className: "dshmh-kv" },
							kv(t("dialogRunning"), "v" + running),
							kv(t("dialogLatest"), "v" + latest, update !== null && update.hasUpdate === true ? t("dialogFound") + " v" + latest : null),
							kv(t("dialogProfile"), profileName)),
						React.createElement("div", { className: "dshmh-manual" },
							React.createElement("p", { className: "dshmh-manualtitle" }, t("dialogManual")),
							React.createElement("p", { className: "dshmh-caption" }, t("dialogManualNote")),
							React.createElement("div", { className: "dshmh-cmdbox" }, command,
								React.createElement("button", { type: "button", className: "dshmh-copy", onClick: () => copyCommand(command) }, copied === true ? t("dialogCopied") : t("dialogCopy")))),
						installNote === null ? null : React.createElement("p", { className: installNote.ok === true ? "dshmh-note dshmh-ok" : "dshmh-note dshmh-error" }, installNote.text),
						React.createElement("div", { className: "dshmh-dialogfoot" },
							React.createElement("button", { type: "button", className: "dshmh-btn", disabled: installBusy, onClick: () => checkUpdate(true) }, t("dialogRecheck")),
							React.createElement("button", { type: "button", className: "dshmh-primary", disabled: installBusy || update === null || update.hasUpdate !== true, onClick: runInstall }, installBusy === true ? t("dialogInstalling") : t("dialogAuto")))));
			};

			const buttons = [
				boxAction(t("shellApply"), "enable", !shellFound || bulkDisabled(busy)),
				boxAction(t("shellRollback"), "disable", !shellPatched || bulkDisabled(busy)),
				OfficialButton !== null
					? React.createElement(OfficialButton, { key: "reload", onClick: () => { window.location.reload(); } }, t("refreshAction"))
					: React.createElement("button", { key: "reload", type: "button", className: "dshmh-btn", onClick: () => { window.location.reload(); } }, t("refreshAction")),
			];

			function boxAction(label, action, disabled) {
				if (OfficialButton !== null) {
					return React.createElement(OfficialButton, { key: action, disabled, onClick: () => { runShell(action); } }, label);
				}
				return React.createElement("button", { key: action, type: "button", className: "dshmh-btn", disabled, onClick: () => { runShell(action); } }, label);
			}

			const isLatest = update !== null && update.status === "done" && update.hasUpdate !== true;

			// 一级菜单：三块功能各占一栏，点标签切换，一屏只看一样。
			const mainGroups = [
				{ key: "hide", label: t("tabHide") },
				{ key: "models", label: t("tabModels") },
				{ key: "enhance", label: t("tabEnhance") },
			];
			const mainGroup = mainGroups.find((group) => group.key === mainTab) ?? mainGroups[0];
			const mainTabs = React.createElement("div", { className: "dshmh-tabs dshmh-tabs-main", role: "tablist" },
				...mainGroups.map((group) => React.createElement("button", {
					key: group.key,
					type: "button",
					role: "tab",
					className: "dshmh-tab",
					"data-active": group.key === mainGroup.key ? "true" : "false",
					"aria-selected": group.key === mainGroup.key,
					onClick: () => setMainTab(group.key),
				}, group.label)),
			);
			const hidePanelRows = [];
			for (const group of hideGroups) {
				hidePanelRows.push(React.createElement("h3", { key: group.key + "-title", className: "dshmh-subtitle" }, group.label));
				for (const row of group.rows) hidePanelRows.push(row);
			}
			const renderHidePanel = () => React.createElement(React.Fragment, null, ...hidePanelRows);
			const renderModelPanel = () => React.createElement(React.Fragment, null,
				React.createElement("h3", { className: "dshmh-subtitle" }, t("groupModelFeatures")),
				React.createElement("p", { className: "dshmh-caption" }, t("modelFeaturesDesc")),
				autoReasoningRow,
				autoContextRow,
				autoImageRow,
				hostFeatureReady === true ? null : React.createElement("p", { className: "dshmh-hint", "data-tone": "error", role: "status" }, t("hostFeatureHint")),
				featureNote === null ? null : React.createElement("p", { className: "dshmh-hint", "data-tone": featureNote.tone ?? undefined, role: "status" }, featureNote.text),
				React.createElement("h3", { className: "dshmh-subtitle" }, t("groupReasoning")),
				React.createElement("p", { className: "dshmh-caption" }, t("reasoningDesc")),
				globalRow,
				React.createElement("div", { className: "dshmh-row dshmh-statusrow" },
					React.createElement("span", { className: "dshmh-text" },
						React.createElement("span", { className: "dshmh-label" }, t("reasoningProviders"))),
					React.createElement("span", { className: "dshmh-hint dshmh-status", "data-tone": reasoningNote === null ? undefined : reasoningNote.tone ?? undefined, role: "status", "aria-live": "polite", title: reasoningNote === null ? undefined : reasoningNote.hint ?? undefined }, reasoningNote === null ? "" : reasoningNote.text),
					React.createElement("span", { className: "dshmh-side dshmh-actions" }, reasoningButton, reloadReasoningButton)),
				...providerRows,

				providers.length > 0 ? null : React.createElement("p", { className: "dshmh-hint" }, t("reasoningEmpty")));
			const renderEnhancePanel = () => React.createElement(React.Fragment, null,
				React.createElement("div", { className: "dshmh-row" },
					React.createElement("span", { className: "dshmh-text" },
						React.createElement("span", { className: "dshmh-label" }, t("shellLabel")),
						React.createElement("span", { className: "dshmh-hint" }, t("shellHint")),
						shellState === "" ? null : React.createElement("span", { className: "dshmh-hint", "data-tone": shellPatched ? "ok" : undefined }, shellState),
						note === null ? null : React.createElement("span", { className: "dshmh-hint", "data-tone": note.tone ?? undefined, role: "status" }, note.text)),
					React.createElement("span", { className: "dshmh-side" }, buttons[0], buttons[1])),
				React.createElement("div", { className: "dshmh-row" },
					React.createElement("span", { className: "dshmh-text" },
						React.createElement("span", { className: "dshmh-label" }, t("refreshLabel")),
						React.createElement("span", { className: "dshmh-hint" }, t("refreshHint"))),
					React.createElement("span", { className: "dshmh-side" }, buttons[2])));
			const mainPanel = mainGroup.key === "models" ? renderModelPanel() : mainGroup.key === "enhance" ? renderEnhancePanel() : renderHidePanel();

			return React.createElement("div", { className: "dshmh-page" },
				renderUpdateDialog(),
				React.createElement("div", { className: "dshmh-headrow" },
					React.createElement("h2", { className: "dshmh-title" },
						React.createElement("span", { className: "dshmh-name" }, t("title")),
							React.createElement("span", { className: "dshmh-ver" }, "v" + (update !== null && typeof update.current === "string" && update.current !== "" ? update.current : VERSION)),
					),
					React.createElement("div", { className: "dshmh-pills" },
						React.createElement("a", {
							className: "dshmh-pill",
							href: REPO_URL,
							target: "_blank",
							rel: "noreferrer",
							title: REPO_URL,
							onClick: (event) => openExternal(event, REPO_URL),
						}, GITHUB_ICON, t("githubLabel")),
						React.createElement("a", {
							className: "dshmh-pill",
							href: ISSUE_URL,
							target: "_blank",
							rel: "noreferrer",
							title: ISSUE_URL,
							onClick: (event) => openExternal(event, ISSUE_URL),
						}, ISSUE_ICON, t("issueLabel")),
						React.createElement("button", {
							type: "button",
							className: "dshmh-pill",
							disabled: update !== null && update.status === "loading",
							onClick: () => {
								if (update !== null && update.hasUpdate === true) { setUpdateDialog(true); return; }
								checkUpdate(true);
							},
						}, isLatest === true ? CHECK_ICON : REFRESH_ICON,
						isLatest === true ? t("updateLatest") : update !== null && update.status === "loading" ? t("updateChecking") : t("updateCheck"),
						update !== null && update.hasUpdate === true ? React.createElement("span", { className: "dshmh-dot", "aria-hidden": "true" }) : null),
					),
				),
				React.createElement("p", { className: "dshmh-desc" }, t("desc")),
				update !== null && update.hasUpdate === true ? React.createElement("button", { type: "button", className: "dshmh-note dshmh-update dshmh-updatebtn", onClick: () => setUpdateDialog(true) },
					React.createElement("span", { className: "dshmh-dot", "aria-hidden": "true" }),
					React.createElement("span", null, t("updateNew") + " v" + String(update.latest)),
					React.createElement("span", { className: "dshmh-link" }, t("updateDownload"))) : null,
				update !== null && update.status === "error" ? React.createElement("p", { className: "dshmh-note dshmh-error" }, t("updateFailed") + "：" + String(update.error ?? "")) : null,
				mainTabs,
				React.createElement("div", { className: "dshmh-panel", role: "tabpanel", "aria-label": mainGroup.label }, mainPanel));
		}

		/**
		 * 按钮禁用条件（宿主还没应答时两个都点不动，免得写出半截状态）。
		 * @param {boolean} busy - 请求在飞。
		 * @returns {boolean} 是否禁用。
		 */
		function bulkDisabled(busy) {
			return busy === true;
		}

		// ── §9 插件入口 ───────────────────────────────────────────────────────
		/**
		 * 语言这东西有三种坑，一次兜干净：
		 * 1. 正常：注册字典再 bind，跟着应用语言走；
		 * 2. 应用语言是 zh-CN / zh-Hans 这类「语言 + 地区」：查表用的是 localeKey(active)
		 *    的小写原样（zh-cn），只注册 `zh` 会沿着回退链掉到 en，界面整页变英文；
		 * 3. 热重载：同一个 namespace 重复注册会抛 "already has locale"，抛了也得继续 bind，
		 *    否则翻译函数退回「原样返回键名」，页面全是 sectionLabel 这种字。
		 * @param {object | null | undefined} locale - ctx.get("locale")。
		 * @param {{ zh: Record<string, string>, en: Record<string, string> }} dict - 两套文案。
		 * @returns {(key: string) => string} 翻译函数。
		 */
		function bindLocale(locale, dict) {
			const zh = dict.zh;
			const en = dict.en;
			if (locale === undefined || locale === null || typeof locale.bind !== "function") {
				return (key) => zh[key] ?? key;
			}
			// 语言可能在会话中间被切走，所以每次翻译现读，不缓存 apply 那一刻的结果。
			const preferZh = () => {
				try {
					const snapshot = typeof locale.getSnapshot === "function" ? locale.getSnapshot() : null;
					const active = String((snapshot ?? {}).active ?? "");
					return active.toLowerCase().startsWith("zh");
				} catch (error) {
					return true;
				}
			};
			if (typeof locale.register === "function") {
				// 单 locale 形式 register(ns, locale, dict)：方言标签各注册一份，解析到哪个都不会掉英文。
				for (const [tag, words] of [["zh", zh], ["zh-CN", zh], ["zh-Hans", zh], ["en", en]]) {
					try {
						locale.register(LOCALE_NS, tag, words);
					} catch (error) {
						// 热重载时字典已在，重复注册会抛，这里没有要补救的东西。
					}
				}
			}
			let bound = null;
			try {
				bound = locale.bind(LOCALE_NS);
			} catch (error) {
				bound = null;
			}
			if (typeof bound !== "function") return (key) => (preferZh() ? zh[key] ?? key : en[key] ?? key);
			return (key) => {
				const value = bound(key);
				// 查不到会原样返回键名；应用当前是中文时，宁可补中文，也别落成英文或键名。
				if (value === key || (preferZh() && value === en[key])) return zh[key] ?? value;
				return value;
			};
		}


		/**
		 * @param {object} ctx - 客户端上下文。
		 */
		/**
		 * 读一个服务，但不把它变成这条 entry 的硬依赖。
		 * 优先走 ctx.reflect.get（cordis 里明确写着「without the inject requirement」），
		 * 老宿主没有 reflect 就退回 ctx.get，两个都拿不到就返回 undefined。
		 * @param {object} ctx - 客户端上下文。
		 * @param {string} name - 服务名。
		 * @returns {unknown} 服务实现或 undefined。
		 */
		function readService(ctx, name) {
			try {
				if (ctx.reflect !== undefined && ctx.reflect !== null && typeof ctx.reflect.get === "function") {
					const value = ctx.reflect.get(name);
					if (value !== undefined) return value;
				}
			} catch (error) {
				/* 服务没注册、或宿主版本不认这条路，往下走备用读法。 */
			}
			try {
				if (typeof ctx.get === "function") return ctx.get(name);
			} catch (error) {
				/* 没有 inject 声明时 ctx.get 会抛，这里就是兜这一下。 */
			}
			return undefined;
		}

		/**
		 * 挂设置页。作为 scoped inject 的回调，服务到齐才会被调。
		 * @param {object} sub - 带 slots / locale 的子上下文。
		 */
		function mountSettings(sub) {
			t = bindLocale(readService(sub, "locale"), DICT);
			const slots = readService(sub, "slots");
			// 少一个服务就少一件事，别让整条客户端模块图跟着挂掉。
			if (slots === undefined || slots === null || typeof slots.inject !== "function") return;

			// 设置分区本身不受任何开关影响 —— 否则关掉就回不来了。
			sub.effect(() => slots.inject(SETTINGS_SECTION_SLOT, () => slots.register({
				name: SETTINGS_SECTION_SLOT,
				id: ID,
				order: 92,
				label: () => t("sectionLabel"),
			}, SettingsSection)));
		}

		/**
		 * 为什么模块导出上不能写 inject（0.2.27 修的启动白屏）：
		 * web boot 收尾时会遍历整张 client 模块图，只要有一条 entry 不是 active，
		 * 就直接 `throw new Error("web boot: N entries did not activate")`，整个前端起不来。
		 * 依赖写成顶层 inject 的话，slots / locale 任何一个没到（别人的 DSH 版本不同、
		 * 「设置」界面被裁掉、模块加载顺序变了），这条 entry 就是 pending，
		 * 症状和 0.1.0 那次 `module is not defined` 完全一样：白屏，得手动删插件才救得回来。
		 * 所以依赖改成 scoped inject：服务到齐才挂设置页，没到就只做隐藏，
		 * entry 本身永远是 active，最多是「设置页没出现」这种能自己发现的降级。
		 * @param {object} ctx - 客户端上下文。
		 */
		function apply(ctx) {
			try {
				loadPrefs();
				injectStyle();
				syncPreHide();
				startObserver();
				ctx.effect(() => () => { stopObserver(); });
			} catch (error) {
				// 隐藏引擎自己出问题，也不许把整张模块图的激活状态带下去。
				console.warn("[dsh-menu-hidden] hide engine did not start", error);
			}

			try {
				if (typeof ctx.inject === "function") ctx.inject(["slots", "locale"], mountSettings);
				else mountSettings(ctx);
			} catch (error) {
				console.warn("[dsh-menu-hidden] settings section not mounted", error);
			}
		}

		// factory 的返回值就是模块导出：浏览器里没有 CommonJS 的 module / exports，
		// 官方打包产物是构建器自己补 `var module = { exports: {} }` 那两行；手写的
		// client.js 没有那层壳，所以直接 return 插件对象（cordis 支持 { apply } 形状）。
		return { name: ID, apply };
	},
	});
}

try {
	registerClient();
} catch (error) {
	// 同一份字节被重复求值、或 ModuleLoader 认为 id 已注册时，load() 会抛。
	// 界面其余部分没必要跟着起不来：记一笔，别让整个 web boot 变成 1 entry did not activate。
	console.warn("[dsh-menu-hidden] client bundle did not register", error);
}

