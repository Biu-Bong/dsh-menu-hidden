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
		const SETTINGS_SECTION_SLOT = "settings.section";

		// ── §1 文案（跟随应用语言） ────────────────────────────────────────────
		const DICT = {
			zh: {
				sectionLabel: "菜单隐藏",
				title: "菜单隐藏",
				desc: "把界面上重复的 DeepSeek 账号 / 官方 API 入口收起来，并给应用菜单补上刷新与重启。开关保存后立刻生效，不用刷新页面。",
				groupPicker: "模型选择框",
				groupSettings: "设置 · 模型",
				groupMenus: "菜单",
				accountGroupLabel: "隐藏「DeepSeek 账号」分组",
				accountGroupHint: "模型下拉框里那个带账号图标的分组，连它的模型一起藏。",
				officialGroupLabel: "隐藏「DeepSeek」（官方 API）分组",
				officialGroupHint: "模型下拉框里官方 API 那一组。两组都关掉，下拉框会只剩第三方模型。",
				accountRowLabel: "隐藏「DeepSeek 账号」整行",
				accountRowHint: "设置 · 模型里账号那一条整行消失，右边的编辑 / 删除一起走 —— 不是只藏「已登录」三个字。",
				officialRowLabel: "隐藏「DeepSeek」官方 API 那一行",
				officialRowHint: "设置 · 模型里只留一个 DeepSeek 账号，不再出现第二个 DeepSeek 行。整行藏掉后，改官方 API 的入口也一起没了。",
				feedbackLabel: "隐藏账号菜单里的「意见反馈」",
				feedbackHint: "右下角账号菜单里那一项。旁边的「设置」「退出登录」保持原样。",
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
				desc: "Tuck away the duplicate DeepSeek account / official API entries, and add Reload and Restart to the application menu. Toggles take effect the moment you flip them.",
				groupPicker: "Model picker",
				groupSettings: "Settings · Models",
				groupMenus: "Menus",
				accountGroupLabel: "Hide the \"DeepSeek Account\" group",
				accountGroupHint: "The account group at the top of the model dropdown, models included.",
				officialGroupLabel: "Hide the \"DeepSeek\" (official API) group",
				officialGroupHint: "The official API group in the model dropdown. Hiding both leaves only third-party models.",
				accountRowLabel: "Hide the whole \"DeepSeek Account\" row",
				accountRowHint: "The entire row disappears from the Models page, buttons included — not just the Signed in text.",
				officialRowLabel: "Hide the \"DeepSeek\" official API row",
				officialRowHint: "Leaves a single account row on the Models page. The row is the only entry point for editing the official API key.",
				feedbackLabel: "Hide \"Feedback\" in the account menu",
				feedbackHint: "The item at the bottom right. Settings and Sign out stay as they are.",
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
			accountRow: true,
			officialRow: true,
			feedback: true,
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
		const OFFICIAL_GROUP_LABELS = ["DeepSeek"];
		/** 设置 · 模型页的 provider 行名。 */
		const ACCOUNT_ROW_LABELS = ["DeepSeek 账号", "DeepSeek Account"];
		const OFFICIAL_ROW_LABELS = ["DeepSeek"];
		/** 账号菜单里的意见反馈。 */
		const FEEDBACK_LABELS = ["意见反馈", "Feedback"];
		/** 设置页 provider 行的类名后缀（Vite CSS Modules：_hash_rowName）。 */
		const ROW_NAME_SELECTOR = '[class*="_rowName"]';
		const MENU_GROUP_SELECTOR = "section[data-menu-group]";
		const MENU_ITEM_SELECTOR = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';
		const ACCOUNT_BADGE_SELECTOR = '[class*="_accountStatus"]';

		// ── §4 隐藏 / 还原 ────────────────────────────────────────────────────
		/**
		 * 藏起或放回一个节点。只碰 style，节点本身留在 DOM 里，React 的 diff 不受影响。
		 * @param {Element | null} element - 目标节点。
		 * @param {boolean} hide - 是否隐藏。
		 */
		function setHidden(element, hide) {
			if (element === null || element === undefined || element.nodeType !== 1) return;
			if (hide) {
				if (element.hasAttribute(MARK)) return;
				element.setAttribute(MARK, element.getAttribute("style") ?? "");
				element.style.setProperty("display", "none", "important");
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
				const row = name.closest("li");
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

		/** 账号菜单：藏「意见反馈」，连带把只剩它一个的容器一起藏，别留孤零零的分隔线。 */
		function sweepAccountMenu(root) {
			const items = root.matches(MENU_ITEM_SELECTOR) ? [root, ...root.querySelectorAll(MENU_ITEM_SELECTOR)] : [...root.querySelectorAll(MENU_ITEM_SELECTOR)];
			for (const item of items) {
				const text = (item.textContent ?? "").trim();
				if (!matches(FEEDBACK_LABELS, text)) continue;
				setHidden(item, prefs.feedback === true);
				const holder = item.parentElement;
				if (holder === null || holder === root) continue;
				const only = holder.children.length === 1 && holder.getAttribute("role") === "presentation";
				if (only) setHidden(holder, prefs.feedback === true);
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
			for (const step of [sweepModelMenu, sweepSettingsRows, sweepAccountMenu]) {
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
		function onMutations(records) {
			const seen = new Set();
			for (const record of records) {
				const candidates = [record.target, ...record.addedNodes];
				for (const node of candidates) {
					if (node === null || node === undefined || node.nodeType !== 1 || seen.has(node)) continue;
					seen.add(node);
					try {
						sweepRoot(node);
					} catch (error) {
						console.error("[dsh-menu-hidden] sweep failed", error);
					}
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
			if (observer !== null) {
				observer.disconnect();
				observer = null;
			}
			for (const element of document.querySelectorAll("[" + MARK + "]")) setHidden(element, false);
		}

		// ── §6 样式 ───────────────────────────────────────────────────────────
		const CSS = [
			".dshmh-page{box-sizing:border-box;display:flex;flex-direction:column;width:100%;max-width:720px;margin:0 auto;padding:24px}",
			".dshmh-title{color:var(--dsw-alias-label-primary,inherit);margin:0 0 4px;font-size:16px;font-weight:500;line-height:24px}",
			".dshmh-desc{color:var(--dsw-alias-label-secondary,inherit);margin:0;font-size:14px;line-height:22px}",
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
			document.head.appendChild(tag);
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
					React.createElement("span", { className: "dshmh-label" }, label),
					hint ? React.createElement("span", { className: "dshmh-hint" }, hint) : null),
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

			React.useEffect(() => {
				let alive = true;
				shellFetch(undefined).then(
					(state) => { if (alive) setShell(state); },
					(error) => { if (alive) setNote({ tone: "error", text: t("shellFailed") + String((error && error.message) || error) }); },
				);
				return () => { alive = false; };
			}, []);

			const toggle = (key) => (next) => {
				prefs[key] = next === true;
				savePrefs();
				syncPreHide();
				sweep();
				setTick((n) => n + 1);
			};

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
			].map(([key, label, hint]) => React.createElement(ToggleRow, {
				key,
				label: t(label),
				hint: t(hint),
				checked: prefs[key] === true,
				onChange: toggle(key),
			}));

			const settingRows = [
				["accountRow", "accountRowLabel", "accountRowHint"],
				["officialRow", "officialRowLabel", "officialRowHint"],
			].map(([key, label, hint]) => React.createElement(ToggleRow, {
				key,
				label: t(label),
				hint: t(hint),
				checked: prefs[key] === true,
				onChange: toggle(key),
			}));

			const menuRows = [React.createElement(ToggleRow, {
				key: "feedback",
				label: t("feedbackLabel"),
				hint: t("feedbackHint"),
				checked: prefs.feedback === true,
				onChange: toggle("feedback"),
			})];

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

				React.createElement("h3", { className: "dshmh-subtitle" }, t("groupPicker")),
				...rows,

				React.createElement("h3", { className: "dshmh-subtitle" }, t("groupSettings")),
				...settingRows,

				React.createElement("h3", { className: "dshmh-subtitle" }, t("groupMenus")),
				...menuRows,

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
		 * @param {object} ctx - 客户端上下文。
		 */
		function apply(ctx) {
			loadPrefs();
			injectStyle();
			syncPreHide();

			const slots = ctx.get("slots");
			const locale = ctx.get("locale");
			if (locale !== undefined && locale !== null && typeof locale.register === "function") {
				try {
					locale.register(LOCALE_NS, DICT);
					t = locale.bind(LOCALE_NS);
				} catch (error) {
					console.error("[dsh-menu-hidden] locale binding failed", error);
				}
			}

			startObserver();
			ctx.effect(() => () => { stopObserver(); });

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
