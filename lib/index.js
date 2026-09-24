import { defineTool } from '@deepseek-ai/dsh-tools';
import z from '@deepseek-ai/schemastery';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scan } from './aggregate.js';
export const name = '@dsh-external/dsh-usage-heatmap';
export const inject = ['tools', 'webServer'];
const DEFAULT_TITLE = '模型用量统计';
export const Config = z.object({
    title: z.string().default(DEFAULT_TITLE),
});
/**
 * SWR 缓存：新鲜期内直接回缓存；有旧缓存时后台刷新；无缓存只能等。
 * scan() 自身增量（只重解变更日志文件），所以轮询成本 ≈ 一次 stat 扫描。
 */
const STATE_TTL_MS = 20_000;
let _stateCache = null;
let _stateInflight = null;
/**
 * 持久化快照：每次扫描成功后把聚合结果整份落盘；宿主重启后首帧直接读快照
 * （<10ms），后台再增量扫描刷新——首开不再等全量解码。
 */
const SNAPSHOT_FILE = path.join(os.homedir(), '.dsh', 'storages', 'usage-heatmap', 'last-state.json');
function loadSnapshot(title) {
    try {
        const j = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
        if (j && j.days && j.metrics) {
            j.title = title;
            return j;
        }
    }
    catch {
        /* 无快照 / 损坏：走正常扫描 */
    }
    return null;
}
function saveSnapshot(data) {
    try {
        fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true });
        const tmp = SNAPSHOT_FILE + '.' + Math.random().toString(36).slice(2, 8) + '.tmp'; // 随机后缀防并发写互踩
        fs.writeFileSync(tmp, JSON.stringify(data));
        fs.renameSync(tmp, SNAPSHOT_FILE);
    }
    catch {
        /* 快照写失败不影响功能 */
    }
}
function payloadFrom(r, title) {
    return {
        title,
        days: r.dayTotals,
        metrics: r.metrics,
        source: r.source,
        updatedAt: r.source.updatedAt,
    };
}
async function refreshState(title) {
    if (_stateInflight)
        return _stateInflight;
    _stateInflight = (async () => {
        const r = await scan();
        const data = payloadFrom(r, title);
        _stateCache = { at: Date.now(), data };
        void saveSnapshot(data);
        return data;
    })();
    try {
        return await _stateInflight;
    }
    finally {
        _stateInflight = null;
    }
}
async function collect(title, force = false) {
    const fresh = _stateCache !== null && Date.now() - _stateCache.at < STATE_TTL_MS;
    if (!force && fresh)
        return _stateCache.data;
    if (!force && _stateCache) {
        void refreshState(title).catch(() => {
            /* 后台刷新失败沿用旧缓存，下次请求重试 */
        });
        return _stateCache.data;
    }
    return refreshState(title);
}
function fmtTokens(n) {
    if (n >= 1e8)
        return (n / 1e8).toFixed(2).replace(/\.?0+$/, '') + '亿';
    if (n >= 1e4)
        return (n / 1e4).toFixed(1).replace(/\.0$/, '') + '万';
    return String(n);
}
function fmtDur(ms) {
    const min = Math.floor(ms / 60000);
    if (min >= 1440)
        return `${Math.floor(min / 1440)}天${Math.floor((min % 1440) / 60)}小时`;
    if (min >= 60)
        return `${Math.floor(min / 60)}小时${min % 60}分`;
    return `${min}分`;
}
function summaryText(d) {
    const m = d.metrics;
    const lines = [
        `累计 ${fmtTokens(m.totalTokens)} tokens（输入 ${fmtTokens(m.uncachedInputTokens)} / 输出 ${fmtTokens(m.outputTokens)} / 缓存读 ${fmtTokens(m.cacheReadTokens)}）`,
        `覆盖 ${m.activeDays} 个活跃日（${m.firstDay ?? '—'} → ${m.lastDay ?? '—'}），日均 ${fmtTokens(m.avgPerActiveDay)}`,
        m.peakDay ? `峰值 ${m.peakDay.day} · ${fmtTokens(m.peakDay.tokens)}` : '峰值 —',
        `连续活跃 ${m.currentStreak} 天（最长 ${m.longestStreak} 天）· 今日 ${fmtTokens(m.todayTokens)} · 本周 ${fmtTokens(m.weekTokens)}（上周 ${fmtTokens(m.prevWeekTokens)}）`,
        `会话 ${m.sessions}${m.deletedSessions ? `(含已删归档 ${m.deletedSessions})` : ''}（主 ${m.mainSessions} · 子代理 ${m.subagentSessions}，子代理 ${fmtTokens(m.subagentTokens)} tokens）· 轮 ${m.turns} · 步 ${m.steps}` + (m.longestSession ? ` · 最长会话 ${fmtDur(m.longestSession.ms)}` : ''),
        `数据源：${d.source.logs} 个会话日志 + ${d.source.orphans} 个投影缓存${d.source.archived ? ` + ${d.source.archived} 个已删归档` : ''}（重扫 ${d.source.decoded}，命中 ${d.source.cacheHits}，${d.source.scanMs}ms）`,
    ];
    if (d.source.droppedFrames > 0)
        lines.push(`⚠ 丢弃损坏帧 ${d.source.droppedFrames}（下次扫描收敛）`);
    return lines.join('\n');
}
export function apply(ctx0, config) {
    const ctx = ctx0;
    const API = '/@dsh-external/dsh-usage-heatmap/api';
    const title = config.title || DEFAULT_TITLE;
    // 快照热启：先挂上上次扫描的落盘结果（首帧秒开），再后台增量扫描刷新
    if (!_stateCache)
        _stateCache = { at: 0, data: loadSnapshot(title) };
    if (_stateCache.data === null)
        _stateCache = null; // 没有可用快照：退回“等扫描”
    // 预热：后台跑增量扫描（逐文件让出事件循环，不阻塞宿主/设置页）
    void refreshState(title).catch(() => {
        /* 预热失败：第一次请求会重试 */
    });
    // 防「删会话丢统计」：DSH 删除会话会同时删掉日志与投影，面板只能保住已扫描落缓存的
    // 分桶 ⇒ 每 5 分钟后台增量固化一次（全缓存命中时 ~64ms，逐文件 yield 不阻塞宿主），
    // 即使设置页一直没打开，会话被删前也先进 cache.json 归档桶。独立 effect：注册路径保持
    // 原样（register 返回值直接交给 fiber 作 disposer，420 次热重载验证过的形态）。
    ctx.effect(() => {
        const keeper = setInterval(() => {
            void refreshState(title).catch(() => {
                /* 固化失败不影响功能，下次心跳重试 */
            });
        }, 5 * 60 * 1000);
        keeper.unref?.();
        return () => clearInterval(keeper);
    });
    ctx.effect(() => ctx.webServer.register({
        kind: 'prefix',
        path: API,
        handler: async (req, res) => {
            const url = req.url || '/';
            const fresh = /[?&]fresh=1(?:&|$)/.test(url);
            try {
                let payload;
                // 精确匹配（req.url 可能带也可能不带 API 前缀，两种都兼容）：
                // 用全等而非 includes，避免 /stateXXX 之类误命中
                const pathname = url.split('?')[0];
                const sub = pathname.startsWith(API) ? pathname.slice(API.length) : pathname;
                if (sub === '/state')
                    payload = await collect(title, fresh);
                else
                    payload = {
                        ok: true,
                        service: name,
                        endpoints: ['/state?fresh=1'],
                    };
                res.writeHead(200, {
                    'content-type': 'application/json; charset=utf-8',
                    'cache-control': 'no-store',
                });
                res.end(JSON.stringify(payload));
            }
            catch (e) {
                res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify({ error: e?.message ?? 'internal error' }));
            }
        },
    }), '@dsh-external/dsh-usage-heatmap: api');
    ctx.effect(() => ctx.tools.register(defineTool({
        name: '_dsh_external_dsh_usage_heatmap_status',
        description: '模型用量统计面板：累计 Token/峰值/最长会话/连续天数指标卡 + GitHub 风格 Token 热力图（日/周/累计切换）+ 活动洞察，数据来自本地 DSH 用量聚合',
        parameters: {},
        output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: String(value) }],
        },
        async execute() {
            const d = await collect(title, false);
            return summaryText(d);
        },
    })), '@dsh-external/dsh-usage-heatmap: status tool');
}
//# sourceMappingURL=index.js.map