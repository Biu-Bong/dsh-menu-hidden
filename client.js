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

window.__ModuleLoader__.load({
	// factory id 必须等于 package.json 的包名，否则 boot 图里找不到 factory。
	id: "@local/dsh-menu-hidden",
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
		const REPO_URL = "https://github.com/Biu-Bong/dsh-menu-hidden";
		const SETTINGS_SECTION_SLOT = "settings.section";

		// ── §1 文案（跟随应用语言） ────────────────────────────────────────────
		const DICT = {
			zh: {
				sectionLabel: "菜单隐藏",
				title: "菜单隐藏",
				desc: "把界面上重复的 DeepSeek 账号 / 官方 API 入口收起来，给应用菜单补上刷新与重启，并统一给模型供应商写推理等级。开关保存后立刻生效，不用刷新页面。",
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
				groupReasoning: "推理等级",
				reasoningDesc: "给每个模型供应商写一行 reasoning，中转站后台才显示得出推理等级；不写那边只画一道杠。",
				reasoningGlobal: "全局默认",
				reasoningGlobalHint: "所有没单独设置的供应商都用这一档。",
				reasoningNone: "不设置",
				reasoningFollow: "跟随全局",
				reasoningProviders: "按供应商单独设置",
				reasoningApply: "写入配置",
				reasoningReload: "重新读取",
				reasoningApplied: "已写入，下一条消息就按新的等级走。",
				reasoningUnchanged: "配置已经一致，没有改动文件。",
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
				updateCheck: "检查更新",
				updateChecking: "检查中…",
				updateLatest: "已是最新",
				updateNew: "有新版本",
				updateFailed: "检查失败",
				updateRepo: "项目地址",
				feedbackLabel: "隐藏「意见反馈」",
				feedbackHint: "右下角头像点开的那份菜单里的「意见反馈」。",
				signOutLabel: "隐藏「退出登录」",
				signOutHint: "同一份菜单里的「退出登录」。藏掉之后账号菜单只剩「设置」；需要退出时把这里关掉即可。",
				shellLabel: "应用菜单：在「退出」上方加「刷新页面」「重启应用与 Host」",
				shellHint: "这两项在外壳主进程里，插件给 lib/main.js 打开官方留着的开关（幂等、留备份、可还原）。改完要重启一次应用才看得到。",
				shellStateOn: "已写入外壳",
				shellStateOff: "外壳未改动",
				shellStateMissing: "没找到外壳 main.js",
				shellApply: "写入补丁",
				shellRollback: "还原",
				shellRestartHint: "重启 DeepSeek Harness 之后，「应用」菜单里「退出」上方会多出这两项。",
				shellWrote: "写入完成，重启应用后生效。",
				shellReverted: "已还原，重启应用后恢复原样。",
				shellUnchanged: "状态已经是这样，没有改动文件。",
				shellFailed: "失败：",
				refreshLabel: "现在刷新一次界面",
				refreshHint: "等同于应用菜单里的「刷新页面」：重新加载渲染进程，不重启 Host，正在跑的任务不受影响。",
				refreshAction: "刷新界面",
				autoRefreshNote: "改开关会立即生效，不需要刷新。",
			},
			en: {
				sectionLabel: "Menu Hiding",
				title: "Menu Hiding",
				desc: "Tuck away the duplicate DeepSeek account / official API entries, add Reload and Restart to the application menu, and write one thinking-depth line for every model provider. Toggles take effect the moment you flip them.",
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
				groupReasoning: "Reasoning level",
				reasoningDesc: "Writes one reasoning line per provider so the relay dashboard can show a reasoning level instead of a dash.",
				reasoningGlobal: "Global default",
				reasoningGlobalHint: "Every provider without its own setting follows this level.",
				reasoningNone: "Not set",
				reasoningFollow: "Follow global",
				reasoningProviders: "Per provider",
				reasoningApply: "Write to config",
				reasoningReload: "Reload",
				reasoningApplied: "Written. The next message uses the new level.",
				reasoningUnchanged: "Config already matches; nothing written.",
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
				updateCheck: "Check for updates",
				updateChecking: "Checking…",
				updateLatest: "Up to date",
				updateNew: "New version",
				updateFailed: "Check failed",
				updateRepo: "Project",
				feedbackLabel: "Hide \"Feedback\"",
				feedbackHint: "The Feedback item in the account menu opened from the avatar at the bottom right.",
				signOutLabel: "Hide \"Sign out\"",
				signOutHint: "The Sign out item in the same menu. With it hidden the menu keeps only Settings; turn it back on here when you need to sign out.",
				shellLabel: "Application menu: add Reload Page and Restart App and Host above Quit",
				shellHint: "Those two live in the Electron main process. The plugin flips the switch the shell already ships with in lib/main.js (idempotent, backed up, reversible). Restart the app once to see them.",
				shellStateOn: "Shell patched",
				shellStateOff: "Shell untouched",
				shellStateMissing: "Shell main.js not found",
				shellApply: "Apply patch",
				shellRollback: "Revert",
				shellRestartHint: "After restarting DeepSeek Harness, both items appear above Quit in the Application menu.",
				shellWrote: "Written. Restart the app to pick it up.",
				shellReverted: "Reverted. Restart the app to restore the old menu.",
				shellUnchanged: "Already in that state; the file was not touched.",
				shellFailed: "Failed: ",
				refreshLabel: "Reload the UI now",
				refreshHint: "Same as Reload Page in the application menu: reloads the renderer without restarting the Host, so running tasks keep going.",
				refreshAction: "Reload",
				autoRefreshNote: "Toggles apply instantly; no reload needed.",
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
			subagentAccount: true,
			subagentOfficial: true,
			accountRow: true,
			officialRow: true,
			feedback: true,
			signOut: true,
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
		/** 设置页 provider 行的类名后缀（Vite CSS Modules：_hash_rowName）。 */
		const ROW_NAME_SELECTOR = '[class*="_rowName"]';
		const MENU_GROUP_SELECTOR = "section[data-menu-group]";
		const MENU_ITEM_SELECTOR = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';
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
		 * 两套文案里有没有这条文字。
		 * @param {string[]} labels - 候选文案。
		 * @param {string} text - 节点文字（已 trim）。
		 * @returns {boolean} 命中与否。
		 */
		function matches(labels, text) {
			return labels.some((label) => label === text);
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
			const wanted = [
				[FEEDBACK_LABELS, prefs.feedback === true],
				[SIGN_OUT_LABELS, prefs.signOut === true],
			];
			for (const item of items) {
				const text = (item.textContent ?? "").trim();
				for (const [labels, hide] of wanted) {
					if (!matches(labels, text)) continue;
					setHidden(item, hide);
					const holder = item.parentElement;
					if (holder === null || holder === root) continue;
					const only = holder.children.length === 1 && holder.getAttribute("role") === "presentation";
					if (only) setHidden(holder, hide);
				}
			}
		}

		/**
		 * 对一棵子树（含它自己）跑三步。root 可以是 document.body，也可以是刚挂上来的节点 ——
		 * 只扫新增的那一小块，流式输出时不会因为每次都全量 querySelectorAll 把主线程拖住。
		 * @param {Element | null} root - 扫描起点。
		 */
		function sweepRoot(root) {
			if (root === null || root === undefined || root.nodeType !== 1) return;
			// 三步各自上保险：换版本后某一处结构变了，只让那一条失效，不连累另外两条。
			for (const step of [sweepModelMenu, sweepSettingsRows, sweepSubagentModels, sweepAccountMenu, sweepSidebarNav]) {
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
				const target = record.target;
				if (target === null || target === undefined || target.nodeType !== 1 || seen.has(target)) continue;
				seen.add(target);
				try {
					sweepRoot(target);
				} catch (error) {
					console.error("[dsh-menu-hidden] sweep failed", error);
				}
			}
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
			observer.observe(root, { childList: true, subtree: true });
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
			".dshmh-title{color:var(--dsw-alias-label-primary,inherit);margin:0 0 4px;font-size:16px;font-weight:500;line-height:24px}",
			".dshmh-desc{color:var(--dsw-alias-label-secondary,inherit);margin:0;font-size:14px;line-height:22px}",
			".dshmh-project{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:10px 0 4px;font-size:12px}",
			".dshmh-link{color:var(--dsw-alias-state-business-primary,#4d8dff);text-decoration:none;border-bottom:1px solid transparent}",
			".dshmh-link:hover{border-bottom-color:currentColor}",
			".dshmh-version{color:var(--dsw-alias-label-secondary,inherit);font-variant-numeric:tabular-nums}",
			".dshmh-new{display:inline-flex;align-items:center;gap:6px;color:#ff6b6b;font-weight:500}",
			".dshmh-dot{width:7px;height:7px;border-radius:50%;background:#ff4d4f;box-shadow:0 0 0 2px rgba(255,77,79,.18);display:inline-block}",
			".dshmh-inline{margin:0}",
			".dshmh-subtitle{color:var(--dsw-alias-label-primary,inherit);margin:24px 0 0;font-size:14px;font-weight:500;line-height:22px}",
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
			".dshmh-select{appearance:none;min-width:132px;padding:6px 26px 6px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:#202227;color:#e8eaed;font-size:13px;cursor:pointer}",
			"html[data-dshmh-account-row=\"1\"] li[class*=\"_rowCard\"]:has([class*=\"_accountStatus\"]){display:none!important}",
		].join("");

		/** 账号行首屏预藏：CSS 在第一次绘制前就生效，不用等 JS 跑。 */
		function syncPreHide() {
			const html = document.documentElement;
			if (html === null || html === undefined) return;
			if (prefs.accountRow === true) html.setAttribute("data-dshmh-account-row", "1");
			else html.removeAttribute("data-dshmh-account-row");
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

		function ToggleRow({ label, hint, checked, onChange }) {
			const control = OfficialSwitch !== null
				? React.createElement(OfficialSwitch, { checked, label, onChange: (next) => { onChange(next === true); } })
				: React.createElement("input", {
					type: "checkbox",
					checked,
					"aria-label": label,
					onChange: (event) => { onChange(event.target.checked === true); },
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
		function SettingsSection() {
			const [, setTick] = React.useState(0);
			const [shell, setShell] = React.useState(null);
			const [busy, setBusy] = React.useState(false);
			const [note, setNote] = React.useState(null);
			const [reasoning, setReasoning] = React.useState(null);
			const [draftGlobal, setDraftGlobal] = React.useState(null);
			const [draftOverrides, setDraftOverrides] = React.useState({});
			const [reasoningBusy, setReasoningBusy] = React.useState(false);
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

			const checkUpdate = () => {
				setUpdate((prev) => ({ ...(prev ?? {}), status: "loading" }));
				fetch(UPDATE_ROUTE, { credentials: "same-origin" }).then((response) => response.json()).then(
					(state) => setUpdate({ status: "done", ...state }),
					(error) => setUpdate({ status: "error", error: String((error && error.message) || error) }),
				);
			};

			React.useEffect(() => { checkUpdate(); }, []);

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
			const loadReasoning = (keepDraft) => {
				fetch(REASONING_ROUTE, { credentials: "same-origin" }).then((response) => response.json()).then((state) => {
					if (!aliveRef.current) return;
					setReasoning(state);
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
				}, () => {});
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
				["sidebarPlugins", "sidebarPluginsLabel", "sidebarPluginsHint"],
				["sidebarSchedules", "sidebarSchedulesLabel", "sidebarSchedulesHint"],
				["sidebarMore", "sidebarMoreLabel", "sidebarMoreHint"],
				["sidebarNewSession", "sidebarNewSessionLabel", "sidebarNewSessionHint"],
			].map(([key, label, hint]) => React.createElement(ToggleRow, {
				key,
				label: t(label),
				hint: t(hint),
				checked: prefs[key] === true,
				onChange: toggle(key),
			}));

			// 账号菜单是另一处界面，单独成组，和「设置 · 模型」并列。
			const accountRows = [
				["feedback", "feedbackLabel", "feedbackHint"],
				["signOut", "signOutLabel", "signOutHint"],
			].map(([key, label, hint]) => React.createElement(ToggleRow, {
				key,
				label: t(label),
				hint: hint === null ? undefined : t(hint),
				checked: prefs[key] === true,
				onChange: toggle(key),
			}));

			const levels = reasoning !== null && Array.isArray(reasoning.levels)
				? reasoning.levels
				: ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
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
						text: state.changed > 0 ? t("reasoningApplied") + changedProfiles(state.written) : t("reasoningUnchanged"),
					});
				}, (error) => setReasoningNote({ tone: "error", text: t("reasoningFailed") + String((error && error.message) || error) })).then(() => setReasoningBusy(false));
			};

			const reasoningButton = OfficialButton !== null
				? React.createElement(OfficialButton, { disabled: reasoningBusy, onClick: applyReasoningNow }, t("reasoningApply"))
				: React.createElement("button", { type: "button", className: "dshmh-btn", disabled: reasoningBusy, onClick: applyReasoningNow }, t("reasoningApply"));

			const reloadReasoningButton = OfficialButton !== null
				? React.createElement(OfficialButton, { disabled: reasoningBusy, onClick: () => loadReasoning(true) }, t("reasoningReload"))
				: React.createElement("button", { type: "button", className: "dshmh-btn", disabled: reasoningBusy, onClick: () => loadReasoning(true) }, t("reasoningReload"));

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

			return React.createElement("div", { className: "dshmh-page" },
				React.createElement("h2", { className: "dshmh-title" }, t("title")),
				React.createElement("p", { className: "dshmh-desc" }, t("desc")),
				React.createElement("p", { className: "dshmh-note" }, t("autoRefreshNote")),
				React.createElement("div", { className: "dshmh-project" },
					React.createElement("a", {
						className: "dshmh-link",
						href: REPO_URL,
						target: "_blank",
						rel: "noreferrer",
						onClick: (event) => {
							// Electron 里 window.open 会被拦，退回普通跳转由 will-navigate 交给系统浏览器。
							const opened = window.open(REPO_URL, "_blank", "noopener");
							if (opened === null) { event.preventDefault(); window.location.href = REPO_URL; }
						},
					}, t("updateRepo") + " · github.com/Biu-Bong/dsh-menu-hidden"),
					update !== null && typeof update.current === "string" ? React.createElement("span", { className: "dshmh-version" }, "v" + update.current) : null,
					update !== null && update.hasUpdate === true ? React.createElement("span", { className: "dshmh-new" },
						React.createElement("span", { className: "dshmh-dot", "aria-hidden": "true" }),
						t("updateNew") + " v" + String(update.latest)) : null,
					React.createElement("button", {
						type: "button",
						className: "dshmh-btn",
						disabled: update !== null && update.status === "loading",
						onClick: checkUpdate,
					}, update !== null && update.status === "loading" ? t("updateChecking") : t("updateCheck")),
					update !== null && update.status === "done" && update.hasUpdate !== true ? React.createElement("span", { className: "dshmh-caption dshmh-inline" }, t("updateLatest")) : null,
					update !== null && update.status === "error" ? React.createElement("span", { className: "dshmh-caption dshmh-inline" }, t("updateFailed") + "：" + String(update.error ?? "")) : null,
				),

				React.createElement("h3", { className: "dshmh-subtitle" }, t("groupPicker")),
				...rows,

				React.createElement("h3", { className: "dshmh-subtitle" }, t("groupSettings")),
				...settingRows,

				React.createElement("h3", { className: "dshmh-subtitle" }, t("groupSidebar")),
				...sidebarRows,

				React.createElement("h3", { className: "dshmh-subtitle" }, t("groupAccount")),
				...accountRows,

				React.createElement("h3", { className: "dshmh-subtitle" }, t("groupReasoning")),
				React.createElement("p", { className: "dshmh-caption" }, t("reasoningDesc")),
				globalRow,
				React.createElement("div", { className: "dshmh-row" },
					React.createElement("span", { className: "dshmh-text" },
						React.createElement("span", { className: "dshmh-label" }, t("reasoningProviders"))),
					React.createElement("span", { className: "dshmh-side dshmh-actions" }, reasoningButton, reloadReasoningButton)),
				...providerRows,
				reasoningNote === null ? null : React.createElement("p", { className: "dshmh-hint", "data-tone": reasoningNote.tone ?? undefined, role: "status" }, reasoningNote.text),
				providers.length > 0 ? null : React.createElement("p", { className: "dshmh-hint" }, t("reasoningEmpty")),

				React.createElement("div", { className: "dshmh-row" },
					React.createElement("span", { className: "dshmh-text" },
						React.createElement("span", { className: "dshmh-label" }, t("shellLabel")),
						React.createElement("span", { className: "dshmh-hint" }, t("shellHint")),
						shellState === "" ? null : React.createElement("span", { className: "dshmh-hint", "data-tone": shellPatched ? "ok" : undefined }, shellState),
						note === null ? null : React.createElement("span", { className: "dshmh-hint", "data-tone": note.tone ?? undefined, role: "status" }, note.text),
						React.createElement("span", { className: "dshmh-hint" }, t("shellRestartHint"))),
					React.createElement("span", { className: "dshmh-side" }, buttons[0], buttons[1])),

				React.createElement("div", { className: "dshmh-row" },
					React.createElement("span", { className: "dshmh-text" },
						React.createElement("span", { className: "dshmh-label" }, t("refreshLabel")),
						React.createElement("span", { className: "dshmh-hint" }, t("refreshHint"))),
					React.createElement("span", { className: "dshmh-side" }, buttons[2])));
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
		function apply(ctx) {
			loadPrefs();
			injectStyle();
			syncPreHide();

			t = bindLocale(ctx.get("locale"), DICT);

			startObserver();
			ctx.effect(() => () => { stopObserver(); });

			// 少一个服务就少一件事，别让整条客户端模块图跟着挂掉。
			const slots = ctx.get("slots");
			if (slots === undefined || slots === null || typeof slots.inject !== "function") return;

			// 设置分区本身不受任何开关影响 —— 否则关掉就回不来了。
			ctx.effect(() => slots.inject(SETTINGS_SECTION_SLOT, () => slots.register({
				name: SETTINGS_SECTION_SLOT,
				id: ID,
				order: 92,
				label: () => t("sectionLabel"),
			}, SettingsSection)));
		}

		// factory 的返回值就是模块导出：浏览器里没有 CommonJS 的 module / exports，
		// 官方打包产物是构建器自己补 `var module = { exports: {} }` 那两行；手写的
		// client.js 没有那层壳，所以直接 return 插件对象（cordis 支持 { apply } 形状）。
		return { name: ID, inject: ["slots", "locale"], apply };
	},
});
