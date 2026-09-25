window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-usage-heatmap",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region src/client/index.ts
		var React = require("react");
		var h = React.createElement;
		var PLUGIN_ID = "@dsh-external/dsh-usage-heatmap";
		var API = "/@dsh-external/dsh-usage-heatmap/api";
		var SECTION_LABEL = "模型用量统计";
		/**
		* 设置页导航图标（热力图 3×3，供 CSS mask 使用）。
		*
		* **为什么需要补丁**（2026-09-25 查证）：
		*  ① 宿主 `ui-settings-general` 的 `navIcon(id)` 是**按 id 硬编码**的图标映射，
		*     源码注释原文：`unknown ids fall back to the settings gear` ⇒ 第三方分区只能拿到齿轮；
		*  ② `settings.section` 槽位契约（client-runner 的 `registerOptions`）只有
		*     `id` / `order` / `label`，**没有 icon 字段**；
		*  ③ 借用已发布的 id（account / models / agent-presets / plugins / archived-sessions）会按契约
		*     「reusing a shipped id puts you in THAT cell and replaces it」**顶替掉官方分区**，绝不可行。
		* ⇒ 降级方案：JS 只给「我们这一行」加 `data-uh-nav-icon` 标记，CSS 隐藏宿主 svg 并用 mask 画出本图标。
		*   `background:currentColor` ⇒ 自动跟随 hover/active 的主题色。
		*   宿主 DOM 结构若变化，补丁**静默失效**（不影响面板本体功能）。
		*
		* 尺寸：网格墨迹 span 2..13 = **11px**——格子 3px（v3 定稿）+ 间隙 1px（v2 的值，
		* 用户要求"间隙回之前的"）。全整数坐标，1x 下锐利。图标设计惯例就是 viewBox 四周
		* 留呼吸边——官方齿轮与 dshmarket 的 block mark（实测 13×12）都是如此。
		*/
		var NAV_ICON_MASK = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cg fill='%23000'%3E%3Crect x='2' y='2' width='3' height='3' rx='0.8' opacity='.25'/%3E%3Crect x='6' y='2' width='3' height='3' rx='0.8' opacity='.45'/%3E%3Crect x='10' y='2' width='3' height='3' rx='0.8' opacity='.65'/%3E%3Crect x='2' y='6' width='3' height='3' rx='0.8' opacity='.45'/%3E%3Crect x='6' y='6' width='3' height='3' rx='0.8' opacity='.65'/%3E%3Crect x='10' y='6' width='3' height='3' rx='0.8' opacity='.85'/%3E%3Crect x='2' y='10' width='3' height='3' rx='0.8' opacity='.65'/%3E%3Crect x='6' y='10' width='3' height='3' rx='0.8' opacity='.85'/%3E%3Crect x='10' y='10' width='3' height='3' rx='0.8'/%3E%3C/g%3E%3C/svg%3E\")";
		var CSS = [
			".uh-page{display:flex;flex-direction:column;color:var(--dsw-alias-label-primary,#1f2329);box-sizing:border-box;touch-action:pan-y;max-height:calc(100vh - 150px);overflow-y:auto;overflow-x:hidden;overscroll-behavior:auto;scrollbar-gutter:stable;-webkit-overflow-scrolling:touch;will-change:scroll-position}",
			".uh-page::-webkit-scrollbar{width:6px}",
			".uh-page::-webkit-scrollbar-track{background:transparent;margin:16px 0}",
			".uh-page::-webkit-scrollbar-thumb{background:transparent;border-radius:99px}",
			".uh-page.uh-scrolling::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2,rgba(0,0,0,.18))}",
			".uh-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:2px 0 14px;border-bottom:1px solid var(--dsw-alias-border-default,#e5e5e5);flex-wrap:wrap}",
			".uh-brand{display:flex;flex-direction:column;min-width:0}",
			".uh-brandName{font-size:17px;font-weight:600;line-height:24px;color:var(--dsw-alias-label-primary,#1a1a1a)}",
			".uh-brandDesc{margin:2px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#555)}",
			".uh-headerRight{display:flex;align-items:center;gap:10px;flex-wrap:wrap}",
			".uh-sum{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#646a73);font-variant-numeric:tabular-nums}",
			".uh-card{position:relative;border:1px solid var(--dsw-alias-border-l2,#f0f1f3);border-radius:10px;padding:12px 14px;background:var(--dsw-alias-bg-layer-3,#fff);box-shadow:0 1px 2px rgb(31 35 41 / 2%)}",
			".uh-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(164px,1fr));gap:10px;margin:14px 0}",
			".uh-metricLabel{display:flex;align-items:center;gap:7px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#646a73)}",
			".uh-metricIcon{display:inline-grid;place-items:center;width:15px;height:15px;border-radius:4px;font-size:10px;line-height:1;flex:none;color:#1677ff;background:rgb(22 119 255 / 9%)}",
			".uh-metricValue{margin-top:7px;font-size:20px;font-weight:650;line-height:26px;letter-spacing:-.01em;color:var(--dsw-alias-label-primary,#1f2329);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".uh-metricSub{margin-top:4px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8f959e);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".uh-metricSub b{font-weight:600;color:var(--dsw-alias-label-secondary,#646a73)}",
			".uh-section{margin-bottom:14px}",
			".uh-sectionHead{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px}",
			".uh-sectionTitle{margin:0;font-size:14px;line-height:20px;font-weight:640;color:var(--dsw-alias-label-primary,#1f2329)}",
			".uh-sectionDesc{margin:2px 0 0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8f959e)}",
			".uh-tools{display:flex;align-items:center;gap:12px;flex-wrap:wrap}",
			".uh-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l2,#dfe1e5);border-radius:9px;overflow:hidden;background:var(--dsw-alias-bg-layer-2,#f4f5f7)}",
			".uh-segBtn{padding:4px 13px;font-size:12px;line-height:18px;border:0;background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary,#646a73);transition:background .15s ease,color .15s ease}",
			".uh-segBtn + .uh-segBtn{border-left:1px solid var(--dsw-alias-border-l2,#dfe1e5)}",
			".uh-segBtn:hover{color:var(--dsw-alias-label-primary,#1f2329);background:rgb(0 0 0 / 4%)}",
			".uh-segBtn[aria-pressed=\"true\"]{background:#1677ff;color:#fff}",
			".uh-segBtn:focus-visible{outline:2px solid color-mix(in srgb,#1677ff 55%,transparent);outline-offset:-2px}",
			".uh-legend{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--dsw-alias-label-tertiary,#8f959e)}",
			".uh-legendSw{width:11px;height:11px;border-radius:2px;background:var(--uh-l0)}",
			".uh-calWrap{overflow-x:auto;padding:2px 0 6px}",
			".uh-cal{width:100%;--uh-tracks:var(--uh-gutter,16px) repeat(var(--uh-cols,37),minmax(var(--uh-cell-min,11px),1fr))}",
			".uh-main{display:flex;flex-direction:column;gap:4px;min-width:0}",
			".uh-months{display:grid;grid-template-columns:var(--uh-tracks);gap:3px;height:13px;width:100%;font-size:10px;line-height:13px;color:var(--dsw-alias-label-tertiary,#8f959e);font-variant-numeric:tabular-nums}",
			".uh-months > span{white-space:nowrap}",
			".uh-months > span.uh-monthEnd{justify-self:end}",
			".uh-wdLabel{display:flex;align-self:center;height:0;overflow:visible;align-items:center;justify-content:flex-end;font-size:9px;line-height:1;color:var(--dsw-alias-label-tertiary,#8f959e);text-align:right;transform:translateY(-0.0667em)}",
			".uh-cells{display:grid;grid-auto-flow:column;grid-template-columns:var(--uh-tracks);grid-template-rows:repeat(7,auto);gap:3px;width:100%;transform:translateZ(0)}",
			".uh-weekCells{display:grid;grid-template-columns:var(--uh-tracks);gap:3px;width:100%;transform:translateZ(0)}",
			".uh-cell{aspect-ratio:1;border-radius:2px;background:var(--uh-l0);cursor:pointer}",
			".uh-cell:hover{outline:2px solid rgb(31 35 41 / 45%);outline-offset:0}",
			".uh-cell[data-future=\"1\"]{visibility:hidden;pointer-events:none}",
			".uh-cell[data-l=\"0\"]{background:var(--uh-l0)}",
			".uh-cell[data-l=\"1\"]{background:var(--uh-l1)}",
			".uh-cell[data-l=\"2\"]{background:var(--uh-l2)}",
			".uh-cell[data-l=\"3\"]{background:var(--uh-l3)}",
			".uh-cell[data-l=\"4\"]{background:var(--uh-l4)}",
			":root{--uh-l0:#eef1f5;--uh-l1:#bfd8ff;--uh-l2:#7fadff;--uh-l3:#3d8bfd;--uh-l4:#0f56c9}",
			".uh-tip{position:fixed;z-index:10000;transform:translate(-50%,calc(-100% - 12px));background:#1f2329;color:#fff;padding:7px 10px;border-radius:9px;font-size:12px;line-height:18px;pointer-events:none;white-space:nowrap;box-shadow:0 4px 12px rgb(0 0 0 / 18%);font-variant-numeric:tabular-nums}",
			".uh-tip b{font-weight:650}",
			".uh-tip em{font-style:normal;color:rgb(255 255 255 / 65%);font-size:11px}",
			".uh-insights{display:grid;gap:9px}",
			".uh-insight{display:flex;gap:9px;align-items:flex-start;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,#1f2329)}",
			".uh-insDot{flex:none;width:7px;height:7px;border-radius:50%;background:#1677ff;margin-top:6px}",
			".uh-insight[data-k=\"peak\"] .uh-insDot{background:#f59e0b}",
			".uh-insight[data-k=\"streak\"] .uh-insDot{background:#f97316}",
			".uh-insight[data-k=\"cache\"] .uh-insDot{background:#7b5cff}",
			".uh-insight[data-k=\"week\"] .uh-insDot{background:#1677ff}",
			".uh-insight[data-k=\"scope\"] .uh-insDot{background:#94a3b8}",
			".uh-insight[data-k=\"rhythm\"] .uh-insDot{background:#ec4899}",
			".uh-insight[data-k=\"subagent\"] .uh-insDot{background:#0ea5e9}",
			".uh-insight[data-k=\"deleted\"] .uh-insDot{background:#f43f5e}",
			".uh-insight em{font-style:normal;color:var(--dsw-alias-label-secondary,#646a73);font-size:12px}",
			".uh-btn{font-size:12px;line-height:18px;padding:4px 12px;border:1px solid var(--dsw-alias-border-l2,#dfe1e5);border-radius:8px;background:var(--dsw-alias-bg-layer-3,#fff);cursor:pointer;color:var(--dsw-alias-label-primary,#1f2329);white-space:nowrap;transition:border-color .15s ease,background .15s ease,color .15s ease}",
			".uh-btn:hover:not(:disabled){border-color:color-mix(in srgb,#1677ff 40%,var(--dsw-alias-border-l2,#dfe1e5));color:#1677ff;background:color-mix(in srgb,#1677ff 6%,var(--dsw-alias-bg-layer-3,#fff))}",
			".uh-btn[data-kind=\"primary\"]{background:#1677ff;color:#fff;border-color:#1677ff}",
			".uh-btn[data-kind=\"primary\"]:hover:not(:disabled){background:#0f5fce;border-color:#0f5fce;color:#fff}",
			".uh-btn:disabled{opacity:.5;cursor:default}",
			".uh-note{margin-top:2px;padding:9px 11px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2,#eef0f3);background:var(--dsw-alias-bg-layer-2,#f7f8fa);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#646a73)}",
			".uh-note[data-tone=\"warn\"]{border-color:color-mix(in srgb,#e37400 35%,var(--dsw-alias-border-l2,#eef0f3));background:rgb(227 116 0 / 8%);color:#b45309}",
			".uh-empty{padding:26px 8px;text-align:center;font-size:13px;color:var(--dsw-alias-label-tertiary,#8f959e)}"
		].join("\n");
		function ensureCss() {
			if (typeof document === "undefined") return;
			if (document.getElementById("uh-usage-heatmap-style")) return;
			var tag = document.createElement("style");
			tag.id = "uh-usage-heatmap-style";
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		var _cache = {
			at: 0,
			raw: null,
			data: null,
			promise: null
		};
		var SWR_TTL_MS = 1e4;
		var POLL_MS = 15e3;
		function fetchState(force) {
			var now = Date.now();
			if (!force && _cache.data && now - _cache.at < SWR_TTL_MS) return Promise.resolve(_cache.data);
			if (_cache.promise) return _cache.promise;
			var url = API + "/state" + (force ? "?fresh=1" : "");
			_cache.promise = fetch(url, { cache: "no-store" }).then(function(r) {
				return r.json().then(function(s) {
					if (!r.ok) throw new Error(s && s.error || "HTTP " + r.status);
					return s;
				}, function() {
					throw new Error("HTTP " + r.status);
				});
			}).then(function(s) {
				_cache.promise = null;
				var raw = JSON.stringify(s);
				if (raw === _cache.raw) return _cache.data || s;
				_cache.raw = raw;
				_cache.data = s;
				_cache.at = Date.now();
				return s;
			}).catch(function(e) {
				_cache.promise = null;
				throw e;
			});
			return _cache.promise;
		}
		function usePanelData() {
			var useState = React.useState;
			var useEffect = React.useEffect;
			var _d = useState(_cache.data);
			var data = _d[0];
			var setData = _d[1];
			var _l = useState(!_cache.data);
			var loading = _l[0];
			var setLoading = _l[1];
			var _e = useState("");
			var err = _e[0];
			var setErr = _e[1];
			function load(force) {
				if (!data) setLoading(true);
				setErr("");
				return fetchState(force).then(function(s) {
					setData(function(prev) {
						return s === prev ? prev : s;
					});
					setLoading(false);
				}).catch(function(e) {
					setErr(String(e && e.message || e));
					setLoading(false);
				});
			}
			useEffect(function() {
				ensureCss();
				load(false).then(function() {
					return load(true);
				});
				var timer = setInterval(function() {
					load(false);
				}, POLL_MS);
				return function() {
					clearInterval(timer);
				};
			}, []);
			return {
				data,
				loading,
				err,
				load
			};
		}
		function fmtTokens(n) {
			if (!isFinite(n) || n <= 0) return "0";
			if (n >= 1e8) return (n / 1e8).toFixed(2).replace(/\.?0+$/, "") + "亿";
			if (n >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, "") + "万";
			return String(Math.round(n));
		}
		function fmtExact(n) {
			return Math.round(n).toLocaleString("en-US");
		}
		function fmtDur(ms) {
			if (ms <= 0) return "—";
			var min = Math.floor(ms / 6e4);
			if (min >= 1440) return Math.floor(min / 1440) + "天" + Math.floor(min % 1440 / 60) + "小时";
			if (min >= 60) return Math.floor(min / 60) + "小时" + min % 60 + "分";
			return min + "分";
		}
		function fmtAgo(ts) {
			if (!ts || ts <= 0) return "—";
			var diff = Date.now() - ts;
			if (diff < 6e4) return "刚刚";
			if (diff < 36e5) return Math.round(diff / 6e4) + " 分钟前";
			if (diff < 864e5) return Math.round(diff / 36e5) + " 小时前";
			return fmtMD(new Date(ts).getFullYear() + "-" + pad2(new Date(ts).getMonth() + 1) + "-" + pad2(new Date(ts).getDate()));
		}
		function pad2(n) {
			return n < 10 ? "0" + n : String(n);
		}
		var WD = [
			"一",
			"二",
			"三",
			"四",
			"五",
			"六",
			"日"
		];
		function parseKey(key) {
			var p = key.split("-");
			return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
		}
		function keyOf(d) {
			return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
		}
		/** 'M月D日' */
		function fmtMD(key) {
			var d = parseKey(key);
			return d.getMonth() + 1 + "月" + d.getDate() + "日";
		}
		/** 'M月D日（周X）' */
		function fmtMDWd(key) {
			var d = parseKey(key);
			return fmtMD(key) + "（周" + WD[(d.getDay() + 6) % 7] + "）";
		}
		function addDays(key, delta) {
			var d = parseKey(key);
			d.setDate(d.getDate() + delta);
			return keyOf(d);
		}
		/** 该日所在周的周一 */
		function mondayOf(key) {
			var d = parseKey(key);
			var shift = (d.getDay() + 6) % 7;
			d.setDate(d.getDate() - shift);
			return keyOf(d);
		}
		function todayKey() {
			return keyOf(/* @__PURE__ */ new Date());
		}
		function daysBetween(a, b) {
			return Math.round((parseKey(b).getTime() - parseKey(a).getTime()) / 864e5);
		}
		function pct(part, whole) {
			if (whole <= 0) return "0%";
			return Math.round(part / whole * 100) + "%";
		}
		function MetricCard(props) {
			return h("div", {
				className: "uh-card",
				key: props.label
			}, h("div", { className: "uh-metricLabel" }, h("span", { className: "uh-metricIcon" }, props.icon || "●"), props.label), h("div", {
				className: "uh-metricValue",
				title: props.title || ""
			}, props.value), props.sub ? h("div", {
				className: "uh-metricSub",
				title: props.subTitle || ""
			}, props.sub) : null);
		}
		/** 容器实测宽度 → 列数的常量与换算（列宽 = cellMin 格 + 3px gap；行标槽另占 GUTTER 宽） */
		var COLS_MAX = 54;
		var GUTTER = 16;
		var COL_SAFETY = 4;
		function calcCols(availW, cellMin, gutter) {
			var stride = cellMin + 3;
			var n = Math.floor((availW - gutter - COL_SAFETY) / stride);
			if (!(n >= 1)) n = 1;
			return Math.min(COLS_MAX, n);
		}
		/** 展示区间：从本周起向右回溯，取最近 maxCols 周（列数由容器宽度决定 → 格子保持 ≥11px 正方形铺满） */
		function buildRange(maxCols) {
			var cur = mondayOf(todayKey());
			var columns = [];
			var n = 0;
			while (n++ < maxCols && n <= 400) {
				columns.push(cur);
				cur = addDays(cur, -7);
			}
			return { columns };
		}
		/** 分位分档（GitHub 算法）：values 升序 → v 的档位 1..4 */
		function makeLevelFn(values) {
			var sorted = values.filter(function(v) {
				return v > 0;
			}).sort(function(a, b) {
				return a - b;
			});
			if (!sorted.length) return function() {
				return 0;
			};
			return function(v) {
				if (v <= 0) return 0;
				var lo = 0;
				var hi = sorted.length;
				while (lo < hi) {
					var mid = lo + hi >> 1;
					if (sorted[mid] <= v) lo = mid + 1;
					else hi = mid;
				}
				return Math.min(4, Math.ceil(lo / sorted.length * 4));
			};
		}
		/** 累计前缀：sortedKeys + prefix，cumAt(key) = 截至该日（含）的总量 */
		function makeCumulative(days) {
			var keys = Object.keys(days).sort();
			var prefix = [];
			var run = 0;
			for (var i = 0; i < keys.length; i++) {
				run += days[keys[i]];
				prefix.push(run);
			}
			return function(key) {
				var lo = 0;
				var hi = keys.length - 1;
				var ans = -1;
				while (lo <= hi) {
					var mid = lo + hi >> 1;
					if (keys[mid] <= key) {
						ans = mid;
						lo = mid + 1;
					} else hi = mid - 1;
				}
				return ans < 0 ? 0 : prefix[ans];
			};
		}
		function weekValue(days, monday) {
			var sum = 0;
			for (var i = 0; i < 7; i++) sum += days[addDays(monday, i)] || 0;
			return sum;
		}
		function weekActiveDays(days, monday) {
			var n = 0;
			for (var i = 0; i < 7; i++) if ((days[addDays(monday, i)] || 0) > 0) n++;
			return n;
		}
		function monthLabels(columns) {
			var out = [];
			var prev = -1;
			for (var i = 0; i < columns.length; i++) {
				var m = parseKey(columns[i]).getMonth();
				out.push(i === 0 || m !== prev ? m + 1 + "月" : "");
				prev = m;
			}
			return out;
		}
		function HeatmapCard(props) {
			var days = props.days || {};
			var m = props.metrics || {};
			var _mode = React.useState("day");
			var mode = _mode[0];
			var setMode = _mode[1];
			var tipElRef = React.useRef(null);
			React.useEffect(function() {
				return function() {
					var el = tipElRef.current;
					if (el && el.parentNode) el.parentNode.removeChild(el);
					tipElRef.current = null;
				};
			}, []);
			function ensureTip() {
				var el = tipElRef.current;
				if (!el || !el.parentNode) {
					el = document.createElement("div");
					el.className = "uh-tip";
					el.style.display = "none";
					document.body.appendChild(el);
					tipElRef.current = el;
				}
				return el;
			}
			function escapeHtml(s) {
				var map = {
					"&": "&amp;",
					"<": "&lt;",
					">": "&gt;",
					"\"": "&quot;"
				};
				return String(s).replace(/[&<>"]/g, function(c) {
					return map[c] || c;
				});
			}
			var tipRaf = 0;
			var tipEv = null;
			function placeTip() {
				tipRaf = 0;
				var el = tipElRef.current;
				if (el && tipEv) {
					el.style.left = tipEv.clientX + "px";
					el.style.top = tipEv.clientY + "px";
				}
			}
			function showTip(ev, lines) {
				var el = ensureTip();
				el.innerHTML = "<div><b>" + escapeHtml(String(lines[0] ?? "")) + "</b></div>" + (lines[1] != null ? "<div>" + escapeHtml(String(lines[1])) + "</div>" : "") + (lines[2] != null ? "<em>" + escapeHtml(String(lines[2])) + "</em>" : "");
				el.style.display = "block";
				tipEv = ev;
				if (!tipRaf) tipRaf = requestAnimationFrame(placeTip);
			}
			function moveTip(ev) {
				if (!tipElRef.current) return;
				tipEv = ev;
				if (!tipRaf) tipRaf = requestAnimationFrame(placeTip);
			}
			function hideTip() {
				var el = tipElRef.current;
				if (el) el.style.display = "none";
			}
			var hasData = !!(m.firstDay && Object.keys(days).length);
			var wrapRef = React.useRef(null);
			var _wrapW = React.useState(0);
			var wrapW = _wrapW[0];
			var setWrapW = _wrapW[1];
			React.useLayoutEffect(function() {
				var el = wrapRef.current;
				if (!el) return;
				var measure = function() {
					setWrapW(el.clientWidth);
				};
				measure();
				var ro = null;
				if (typeof ResizeObserver !== "undefined") {
					ro = new ResizeObserver(measure);
					ro.observe(el);
				}
				return function() {
					if (ro) ro.disconnect();
				};
			}, [hasData, mode]);
			var isWeek = mode === "week";
			var isCum = mode === "cum";
			var cellMin = isWeek ? 13 : 11;
			var showLabels = wrapW >= GUTTER + cellMin + 3;
			var gutter = showLabels ? GUTTER : 0;
			var avail = Math.max(0, wrapW - gutter - COL_SAFETY);
			var effCellMin = Math.max(1, Math.min(cellMin, avail - 3));
			var cols = calcCols(wrapW, effCellMin, gutter);
			var showMonths = wrapW >= gutter + effCellMin + 3 + 22;
			var range = React.useMemo(function() {
				return buildRange(cols);
			}, [cols]);
			var cumAt = React.useMemo(function() {
				return makeCumulative(days);
			}, [JSON.stringify(days)]);
			var months = monthLabels(range.columns);
			var lastMon = months.length - 1;
			while (lastMon > 0 && months[lastMon] === "") lastMon--;
			var monthsRow = showMonths ? h("div", { className: "uh-months" }, h("span", {
				className: "uh-monthPad",
				key: "__pad"
			}), months.map(function(mm, i) {
				return h("span", {
					key: i,
					className: i === lastMon ? "uh-monthEnd" : void 0
				}, mm);
			})) : null;
			var total = m.totalTokens || 0;
			var calStyle = {
				"--uh-cols": range.columns.length,
				"--uh-gutter": gutter + "px",
				"--uh-cell-min": effCellMin + "px"
			};
			var levelFn = React.useMemo(function() {
				if (isWeek) return makeLevelFn(range.columns.map(function(mon) {
					return weekValue(days, mon);
				}));
				if (isCum) {
					var top = cumAt(todayKey());
					return function(v) {
						if (v <= 0 || top <= 0) return 0;
						return Math.min(4, Math.ceil(v / top * 4));
					};
				}
				return makeLevelFn(Object.keys(days).map(function(k) {
					return days[k];
				}));
			}, [
				mode,
				JSON.stringify(days),
				JSON.stringify(range.columns)
			]);
			var seg = h("div", {
				className: "uh-seg",
				role: "group",
				"aria-label": "热力图粒度"
			}, [
				{
					id: "day",
					label: "每日"
				},
				{
					id: "week",
					label: "每周"
				},
				{
					id: "cum",
					label: "累计"
				}
			].map(function(it) {
				return h("button", {
					key: it.id,
					type: "button",
					className: "uh-segBtn",
					"aria-pressed": String(mode === it.id),
					onClick: function() {
						setMode(it.id);
					}
				}, it.label);
			}));
			var legend = h("div", { className: "uh-legend" }, h("span", null, "少"), [
				0,
				1,
				2,
				3,
				4
			].map(function(l) {
				return h("span", {
					key: l,
					className: "uh-legendSw",
					"data-l": String(l),
					style: { background: "var(--uh-l" + l + ")" }
				});
			}), h("span", null, "多"));
			var body;
			if (!hasData) body = h("div", { className: "uh-empty" }, "暂无用量数据——使用 DSH 后热力图会按天聚合本地会话日志");
			else if (isWeek) {
				var weekCells = range.columns.map(function(mon, i) {
					var v = weekValue(days, mon);
					var end = addDays(mon, 6);
					var act = weekActiveDays(days, mon);
					var future = mon > todayKey();
					return h("div", {
						key: mon,
						className: "uh-cell",
						"data-l": String(future ? 0 : levelFn(v)),
						"data-future": future ? "1" : "0",
						onMouseEnter: function(ev) {
							showTip(ev, [
								fmtMD(mon) + " – " + fmtMD(end),
								fmtTokens(v) + " tokens",
								"活跃 " + act + " 天 · 占累计 " + pct(v, total)
							]);
						},
						onMouseMove: moveTip,
						onMouseLeave: function() {
							hideTip();
						}
					});
				});
				body = h("div", {
					className: "uh-calWrap",
					ref: wrapRef
				}, h("div", {
					className: "uh-cal",
					style: calStyle
				}, h("div", { className: "uh-main" }, monthsRow, h("div", { className: "uh-weekCells" }, h("span", {
					className: "uh-weekPad",
					key: "__pad"
				}), weekCells))));
			} else {
				var today = todayKey();
				var dayCells = [];
				for (var c = 0; c < range.columns.length; c++) for (var r = 0; r < 7; r++) {
					var key = addDays(range.columns[c], r);
					var future = key > today;
					var dayV = days[key] || 0;
					(function(key, dayV, v, future) {
						dayCells.push(h("div", {
							key,
							className: "uh-cell",
							"data-l": String(future ? 0 : levelFn(v)),
							"data-future": future ? "1" : "0",
							onMouseEnter: function(ev) {
								if (future) return;
								showTip(ev, isCum ? [
									fmtMDWd(key),
									"累计 " + fmtTokens(v) + " tokens",
									"当日 +" + fmtTokens(dayV)
								] : [
									fmtMDWd(key),
									fmtTokens(dayV) + " tokens",
									"占累计 " + pct(dayV, total) + " · " + relDay(key)
								]);
							},
							onMouseMove: moveTip,
							onMouseLeave: function() {
								hideTip();
							}
						}));
					})(key, dayV, future ? 0 : isCum ? cumAt(key) : dayV, future);
				}
				body = h("div", {
					className: "uh-calWrap",
					ref: wrapRef
				}, h("div", {
					className: "uh-cal",
					style: calStyle
				}, h("div", { className: "uh-main" }, monthsRow, h("div", { className: "uh-cells" }, showLabels ? WD.map(function(w, i) {
					return h("span", {
						key: "wd" + i,
						className: "uh-wdLabel",
						style: {
							gridColumn: "1",
							gridRow: String(i + 1)
						}
					}, i % 2 === 0 ? w : "");
				}) : null, dayCells))));
			}
			return h("div", { className: "uh-card uh-section" }, h("div", { className: "uh-sectionHead" }, h("div", null, h("h4", { className: "uh-sectionTitle" }, "Token 活跃热力图"), h("p", { className: "uh-sectionDesc" }, isWeek ? "每格 = 一个自然周的累计用量" : isCum ? "每格 = 截至该日的历史累计用量" : "每格 = 当日用量（周一为一周之始）")), h("div", { className: "uh-tools" }, legend, seg)), body);
		}
		/** 相对日期：今天/昨天/N天前 */
		function relDay(key) {
			var diff = daysBetween(key, todayKey());
			if (diff === 0) return "今天";
			if (diff === 1) return "昨天";
			if (diff > 1 && diff < 3650) return diff + "天前";
			return "";
		}
		function buildInsights(days, m) {
			var out = [];
			if (!m) return out;
			if (m.weekTokens > 0 || m.prevWeekTokens > 0) {
				var text;
				if (m.prevWeekTokens > 0) {
					var delta = Math.round((m.weekTokens - m.prevWeekTokens) / m.prevWeekTokens * 100);
					text = "本周已用 " + fmtTokens(m.weekTokens) + "，上周 " + fmtTokens(m.prevWeekTokens) + "（" + (delta >= 0 ? "+" : "") + delta + "%）";
				} else text = "本周已用 " + fmtTokens(m.weekTokens) + "（上周无记录）";
				out.push({
					k: "week",
					text
				});
			}
			if (m.peakDay) out.push({
				k: "peak",
				text: "峰值日 " + fmtMD(m.peakDay.day) + " · " + fmtTokens(m.peakDay.tokens) + " tokens，占累计 " + pct(m.peakDay.tokens, m.totalTokens)
			});
			out.push({
				k: "streak",
				text: "连续活跃 " + m.currentStreak + " 天，历史最长 " + m.longestStreak + " 天"
			});
			var scope = "累计 " + (m.sessions + (m.deletedSessions || 0)) + " 个会话（主 " + (m.mainSessions || 0) + " · 子代理 " + (m.subagentSessions || 0) + (m.deletedSessions ? " · 已删 " + m.deletedSessions : "") + "）· " + m.turns + " 轮对话 · " + m.steps + " 个步骤";
			if (m.longestSession && m.longestSession.ms > 0) {
				var who = m.longestSession.title || shortCwd(m.longestSession.cwd) || "";
				scope += who ? "；最长会话 " + fmtDur(m.longestSession.ms) + "（" + who + "）" : "；最长会话 " + fmtDur(m.longestSession.ms);
			}
			out.push({
				k: "scope",
				text: scope
			});
			if (m.subagentSessions > 0) out.push({
				k: "subagent",
				text: "子代理会话 " + m.subagentSessions + " 个，消耗 " + fmtTokens(m.subagentTokens) + " tokens（占累计 " + pct(m.subagentTokens, m.totalTokens) + "）"
			});
			if (m.deletedSessions > 0) out.push({
				k: "deleted",
				text: "已删除会话 " + m.deletedSessions + " 个已归档，保留 " + fmtTokens(m.deletedTokens) + " tokens 不丢失"
			});
			if (m.cacheReadTokens > 0) out.push({
				k: "cache",
				text: "缓存读取 " + fmtTokens(m.cacheReadTokens) + " tokens，占累计 " + pct(m.cacheReadTokens, m.totalTokens) + "；未缓存输入 " + fmtTokens(m.uncachedInputTokens) + " · 输出 " + fmtTokens(m.outputTokens)
			});
			var wk = [
				0,
				0,
				0,
				0,
				0,
				0,
				0
			];
			var dayKeys = Object.keys(days);
			for (var i = 0; i < dayKeys.length; i++) {
				var d = parseKey(dayKeys[i]);
				wk[(d.getDay() + 6) % 7] += days[dayKeys[i]];
			}
			var best = 0;
			var sum = 0;
			for (var j = 0; j < 7; j++) {
				sum += wk[j];
				if (wk[j] > wk[best]) best = j;
			}
			if (sum > 0 && wk[best] > 0) out.push({
				k: "rhythm",
				text: "最活跃的是周" + WD[best] + "：贡献 " + fmtTokens(wk[best]) + " tokens（" + pct(wk[best], sum) + "）"
			});
			return out;
		}
		function shortCwd(cwd) {
			if (!cwd) return "";
			var parts = cwd.split(/[\\/]/);
			return parts[parts.length - 1] || cwd;
		}
		function Btn(props) {
			return h("button", {
				className: "uh-btn",
				"data-kind": props.kind,
				disabled: props.disabled,
				onClick: props.onClick,
				title: props.title || ""
			}, props.children);
		}
		function UsageHeatmapPanel() {
			var s = usePanelData();
			var data = s.data;
			var m = data ? data.metrics : null;
			var days = data && data.days || {};
			var src = data && data.source || null;
			var pageRef = React.useRef(null);
			React.useEffect(function() {
				var el = pageRef.current;
				if (!el || typeof document === "undefined") return;
				var raf = 0;
				var timer = 0;
				function onScroll(ev) {
					var t = ev.target;
					if (t !== el && !(el.contains && el.contains(t))) return;
					if (raf) return;
					raf = requestAnimationFrame(function() {
						raf = 0;
						el.classList.add("uh-scrolling");
						clearTimeout(timer);
						timer = setTimeout(function() {
							try {
								el.classList.remove("uh-scrolling");
							} catch (e) {}
						}, 900);
					});
				}
				document.addEventListener("scroll", onScroll, true);
				return function() {
					document.removeEventListener("scroll", onScroll, true);
					if (raf) cancelAnimationFrame(raf);
					clearTimeout(timer);
				};
			}, []);
			function pageRoot(kids) {
				return h("div", {
					className: "uh-page",
					ref: pageRef
				}, kids);
			}
			var headerSum = "—";
			if (m) headerSum = "今日 " + fmtTokens(m.todayTokens) + " · 本周 " + fmtTokens(m.weekTokens) + " · 本月 " + fmtTokens(m.monthTokens) + " · 更新于 " + fmtAgo(data.updatedAt);
			else if (s.loading) headerSum = "加载中…";
			var kids = [h("div", {
				className: "uh-header",
				key: "header"
			}, h("div", { className: "uh-brand" }, h("strong", { className: "uh-brandName" }, SECTION_LABEL), h("p", { className: "uh-brandDesc" }, "本地 DSH 会话日志聚合 · 累计 Token、活跃热力图与活动洞察")), h("div", { className: "uh-headerRight" }, h("span", { className: "uh-sum" }, headerSum), h(Btn, {
				kind: "primary",
				disabled: s.loading,
				onClick: function() {
					s.load(true);
				}
			}, s.loading ? "刷新中…" : "刷新")))];
			if (s.err) kids.push(h("div", {
				className: "uh-note",
				"data-tone": "warn",
				key: "err"
			}, "加载失败：" + s.err));
			if (s.loading && !data) {
				kids.push(h("div", {
					className: "uh-empty",
					key: "loading"
				}, "加载中…（首次需全量扫描会话日志）"));
				return pageRoot(kids);
			}
			if (m) {
				var peakSub = m.peakDay ? fmtMD(m.peakDay.day) + " · 占累计 " + pct(m.peakDay.tokens, m.totalTokens) : "暂无";
				var longestSub = m.longestSession && m.longestSession.ms > 0 ? (m.longestSession.title || shortCwd(m.longestSession.cwd) || "会话") + " · 共 " + m.sessions + " 个会话" : "共 " + m.sessions + " 个会话";
				kids.push(h("div", {
					className: "uh-cards",
					key: "cards"
				}, h(MetricCard, {
					label: "累计 Token",
					icon: "Σ",
					value: fmtTokens(m.totalTokens),
					title: fmtExact(m.totalTokens) + " tokens",
					sub: h("span", null, "输入 ", h("b", null, fmtTokens(m.uncachedInputTokens)), " · 输出 ", h("b", null, fmtTokens(m.outputTokens)), " · 缓存读 ", h("b", null, fmtTokens(m.cacheReadTokens))),
					subTitle: "未缓存输入 / 输出 / 缓存读取"
				}), h(MetricCard, {
					label: "今日用量",
					icon: "☀",
					value: fmtTokens(m.todayTokens),
					title: fmtExact(m.todayTokens) + " tokens",
					sub: "本周 " + fmtTokens(m.weekTokens) + " · 本月 " + fmtTokens(m.monthTokens),
					subTitle: "今日自 0 点起 · " + fmtExact(m.todayTokens) + " tokens；本周 / 本月为滚动窗口与自然月口径"
				}), h(MetricCard, {
					label: "昨日用量",
					icon: "☾",
					value: fmtTokens(m.yesterdayTokens),
					title: fmtExact(m.yesterdayTokens) + " tokens",
					sub: "占累计 " + pct(m.yesterdayTokens, m.totalTokens) + " · 日均 " + fmtTokens(m.avgPerActiveDay),
					subTitle: "昨日全天 · " + fmtExact(m.yesterdayTokens) + " tokens；日均 = 累计 ÷ 活跃天数"
				}), h(MetricCard, {
					label: "峰值日",
					icon: "▲",
					value: m.peakDay ? fmtTokens(m.peakDay.tokens) : "—",
					title: m.peakDay ? fmtExact(m.peakDay.tokens) + " tokens" : "",
					sub: peakSub
				}), h(MetricCard, {
					label: "最长会话",
					icon: "⧗",
					value: m.longestSession && m.longestSession.ms > 0 ? fmtDur(m.longestSession.ms) : "—",
					sub: longestSub
				}), h(MetricCard, {
					label: "连续活跃",
					icon: "◆",
					value: m.currentStreak + " 天",
					sub: "历史最长 " + m.longestStreak + " 天"
				}), h(MetricCard, {
					label: "活跃天数",
					icon: "▦",
					value: m.activeDays + " 天",
					sub: m.firstDay ? "日均 " + fmtTokens(m.avgPerActiveDay) + " · 自 " + fmtMD(m.firstDay) : "暂无数据"
				}), h(MetricCard, {
					label: "会话",
					icon: "▤",
					value: String(m.sessions + (m.deletedSessions || 0)),
					sub: "主 " + (m.mainSessions || 0) + " · 子代理 " + (m.subagentSessions || 0) + (m.deletedSessions ? " · 已删归档 " + m.deletedSessions : "") + (src && src.orphans ? " · 孤儿投影 " + src.orphans : ""),
					subTitle: "统计口径：主会话与子代理 = 活跃日志 + 已删归档 + 孤儿投影的分类合计；已删归档 = 日志已删除但历史 token 仍保留；孤儿投影 = 日志没了只剩投影缓存。全部计入累计与热力图。"
				}), h(MetricCard, {
					label: "子代理 Token",
					icon: "⬡",
					value: fmtTokens(m.subagentTokens || 0),
					title: fmtExact(m.subagentTokens || 0) + " tokens",
					sub: (m.subagentSessions || 0) + " 个子代理会话 · 占累计 " + pct(m.subagentTokens || 0, m.totalTokens)
				})));
				kids.push(h(HeatmapCard, {
					key: "heat",
					days,
					metrics: m
				}));
				var insights = buildInsights(days, m);
				if (insights.length) kids.push(h("div", {
					className: "uh-card uh-section",
					key: "insights"
				}, h("div", { className: "uh-sectionHead" }, h("div", null, h("h4", { className: "uh-sectionTitle" }, "活动洞察"), h("p", { className: "uh-sectionDesc" }, "基于本地聚合数据自动生成"))), h("div", { className: "uh-insights" }, insights.map(function(it) {
					return h("div", {
						className: "uh-insight",
						"data-k": it.k,
						key: it.k
					}, h("span", { className: "uh-insDot" }), it.text);
				}))));
				if (src) kids.push(h("div", {
					className: "uh-note",
					key: "src"
				}, "数据源：" + src.logs + " 个会话日志（重扫 " + src.decoded + " · 命中缓存 " + src.cacheHits + "） + " + src.orphans + " 个投影缓存" + (src.archived ? " + " + src.archived + " 个已删归档" : "") + " · 本地聚合 " + src.scanMs + "ms" + (src.droppedFrames > 0 ? " · ⚠ 跳过损坏帧 " + src.droppedFrames : "")));
			}
			return pageRoot(kids);
		}
		/**
		* 设置页导航图标补丁 —— 「认领自己那一行」。
		*
		* **为什么需要**（2026-09-25 查证）：
		*  ① 宿主 `ui-settings-general` 的 `navIcon(id)` 是按 id **硬编码**的图标映射，
		*     源码注释原文：`unknown ids fall back to the settings gear`；
		*  ② `settings.section` 槽位契约（client-runner 的 `registerOptions`）只有
		*     `id` / `order` / `label`，**没有 icon 字段** ⇒ 第三方分区一律戴齿轮；
		*  ③ 借用已发布的 id（account / models / agent-presets / plugins / archived-sessions）
		*     会按契约「reusing a shipped id puts you in THAT cell and replaces it」**顶替官方分区**，不可行。
		*
		* ⇒ 做法与生态既有插件一致（dshmarket 的 settings-nav-icon、dsh-better-sidebar、
		*   dsh-skill-mcp-panel 都这么解决；dshmarket 源码注释亦点名了后两者）：
		*   按**本插件自己的 label 文本**认领那一行 → 打标记 → 用独立样式表把外壳的齿轮换成自己的图标。
		*   React 不会移除它不认识的属性 ⇒ 标记一旦打上即保持；locale 变化时外壳重渲染 label 文本，
		*   observer 会重新认领，标记与文字不会脱节。
		*
		* 边界（刻意收窄）：
		*  - 只标记「可见文本 === 本插件 label」的那一行；不碰任何外壳结构；
		*  - 标记与样式表同属一个 effect ⇒ 随 fiber 一并清除；
		*  - 宿主 DOM 结构若变化，补丁**静默失效**，不影响面板本体。
		* 删除条件：`settings.section` 将来长出 `icon` 字段时，整个模块即可移除。
		*
		* 图标以 CSS `mask-image` 呈现（纯黑，mask 只读 alpha），可见色由
		* `background-color: currentColor` 提供 ⇒ 自动跟随 hover / active / 禁用的主题色。
		* 用 mask 而非替换 DOM，是为了不跟 React 的 children 协调打架（重渲染会还原 svg 子节点）。
		*/
		var NAV_ICON_MARKER = "data-uh-nav-icon";
		/** 设置页导航行：外壳把每个 settings.section 条目渲染成面板 <nav> 内的一个 <button>。 */
		var NAV_ROW_SELECTOR = "[role=\"dialog\"] nav button";
		/** 被标记那一行的样式：藏掉外壳回落的齿轮，画出本插件的热力图图标。 */
		function navIconCss() {
			return [
				"[" + NAV_ICON_MARKER + "] > svg { display: none; }",
				"[" + NAV_ICON_MARKER + "]::before {",
				"  content: '';",
				"  flex: none;",
				"  width: 16px;",
				"  height: 16px;",
				"  background-color: currentColor;",
				"  -webkit-mask-image: " + NAV_ICON_MASK + ";",
				"  mask-image: " + NAV_ICON_MASK + ";",
				"  -webkit-mask-repeat: no-repeat;",
				"  mask-repeat: no-repeat;",
				"  -webkit-mask-position: center;",
				"  mask-position: center;",
				"  -webkit-mask-size: 16px 16px;",
				"  mask-size: 16px 16px;",
				"}"
			].join("\n");
		}
		/**
		* 安装导航图标补丁，返回清理函数。
		*
		* 样式表**独立注入**（不复用面板的 ensureCss）——面板样式只在面板渲染时才注入，
		* 而设置页导航在打开面板**之前**就要显示图标，时序对不上。
		*/
		function installSettingsNavIcon() {
			if (typeof document === "undefined" || !document.body) return function() {};
			var tag = document.createElement("style");
			tag.id = "uh-usage-heatmap-nav-icon-style";
			tag.textContent = navIconCss();
			document.head.appendChild(tag);
			var disposed = false;
			var scheduled = false;
			function sync() {
				scheduled = false;
				if (disposed) return;
				var wanted = String(SECTION_LABEL || "").trim();
				if (!wanted) return;
				var rows = document.querySelectorAll(NAV_ROW_SELECTOR);
				for (var i = 0; i < rows.length; i++) {
					var row = rows[i];
					if (String(row.textContent || "").trim() === wanted) row.setAttribute(NAV_ICON_MARKER, "");
					else row.removeAttribute(NAV_ICON_MARKER);
				}
			}
			function schedule() {
				if (scheduled || disposed) return;
				scheduled = true;
				(typeof queueMicrotask === "function" ? queueMicrotask : function(f) {
					setTimeout(f, 0);
				})(sync);
			}
			sync();
			var observer = null;
			try {
				observer = new MutationObserver(schedule);
				observer.observe(document.body, {
					childList: true,
					subtree: true,
					characterData: true
				});
			} catch {}
			return function() {
				disposed = true;
				try {
					if (observer) observer.disconnect();
				} catch {}
				var marked = document.querySelectorAll("[" + NAV_ICON_MARKER + "]");
				for (var i = 0; i < marked.length; i++) try {
					marked[i].removeAttribute(NAV_ICON_MARKER);
				} catch {}
				try {
					tag.remove();
				} catch {}
			};
		}
		function registerAll(ctx) {
			var slots = ctx.slots;
			var disposers = [];
			disposers.push(slots.inject("settings.section", function() {
				return slots.register({
					name: "settings.section",
					id: "usage-heatmap-settings",
					order: 22,
					label: function() {
						return SECTION_LABEL;
					}
				}, UsageHeatmapPanel);
			}));
			disposers.push(installSettingsNavIcon());
			return function() {
				for (var i = 0; i < disposers.length; i++) try {
					disposers[i]();
				} catch {}
			};
		}
		const name = PLUGIN_ID;
		const inject = ["slots"];
		function apply(ctx) {
			if (ctx.effect) ctx.effect(function() {
				return registerAll(ctx);
			}, PLUGIN_ID + ": usage heatmap settings section");
			else registerAll(ctx);
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map