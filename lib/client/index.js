var React = require('react');
var h = React.createElement;
var PLUGIN_ID = '@dsh-external/dsh-usage-heatmap';
var API = '/@dsh-external/dsh-usage-heatmap/api';
// ---------------------------------------------------------------------------
// 样式
// ---------------------------------------------------------------------------
var CSS = [
    /* 页面骨架 */
    /* 页面根 = 自滚动容器（复刻 dsh-hy-proxy 实测满帧配方，2026-09-22 CDP 帧时间验证）：
       will-change:scroll-position → 行为走合成器线程，实测 21ms→6.05ms、超标帧 56/60→0/60。
       ★ 勿加 scrollbar-width/scrollbar-color：非 auto 会让全部 ::-webkit-scrollbar* 规则失效。
       ★ 勿加 contain:layout paint：实测 23.95ms/57-of-60 反而更差。 */
    '.uh-page{display:flex;flex-direction:column;color:var(--dsw-alias-label-primary,#1f2329);box-sizing:border-box;touch-action:pan-y;max-height:calc(100vh - 150px);overflow-y:auto;overflow-x:hidden;overscroll-behavior:auto;scrollbar-gutter:stable;-webkit-overflow-scrolling:touch;will-change:scroll-position}',
    '.uh-page::-webkit-scrollbar{width:6px}',
    '.uh-page::-webkit-scrollbar-track{background:transparent;margin:16px 0}',
    '.uh-page::-webkit-scrollbar-thumb{background:transparent;border-radius:99px}',
    '.uh-page.uh-scrolling::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2,rgba(0,0,0,.18))}',
    '.uh-header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:2px 0 14px;border-bottom:1px solid var(--dsw-alias-border-default,#e5e5e5);flex-wrap:wrap}',
    '.uh-brand{display:flex;flex-direction:column;min-width:0}',
    '.uh-brandName{font-size:17px;font-weight:600;line-height:24px;color:var(--dsw-alias-label-primary,#1a1a1a)}',
    '.uh-brandDesc{margin:2px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#555)}',
    '.uh-headerRight{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
    '.uh-sum{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#646a73);font-variant-numeric:tabular-nums}',
    /* 卡片：扁平清爽，且不做任何 hover 反馈——大卡片 hover 切换会让整卡子树重绘，滚动时是掉帧源 */
    '.uh-card{position:relative;border:1px solid var(--dsw-alias-border-l2,#f0f1f3);border-radius:10px;padding:12px 14px;background:var(--dsw-alias-bg-layer-3,#fff);box-shadow:0 1px 2px rgb(31 35 41 / 2%)}',
    /* 指标卡片行 */
    '.uh-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(164px,1fr));gap:10px;margin:14px 0}',
    '.uh-metricLabel{display:flex;align-items:center;gap:7px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#646a73)}',
    '.uh-metricIcon{display:inline-grid;place-items:center;width:15px;height:15px;border-radius:4px;font-size:10px;line-height:1;flex:none;color:#1677ff;background:rgb(22 119 255 / 9%)}',
    '.uh-metricValue{margin-top:7px;font-size:20px;font-weight:650;line-height:26px;letter-spacing:-.01em;color:var(--dsw-alias-label-primary,#1f2329);font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.uh-metricSub{margin-top:4px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8f959e);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.uh-metricSub b{font-weight:600;color:var(--dsw-alias-label-secondary,#646a73)}',
    /* 热力图卡片 */
    '.uh-section{margin-bottom:14px}',
    '.uh-sectionHead{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px}',
    '.uh-sectionTitle{margin:0;font-size:14px;line-height:20px;font-weight:640;color:var(--dsw-alias-label-primary,#1f2329)}',
    '.uh-sectionDesc{margin:2px 0 0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#8f959e)}',
    '.uh-tools{display:flex;align-items:center;gap:12px;flex-wrap:wrap}',
    /* 分段切换（日 / 周 / 累计） */
    '.uh-seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l2,#dfe1e5);border-radius:9px;overflow:hidden;background:var(--dsw-alias-bg-layer-2,#f4f5f7)}',
    '.uh-segBtn{padding:4px 13px;font-size:12px;line-height:18px;border:0;background:transparent;cursor:pointer;color:var(--dsw-alias-label-secondary,#646a73);transition:background .15s ease,color .15s ease}',
    '.uh-segBtn + .uh-segBtn{border-left:1px solid var(--dsw-alias-border-l2,#dfe1e5)}',
    '.uh-segBtn:hover{color:var(--dsw-alias-label-primary,#1f2329);background:rgb(0 0 0 / 4%)}',
    '.uh-segBtn[aria-pressed="true"]{background:#1677ff;color:#fff}',
    '.uh-segBtn:focus-visible{outline:2px solid color-mix(in srgb,#1677ff 55%,transparent);outline-offset:-2px}',
    /* 图例 */
    '.uh-legend{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--dsw-alias-label-tertiary,#8f959e)}',
    '.uh-legendSw{width:11px;height:11px;border-radius:2px;background:var(--uh-l0)}',
    /* 日历热力网格（GitHub 风格）：列宽自适应铺满容器，正常情况下无需滚动（无滚动条）；
       极窄容器才横向溢出，此时浏览器按默认行为显示滚动条（overflow-x:auto 只在溢出时出现） */
    '.uh-calWrap{overflow-x:auto;padding:2px 0 6px}',
    '.uh-cal{display:flex;gap:6px;align-items:stretch;width:100%}',
    /* 行标：与格子同网格结构（7 行 1fr + 同 gap，容器高度=格子高度-17px 由月份行撑出）→ 行行对齐 */
    '.uh-wdLabels{display:grid;grid-template-rows:repeat(7,1fr);gap:3px;height:calc(100% - 17px);margin-top:17px;width:16px;flex:none;font-size:9px;color:var(--dsw-alias-label-tertiary,#8f959e);text-align:right}',
    '.uh-wdLabels > span{display:flex;align-items:center;justify-content:flex-end}',
    '.uh-main{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0}',
    '.uh-months{display:grid;grid-template-columns:repeat(var(--uh-cols),minmax(11px,1fr));gap:3px;height:13px;width:100%;font-size:10px;line-height:13px;color:var(--dsw-alias-label-tertiary,#8f959e);font-variant-numeric:tabular-nums}',
    '.uh-months > span{white-space:nowrap}',
    /* 格子区独立合成层：滚动时整块贴图平移，不逐帧重栅格化几百个圆角色块（勿加 contain，见 .uh-page 注释） */
    '.uh-cells{display:grid;grid-auto-flow:column;grid-template-columns:repeat(var(--uh-cols),minmax(11px,1fr));grid-template-rows:repeat(7,auto);gap:3px;width:100%;transform:translateZ(0)}',
    '.uh-weekCells{display:grid;grid-template-columns:repeat(var(--uh-cols),minmax(13px,1fr));gap:3px;width:100%;transform:translateZ(0)}',
    '.uh-cell{aspect-ratio:1;border-radius:2px;background:var(--uh-l0);cursor:pointer}',
    '.uh-cell:hover{outline:2px solid rgb(31 35 41 / 45%);outline-offset:0}',
    '.uh-cell[data-future="1"]{visibility:hidden;pointer-events:none}',
    '.uh-cell[data-l="0"]{background:var(--uh-l0)}',
    '.uh-cell[data-l="1"]{background:var(--uh-l1)}',
    '.uh-cell[data-l="2"]{background:var(--uh-l2)}',
    '.uh-cell[data-l="3"]{background:var(--uh-l3)}',
    '.uh-cell[data-l="4"]{background:var(--uh-l4)}',
    /* 调色板：蓝色系（少→多），无绿色 */
    ':root{--uh-l0:#eef1f5;--uh-l1:#bfd8ff;--uh-l2:#7fadff;--uh-l3:#3d8bfd;--uh-l4:#0f56c9}',
    /* tooltip */
    '.uh-tip{position:fixed;z-index:10000;transform:translate(-50%,calc(-100% - 12px));background:#1f2329;color:#fff;padding:7px 10px;border-radius:9px;font-size:12px;line-height:18px;pointer-events:none;white-space:nowrap;box-shadow:0 4px 12px rgb(0 0 0 / 18%);font-variant-numeric:tabular-nums}',
    '.uh-tip b{font-weight:650}',
    '.uh-tip em{font-style:normal;color:rgb(255 255 255 / 65%);font-size:11px}',
    /* 洞察列表 */
    '.uh-insights{display:grid;gap:9px}',
    '.uh-insight{display:flex;gap:9px;align-items:flex-start;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,#1f2329)}',
    '.uh-insDot{flex:none;width:7px;height:7px;border-radius:50%;background:#1677ff;margin-top:6px}',
    '.uh-insight[data-k="peak"] .uh-insDot{background:#f59e0b}',
    '.uh-insight[data-k="streak"] .uh-insDot{background:#f97316}',
    '.uh-insight[data-k="cache"] .uh-insDot{background:#7b5cff}',
    '.uh-insight[data-k="week"] .uh-insDot{background:#1677ff}',
    '.uh-insight[data-k="scope"] .uh-insDot{background:#94a3b8}',
    '.uh-insight[data-k="rhythm"] .uh-insDot{background:#ec4899}',
    '.uh-insight[data-k="subagent"] .uh-insDot{background:#0ea5e9}',
    '.uh-insight[data-k="deleted"] .uh-insDot{background:#f43f5e}',
    '.uh-insight em{font-style:normal;color:var(--dsw-alias-label-secondary,#646a73);font-size:12px}',
    /* 按钮 / 提示 / 空态 */
    '.uh-btn{font-size:12px;line-height:18px;padding:4px 12px;border:1px solid var(--dsw-alias-border-l2,#dfe1e5);border-radius:8px;background:var(--dsw-alias-bg-layer-3,#fff);cursor:pointer;color:var(--dsw-alias-label-primary,#1f2329);white-space:nowrap;transition:border-color .15s ease,background .15s ease,color .15s ease}',
    '.uh-btn:hover:not(:disabled){border-color:color-mix(in srgb,#1677ff 40%,var(--dsw-alias-border-l2,#dfe1e5));color:#1677ff;background:color-mix(in srgb,#1677ff 6%,var(--dsw-alias-bg-layer-3,#fff))}',
    '.uh-btn[data-kind="primary"]{background:#1677ff;color:#fff;border-color:#1677ff}',
    '.uh-btn[data-kind="primary"]:hover:not(:disabled){background:#0f5fce;border-color:#0f5fce;color:#fff}',
    '.uh-btn:disabled{opacity:.5;cursor:default}',
    '.uh-note{margin-top:2px;padding:9px 11px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2,#eef0f3);background:var(--dsw-alias-bg-layer-2,#f7f8fa);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#646a73)}',
    '.uh-note[data-tone="warn"]{border-color:color-mix(in srgb,#e37400 35%,var(--dsw-alias-border-l2,#eef0f3));background:rgb(227 116 0 / 8%);color:#b45309}',
    '.uh-empty{padding:26px 8px;text-align:center;font-size:13px;color:var(--dsw-alias-label-tertiary,#8f959e)}',
].join('\n');
function ensureCss() {
    if (typeof document === 'undefined')
        return;
    if (document.getElementById('uh-usage-heatmap-style'))
        return;
    var tag = document.createElement('style');
    tag.id = 'uh-usage-heatmap-style';
    tag.textContent = CSS;
    document.head.appendChild(tag);
}
// ---------------------------------------------------------------------------
// 数据获取（SWR：10s 内命中缓存；进页后自动 fresh=1 刷新 + 手动刷新按钮绕过 host 缓存）
// ---------------------------------------------------------------------------
var _cache = { at: 0, raw: null, data: null, promise: null };
var SWR_TTL_MS = 10000; // 客户端 SWR：10s 内命中本地缓存
var POLL_MS = 60000; // 面板打开期间的后台轮询间隔
function fetchState(force) {
    var now = Date.now();
    if (!force && _cache.data && now - _cache.at < SWR_TTL_MS)
        return Promise.resolve(_cache.data);
    if (_cache.promise)
        return _cache.promise;
    var url = API + '/state' + (force ? '?fresh=1' : '');
    _cache.promise = fetch(url, { cache: 'no-store' })
        .then(function (r) {
        // 必须校验 r.ok：宿主 500 也返回 JSON，直接 r.json() 会把 {error} 当状态渲染成静默空面板
        return r.json().then(function (s) {
            if (!r.ok)
                throw new Error((s && s.error) || 'HTTP ' + r.status);
            return s;
        }, function () {
            throw new Error('HTTP ' + r.status);
        });
    })
        .then(function (s) {
        _cache.promise = null;
        // 内容没变 → 复用旧对象引用，setData 时 React bail out，避免每分钟整棵重渲染造成滑动顿挫
        var raw = JSON.stringify(s);
        if (raw === _cache.raw)
            return _cache.data || s;
        _cache.raw = raw;
        _cache.data = s;
        _cache.at = Date.now();
        return s;
    })
        .catch(function (e) {
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
    var _e = useState('');
    var err = _e[0];
    var setErr = _e[1];
    function load(force) {
        if (!data)
            setLoading(true);
        setErr('');
        return fetchState(force)
            .then(function (s) {
            setData(function (prev) { return s === prev ? prev : s; });
            setLoading(false);
        })
            .catch(function (e) {
            setErr(String((e && e.message) || e));
            setLoading(false);
        });
    }
    useEffect(function () {
        ensureCss();
        // 进设置页即自动刷新：先用快照/缓存把旧数据秒开渲染出来，随后立刻补一次
        // fresh=1 增量扫描（宿主等扫完才回包），回包后静默覆盖旧数据——无需手动点刷新。
        // load() 内部已 catch（永远 resolve）→ 链上无 rejection，无需外层 catch
        load(false).then(function () { return load(true); });
        var timer = setInterval(function () { load(false); }, POLL_MS);
        return function () { clearInterval(timer); };
    }, []);
    return { data: data, loading: loading, err: err, load: load };
}
// ---------------------------------------------------------------------------
// 格式化与日期工具
// ---------------------------------------------------------------------------
function fmtTokens(n) {
    if (!isFinite(n) || n <= 0)
        return '0';
    if (n >= 1e8)
        return (n / 1e8).toFixed(2).replace(/\.?0+$/, '') + '亿';
    if (n >= 1e4)
        return (n / 1e4).toFixed(1).replace(/\.0$/, '') + '万';
    return String(Math.round(n));
}
function fmtExact(n) {
    return Math.round(n).toLocaleString('en-US');
}
function fmtDur(ms) {
    if (ms <= 0)
        return '—';
    var min = Math.floor(ms / 60000);
    if (min >= 1440)
        return Math.floor(min / 1440) + '天' + Math.floor((min % 1440) / 60) + '小时';
    if (min >= 60)
        return Math.floor(min / 60) + '小时' + (min % 60) + '分';
    return min + '分';
}
function fmtAgo(ts) {
    if (!ts || ts <= 0)
        return '—';
    var diff = Date.now() - ts;
    if (diff < 60000)
        return '刚刚';
    if (diff < 3600000)
        return Math.round(diff / 60000) + ' 分钟前';
    if (diff < 86400000)
        return Math.round(diff / 3600000) + ' 小时前';
    return fmtMD(new Date(ts).getFullYear() + '-' + pad2(new Date(ts).getMonth() + 1) + '-' + pad2(new Date(ts).getDate()));
}
function pad2(n) {
    return n < 10 ? '0' + n : String(n);
}
var WD = ['一', '二', '三', '四', '五', '六', '日'];
function parseKey(key) {
    var p = key.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}
function keyOf(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
/** 'M月D日' */
function fmtMD(key) {
    var d = parseKey(key);
    return d.getMonth() + 1 + '月' + d.getDate() + '日';
}
/** 'M月D日（周X）' */
function fmtMDWd(key) {
    var d = parseKey(key);
    return fmtMD(key) + '（周' + WD[(d.getDay() + 6) % 7] + '）';
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
    return keyOf(new Date());
}
function daysBetween(a, b) {
    return Math.round((parseKey(b).getTime() - parseKey(a).getTime()) / 86400000);
}
function pct(part, whole) {
    if (whole <= 0)
        return '0%';
    return Math.round((part / whole) * 100) + '%';
}
// ---------------------------------------------------------------------------
// 指标卡片
// ---------------------------------------------------------------------------
function MetricCard(props) {
    return h('div', { className: 'uh-card', key: props.label }, h('div', { className: 'uh-metricLabel' }, h('span', { className: 'uh-metricIcon' }, props.icon || '●'), props.label), h('div', { className: 'uh-metricValue', title: props.title || '' }, props.value), props.sub ? h('div', { className: 'uh-metricSub', title: props.subTitle || '' }, props.sub) : null);
}
/** 容器实测宽度 → 列数的常量与换算（列宽 = 11px 格 + 3px gap = 14px 步进） */
var COLS_MIN = 10;
var COLS_MAX = 54;
var COL_STRIDE = 14;
var COL_PAD = 19;
var COLS_DEFAULT = 37; // 尚未测量到宽度时的回退列数
function calcCols(wrapW) {
    return wrapW > 40 ? Math.max(COLS_MIN, Math.min(COLS_MAX, Math.floor((wrapW - COL_PAD) / COL_STRIDE))) : COLS_DEFAULT;
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
    return { columns: columns };
}
/** 分位分档（GitHub 算法）：values 升序 → v 的档位 1..4 */
function makeLevelFn(values) {
    var sorted = values.filter(function (v) { return v > 0; }).sort(function (a, b) { return a - b; });
    if (!sorted.length)
        return function () { return 0; };
    return function (v) {
        if (v <= 0)
            return 0;
        var le = 0;
        for (var i = 0; i < sorted.length; i++)
            if (sorted[i] <= v)
                le++;
        return Math.min(4, Math.ceil((le / sorted.length) * 4));
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
    return function (key) {
        // 二分：最后一个 ≤ key 的下标
        var lo = 0;
        var hi = keys.length - 1;
        var ans = -1;
        while (lo <= hi) {
            var mid = (lo + hi) >> 1;
            if (keys[mid] <= key) {
                ans = mid;
                lo = mid + 1;
            }
            else
                hi = mid - 1;
        }
        return ans < 0 ? 0 : prefix[ans];
    };
}
function weekValue(days, monday) {
    var sum = 0;
    for (var i = 0; i < 7; i++)
        sum += days[addDays(monday, i)] || 0;
    return sum;
}
function weekActiveDays(days, monday) {
    var n = 0;
    for (var i = 0; i < 7; i++)
        if ((days[addDays(monday, i)] || 0) > 0)
            n++;
    return n;
}
function monthLabels(columns) {
    var out = [];
    var prev = -1;
    for (var i = 0; i < columns.length; i++) {
        var m = parseKey(columns[i]).getMonth();
        out.push(i === 0 || m !== prev ? m + 1 + '月' : '');
        prev = m;
    }
    return out;
}
function HeatmapCard(props) {
    var days = props.days || {};
    var m = props.metrics || {};
    var _mode = React.useState('day');
    var mode = _mode[0];
    var setMode = _mode[1];
    // tooltip：脱离 React 渲染，直接操作 DOM——悬停/移动零重渲染（300+ 格子不再跟着鼠标move重画）
    var tipElRef = React.useRef(null);
    React.useEffect(function () {
        return function () {
            var el = tipElRef.current;
            if (el && el.parentNode)
                el.parentNode.removeChild(el);
            tipElRef.current = null;
        };
    }, []);
    function ensureTip() {
        var el = tipElRef.current;
        if (!el || !el.parentNode) {
            el = document.createElement('div');
            el.className = 'uh-tip';
            el.style.display = 'none';
            document.body.appendChild(el);
            tipElRef.current = el;
        }
        return el;
    }
    function escapeHtml(s) {
        var map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
        return String(s).replace(/[&<>"]/g, function (c) { return map[c] || c; });
    }
    var tipRaf = 0;
    var tipEv = null;
    function placeTip() {
        tipRaf = 0;
        var el = tipElRef.current;
        if (el && tipEv) {
            el.style.left = tipEv.clientX + 'px';
            el.style.top = tipEv.clientY + 'px';
        }
    }
    function showTip(ev, lines) {
        var el = ensureTip();
        el.innerHTML =
            '<div><b>' + escapeHtml(String(lines[0] ?? '')) + '</b></div>' +
                (lines[1] != null ? '<div>' + escapeHtml(String(lines[1])) + '</div>' : '') +
                (lines[2] != null ? '<em>' + escapeHtml(String(lines[2])) + '</em>' : '');
        el.style.display = 'block';
        tipEv = ev;
        if (!tipRaf)
            tipRaf = requestAnimationFrame(placeTip);
    }
    function moveTip(ev) {
        if (!tipElRef.current)
            return;
        tipEv = ev;
        if (!tipRaf)
            tipRaf = requestAnimationFrame(placeTip);
    }
    function hideTip() {
        var el = tipElRef.current;
        if (el)
            el.style.display = 'none';
    }
    var hasData = !!(m.firstDay && Object.keys(days).length);
    // 容器实测宽度 → 列数（calcCols：每格 ≥11px 的小正方形，铺满且不滚动）
    var wrapRef = React.useRef(null);
    var _wrapW = React.useState(0);
    var wrapW = _wrapW[0];
    var setWrapW = _wrapW[1];
    React.useLayoutEffect(function () {
        var el = wrapRef.current;
        if (!el)
            return;
        var measure = function () { setWrapW(el.clientWidth); };
        measure();
        var ro = null;
        if (typeof ResizeObserver !== 'undefined') {
            ro = new ResizeObserver(measure);
            ro.observe(el);
        }
        return function () { if (ro)
            ro.disconnect(); };
    }, [hasData, mode]);
    var cols = calcCols(wrapW);
    var range = React.useMemo(function () { return buildRange(cols); }, [cols]);
    var cumAt = React.useMemo(function () { return makeCumulative(days); }, [JSON.stringify(days)]);
    var months = monthLabels(range.columns);
    var total = m.totalTokens || 0;
    var isWeek = mode === 'week';
    var isCum = mode === 'cum';
    // 当前模式的取值集合 → 分位档
    var levelFn = React.useMemo(function () {
        if (isWeek) {
            return makeLevelFn(range.columns.map(function (mon) { return weekValue(days, mon); }));
        }
        if (isCum) {
            var top = cumAt(todayKey());
            return function (v) {
                if (v <= 0 || top <= 0)
                    return 0;
                return Math.min(4, Math.ceil((v / top) * 4));
            };
        }
        return makeLevelFn(Object.keys(days).map(function (k) { return days[k]; }));
    }, [mode, JSON.stringify(days), JSON.stringify(range.columns)]);
    var modes = [
        { id: 'day', label: '每日' },
        { id: 'week', label: '每周' },
        { id: 'cum', label: '累计' },
    ];
    var seg = h('div', { className: 'uh-seg', role: 'group', 'aria-label': '热力图粒度' }, modes.map(function (it) {
        return h('button', {
            key: it.id,
            type: 'button',
            className: 'uh-segBtn',
            'aria-pressed': String(mode === it.id),
            onClick: function () { setMode(it.id); },
        }, it.label);
    }));
    var legend = h('div', { className: 'uh-legend' }, h('span', null, '少'), [0, 1, 2, 3, 4].map(function (l) {
        return h('span', { key: l, className: 'uh-legendSw', 'data-l': String(l), style: { background: 'var(--uh-l' + l + ')' } });
    }), h('span', null, '多'));
    var body;
    if (!hasData) {
        body = h('div', { className: 'uh-empty' }, '暂无用量数据——使用 DSH 后热力图会按天聚合本地会话日志');
    }
    else if (isWeek) {
        // 周视图：一格一周（单行；最左=本周，向右越来越早）
        var weekCells = range.columns.map(function (mon, i) {
            var v = weekValue(days, mon);
            var end = addDays(mon, 6);
            var act = weekActiveDays(days, mon);
            var future = mon > todayKey();
            return h('div', {
                key: mon,
                className: 'uh-cell',
                'data-l': String(future ? 0 : levelFn(v)),
                'data-future': future ? '1' : '0',
                onMouseEnter: function (ev) {
                    showTip(ev, [
                        fmtMD(mon) + ' – ' + fmtMD(end),
                        fmtTokens(v) + ' tokens',
                        '活跃 ' + act + ' 天 · 占累计 ' + pct(v, total),
                    ]);
                },
                onMouseMove: moveTip,
                onMouseLeave: function () { hideTip(); },
            });
        });
        body = h('div', { className: 'uh-calWrap', ref: wrapRef }, h('div', { className: 'uh-cal' }, h('div', { className: 'uh-main' }, h('div', { className: 'uh-months', style: { '--uh-cols': range.columns.length } }, months.map(function (mm, i) { return h('span', { key: i }, mm); })), h('div', { className: 'uh-weekCells', style: { '--uh-cols': range.columns.length } }, weekCells))));
    }
    else {
        // 日视图 / 累计视图：GitHub 日历（7 行 = 周一..周日，列为周；列序倒序：最左=本周）
        var today = todayKey();
        var dayCells = [];
        for (var c = 0; c < range.columns.length; c++) {
            for (var r = 0; r < 7; r++) {
                var key = addDays(range.columns[c], r);
                var future = key > today;
                var dayV = days[key] || 0;
                var v = future ? 0 : isCum ? cumAt(key) : dayV;
                (function (key, dayV, v, future) {
                    dayCells.push(h('div', {
                        key: key,
                        className: 'uh-cell',
                        'data-l': String(future ? 0 : levelFn(v)),
                        'data-future': future ? '1' : '0',
                        onMouseEnter: function (ev) {
                            if (future)
                                return;
                            var lines = isCum
                                ? [fmtMDWd(key), '累计 ' + fmtTokens(v) + ' tokens', '当日 +' + fmtTokens(dayV)]
                                : [
                                    fmtMDWd(key),
                                    fmtTokens(dayV) + ' tokens',
                                    '占累计 ' + pct(dayV, total) + ' · ' + relDay(key),
                                ];
                            showTip(ev, lines);
                        },
                        onMouseMove: moveTip,
                        onMouseLeave: function () { hideTip(); },
                    }));
                })(key, dayV, v, future);
            }
        }
        body = h('div', { className: 'uh-calWrap', ref: wrapRef }, h('div', { className: 'uh-cal' }, h('div', { className: 'uh-wdLabels' }, WD.map(function (w, i) {
            return h('span', { key: w }, i % 2 === 0 ? w : '');
        })), h('div', { className: 'uh-main' }, h('div', { className: 'uh-months', style: { '--uh-cols': range.columns.length } }, months.map(function (mm, i) { return h('span', { key: i }, mm); })), h('div', { className: 'uh-cells', style: { '--uh-cols': range.columns.length } }, dayCells))));
    }
    return h('div', { className: 'uh-card uh-section' }, h('div', { className: 'uh-sectionHead' }, h('div', null, h('h4', { className: 'uh-sectionTitle' }, 'Token 活跃热力图'), h('p', { className: 'uh-sectionDesc' }, isWeek ? '每格 = 一个自然周的累计用量' : isCum ? '每格 = 截至该日的历史累计用量' : '每格 = 当日用量（周一为一周之始）')), h('div', { className: 'uh-tools' }, legend, seg)), body);
}
/** 相对日期：今天/昨天/N天前 */
function relDay(key) {
    var diff = daysBetween(key, todayKey());
    if (diff === 0)
        return '今天';
    if (diff === 1)
        return '昨天';
    if (diff > 1 && diff < 3650)
        return diff + '天前';
    return '';
}
// ---------------------------------------------------------------------------
// 洞察列表
// ---------------------------------------------------------------------------
function buildInsights(days, m) {
    var out = [];
    if (!m)
        return out;
    // 本周 vs 上周
    if (m.weekTokens > 0 || m.prevWeekTokens > 0) {
        var text;
        if (m.prevWeekTokens > 0) {
            var delta = Math.round(((m.weekTokens - m.prevWeekTokens) / m.prevWeekTokens) * 100);
            text = '本周已用 ' + fmtTokens(m.weekTokens) + '，上周 ' + fmtTokens(m.prevWeekTokens)
                + '（' + (delta >= 0 ? '+' : '') + delta + '%）';
        }
        else {
            text = '本周已用 ' + fmtTokens(m.weekTokens) + '（上周无记录）';
        }
        out.push({ k: 'week', text: text });
    }
    // 峰值日
    if (m.peakDay) {
        out.push({
            k: 'peak',
            text: '峰值日 ' + fmtMD(m.peakDay.day) + ' · ' + fmtTokens(m.peakDay.tokens)
                + ' tokens，占累计 ' + pct(m.peakDay.tokens, m.totalTokens),
        });
    }
    // 连续活跃
    out.push({
        k: 'streak',
        text: '连续活跃 ' + m.currentStreak + ' 天，历史最长 ' + m.longestStreak + ' 天',
    });
    // 覆盖面
    var totalSessions = m.sessions + (m.deletedSessions || 0);
    var scope = '累计 ' + totalSessions + ' 个会话（主 ' + (m.mainSessions || 0) + ' · 子代理 ' + (m.subagentSessions || 0)
        + (m.deletedSessions ? ' · 已删 ' + m.deletedSessions : '') + '）· ' + m.turns + ' 轮对话 · ' + m.steps + ' 个步骤';
    if (m.longestSession && m.longestSession.ms > 0) {
        var who = m.longestSession.title || shortCwd(m.longestSession.cwd) || '';
        scope += who ? '；最长会话 ' + fmtDur(m.longestSession.ms) + '（' + who + '）' : '；最长会话 ' + fmtDur(m.longestSession.ms);
    }
    out.push({ k: 'scope', text: scope });
    // 子代理用量
    if (m.subagentSessions > 0) {
        out.push({
            k: 'subagent',
            text: '子代理会话 ' + m.subagentSessions + ' 个，消耗 ' + fmtTokens(m.subagentTokens)
                + ' tokens（占累计 ' + pct(m.subagentTokens, m.totalTokens) + '）',
        });
    }
    // 已删除会话归档
    if (m.deletedSessions > 0) {
        out.push({
            k: 'deleted',
            text: '已删除会话 ' + m.deletedSessions + ' 个已归档，保留 ' + fmtTokens(m.deletedTokens) + ' tokens 不丢失',
        });
    }
    // 缓存命中结构
    if (m.cacheReadTokens > 0) {
        out.push({
            k: 'cache',
            text: '缓存读取 ' + fmtTokens(m.cacheReadTokens) + ' tokens，占累计 ' + pct(m.cacheReadTokens, m.totalTokens)
                + '；未缓存输入 ' + fmtTokens(m.uncachedInputTokens) + ' · 输出 ' + fmtTokens(m.outputTokens),
        });
    }
    // 节律：最活跃星期
    var wk = [0, 0, 0, 0, 0, 0, 0];
    var dayKeys = Object.keys(days);
    for (var i = 0; i < dayKeys.length; i++) {
        var d = parseKey(dayKeys[i]);
        wk[(d.getDay() + 6) % 7] += days[dayKeys[i]];
    }
    var best = 0;
    var sum = 0;
    for (var j = 0; j < 7; j++) {
        sum += wk[j];
        if (wk[j] > wk[best])
            best = j;
    }
    if (sum > 0 && wk[best] > 0) {
        out.push({
            k: 'rhythm',
            text: '最活跃的是周' + WD[best] + '：贡献 ' + fmtTokens(wk[best]) + ' tokens（' + pct(wk[best], sum) + '）',
        });
    }
    return out;
}
function shortCwd(cwd) {
    if (!cwd)
        return '';
    var parts = cwd.split(/[\\/]/);
    return parts[parts.length - 1] || cwd;
}
// ---------------------------------------------------------------------------
// 根面板
// ---------------------------------------------------------------------------
function Btn(props) {
    return h('button', {
        className: 'uh-btn',
        'data-kind': props.kind,
        disabled: props.disabled,
        onClick: props.onClick,
        title: props.title || '',
    }, props.children);
}
function UsageHeatmapPanel() {
    var s = usePanelData();
    var data = s.data;
    var m = data ? data.metrics : null;
    var days = (data && data.days) || {};
    var src = (data && data.source) || null;
    // 滚动条按需显隐（hy-proxy 同款）：滚动中才给 thumb 上色；rAF 节流 + 捕获阶段
    var pageRef = React.useRef(null);
    React.useEffect(function () {
        var el = pageRef.current;
        if (!el || typeof document === 'undefined')
            return;
        var raf = 0;
        var timer = 0;
        function onScroll(ev) {
            var t = ev.target;
            if (t !== el && !(el.contains && el.contains(t)))
                return;
            if (raf)
                return;
            raf = requestAnimationFrame(function () {
                raf = 0;
                el.classList.add('uh-scrolling');
                clearTimeout(timer);
                timer = setTimeout(function () {
                    try {
                        el.classList.remove('uh-scrolling');
                    }
                    catch (e) { /* ignore */ }
                }, 900);
            });
        }
        document.addEventListener('scroll', onScroll, true);
        return function () {
            document.removeEventListener('scroll', onScroll, true);
            if (raf)
                cancelAnimationFrame(raf);
            clearTimeout(timer);
        };
    }, []);
    function pageRoot(kids) {
        return h('div', { className: 'uh-page', ref: pageRef }, kids);
    }
    var headerSum = '—';
    if (m) {
        headerSum = '今日 ' + fmtTokens(m.todayTokens) + ' · 本周 ' + fmtTokens(m.weekTokens)
            + ' · 本月 ' + fmtTokens(m.monthTokens) + ' · 更新于 ' + fmtAgo(data.updatedAt);
    }
    else if (s.loading) {
        headerSum = '加载中…';
    }
    var kids = [
        h('div', { className: 'uh-header', key: 'header' }, h('div', { className: 'uh-brand' }, h('strong', { className: 'uh-brandName' }, '模型用量统计'), h('p', { className: 'uh-brandDesc' }, '本地 DSH 会话日志聚合 · 累计 Token、活跃热力图与活动洞察')), h('div', { className: 'uh-headerRight' }, h('span', { className: 'uh-sum' }, headerSum), h(Btn, { kind: 'primary', disabled: s.loading, onClick: function () { s.load(true); } }, s.loading ? '刷新中…' : '刷新'))),
    ];
    if (s.err) {
        kids.push(h('div', { className: 'uh-note', 'data-tone': 'warn', key: 'err' }, '加载失败：' + s.err));
    }
    if (s.loading && !data) {
        kids.push(h('div', { className: 'uh-empty', key: 'loading' }, '加载中…（首次需全量扫描会话日志）'));
        return pageRoot(kids);
    }
    if (m) {
        var peakSub = m.peakDay ? fmtMD(m.peakDay.day) + ' · 占累计 ' + pct(m.peakDay.tokens, m.totalTokens) : '暂无';
        var longestSub = m.longestSession && m.longestSession.ms > 0
            ? (m.longestSession.title || shortCwd(m.longestSession.cwd) || '会话') + ' · 共 ' + m.sessions + ' 个会话'
            : '共 ' + m.sessions + ' 个会话';
        kids.push(h('div', { className: 'uh-cards', key: 'cards' }, h(MetricCard, {
            label: '累计 Token', icon: 'Σ',
            value: fmtTokens(m.totalTokens),
            title: fmtExact(m.totalTokens) + ' tokens',
            sub: h('span', null, '输入 ', h('b', null, fmtTokens(m.uncachedInputTokens)), ' · 输出 ', h('b', null, fmtTokens(m.outputTokens)), ' · 缓存读 ', h('b', null, fmtTokens(m.cacheReadTokens))),
            subTitle: '未缓存输入 / 输出 / 缓存读取',
        }), h(MetricCard, {
            label: '今日用量', icon: '☀',
            value: fmtTokens(m.todayTokens),
            title: fmtExact(m.todayTokens) + ' tokens',
            sub: '本周 ' + fmtTokens(m.weekTokens) + ' · 本月 ' + fmtTokens(m.monthTokens),
            subTitle: '今日自 0 点起 · ' + fmtExact(m.todayTokens) + ' tokens；本周 / 本月为滚动窗口与自然月口径',
        }), h(MetricCard, {
            label: '昨日用量', icon: '☾',
            value: fmtTokens(m.yesterdayTokens),
            title: fmtExact(m.yesterdayTokens) + ' tokens',
            sub: '占累计 ' + pct(m.yesterdayTokens, m.totalTokens) + ' · 日均 ' + fmtTokens(m.avgPerActiveDay),
            subTitle: '昨日全天 · ' + fmtExact(m.yesterdayTokens) + ' tokens；日均 = 累计 ÷ 活跃天数',
        }), h(MetricCard, {
            label: '峰值日', icon: '▲',
            value: m.peakDay ? fmtTokens(m.peakDay.tokens) : '—',
            title: m.peakDay ? fmtExact(m.peakDay.tokens) + ' tokens' : '',
            sub: peakSub,
        }), h(MetricCard, {
            label: '最长会话', icon: '⧗',
            value: m.longestSession && m.longestSession.ms > 0 ? fmtDur(m.longestSession.ms) : '—',
            sub: longestSub,
        }), h(MetricCard, {
            label: '连续活跃', icon: '◆',
            value: m.currentStreak + ' 天',
            sub: '历史最长 ' + m.longestStreak + ' 天',
        }), h(MetricCard, {
            label: '活跃天数', icon: '▦',
            value: m.activeDays + ' 天',
            sub: m.firstDay
                ? '日均 ' + fmtTokens(m.avgPerActiveDay) + ' · 自 ' + fmtMD(m.firstDay)
                : '暂无数据',
        }), h(MetricCard, {
            label: '会话', icon: '▤',
            value: String(m.sessions + (m.deletedSessions || 0)),
            sub: '主 ' + (m.mainSessions || 0) + ' · 子代理 ' + (m.subagentSessions || 0)
                + (m.deletedSessions ? ' · 已删归档 ' + m.deletedSessions : '')
                + (src && src.orphans ? ' · 孤儿投影 ' + src.orphans : ''),
            subTitle: '统计口径：主会话与子代理 = 活跃日志 + 已删归档 + 孤儿投影的分类合计；'
                + '已删归档 = 日志已删除但历史 token 仍保留；孤儿投影 = 日志没了只剩投影缓存。全部计入累计与热力图。',
        }), h(MetricCard, {
            label: '子代理 Token', icon: '⬡',
            value: fmtTokens(m.subagentTokens || 0),
            title: fmtExact(m.subagentTokens || 0) + ' tokens',
            sub: (m.subagentSessions || 0) + ' 个子代理会话 · 占累计 ' + pct(m.subagentTokens || 0, m.totalTokens),
        })));
        kids.push(h(HeatmapCard, { key: 'heat', days: days, metrics: m }));
        var insights = buildInsights(days, m);
        if (insights.length) {
            kids.push(h('div', { className: 'uh-card uh-section', key: 'insights' }, h('div', { className: 'uh-sectionHead' }, h('div', null, h('h4', { className: 'uh-sectionTitle' }, '活动洞察'), h('p', { className: 'uh-sectionDesc' }, '基于本地聚合数据自动生成'))), h('div', { className: 'uh-insights' }, insights.map(function (it) {
                return h('div', { className: 'uh-insight', 'data-k': it.k, key: it.k }, h('span', { className: 'uh-insDot' }), it.text);
            }))));
        }
        if (src) {
            kids.push(h('div', { className: 'uh-note', key: 'src' }, '数据源：' + src.logs + ' 个会话日志（重扫 ' + src.decoded + ' · 命中缓存 ' + src.cacheHits
                + '） + ' + src.orphans + ' 个投影缓存'
                + (src.archived ? ' + ' + src.archived + ' 个已删归档' : '')
                + ' · 本地聚合 ' + src.scanMs + 'ms'
                + (src.droppedFrames > 0 ? ' · ⚠ 跳过损坏帧 ' + src.droppedFrames : '')));
        }
    }
    return pageRoot(kids);
}
// ---------------------------------------------------------------------------
// 注册（仅设置面板分区）
// ---------------------------------------------------------------------------
function registerAll(ctx) {
    var slots = ctx.slots;
    var disposers = [];
    // 设置页分区。守卫细节（写错 ⇒ restore() 跳过恢复 ⇒ 设置项消失）：
    //   1) slot 名必须是字符串字面量（不能用变量）；
    //   2) `{` 必须紧跟 register( 同一行。
    disposers.push(slots.inject('settings.section', function () {
        return slots.register({
            name: 'settings.section',
            id: 'usage-heatmap-settings',
            order: 22,
            label: function () {
                return '模型用量统计';
            },
        }, UsageHeatmapPanel);
    }));
    return function () {
        for (var i = 0; i < disposers.length; i++) {
            try {
                disposers[i]();
            }
            catch {
                /* ignore */
            }
        }
    };
}
// ⚠️ 必须是 export const（不能用 var）：注入器骨架校验按文本匹配
// `/export const inject\s*=\s*\[[^\]]*['"]slots['"]/`
export const name = PLUGIN_ID;
export const inject = ['slots'];
export function apply(ctx) {
    if (ctx.effect) {
        ctx.effect(function () {
            return registerAll(ctx);
        }, PLUGIN_ID + ': usage heatmap settings section');
    }
    else {
        registerAll(ctx);
    }
}
//# sourceMappingURL=index.js.map