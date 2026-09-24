/**
 * 用量聚合（host 侧）：解码耐久会话日志 → 按本地日分桶 → 指标计算。
 *
 * 数据源与折叠规则（2026-09 实测验证）：
 *  1. 耐久会话日志 `~/.dsh/sessions/<cwd>/<sessionId>/session.v4.jsonl.zstd`：
 *     多帧 zstd（每批 append 一帧），`zlib.zstdDecompressSync` 单次只能解出首帧，
 *     故本模块自带帧头解析器逐帧解码（含撕裂尾部 resync 容错）。
 *     每条事件带顶层 `time`（本地毫秒），`assistant/message.data.usage` /
 *     `assistant/attempt` 流尾 usage 携带 token 计数 → 按 time 归入本地日。
 *  2. 折叠语义逐行镜像 dsh-token-meter 的 tokenUsage 投影
 *     （usageOf + 同 turn/step 的 replace 语义 + llm/retry-started 清槽）：
 *     与 session_projcache 的 `rows.tokenUsage.val.totals` 逐会话精确一致
 *     （实测16/16 双有会话零差异），因此天级分桶和累计口径同源一致。
 *  3. 仅有投影缓存、日志已被清理的会话（孤儿）按 identity.createdAt 归日，
 *     避免累计口径塌缩。
 *
 * 增量缓存：`~/.dsh/storages/usage-heatmap/cache.json`，按 (mtime,size) 判变更，
 * 只重扫变更文件；未变更文件复用缓存分桶。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
const CACHE_VERSION = 1;
const HOME = os.homedir();
export const SESSIONS_ROOT = path.join(HOME, '.dsh', 'sessions');
export const PROJ_DIR = path.join(HOME, '.dsh', 'storages', 'session_projcache', 'sessions');
const CACHE_DIR = path.join(HOME, '.dsh', 'storages', 'usage-heatmap');
const CACHE_FILE = path.join(CACHE_DIR, 'cache.json');
const LOG_RE = /^session\.v\d+\.jsonl\.zstd$/;
// ---------------------------------------------------------------------------
// 时间工具（全部本地时区）
// ---------------------------------------------------------------------------
export function dayKey(ms) {
    return dayKeyOfDate(new Date(ms));
}
function dayKeyOfDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** 键 → 当地 0 点 ms */
function dayStart(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
}
export function todayKey() {
    return dayKeyOfDate(new Date());
}
function addDaysKey(key, delta) {
    const d = new Date(dayStart(key));
    d.setDate(d.getDate() + delta);
    return dayKeyOfDate(d);
}
/** 该日所在周的周一键（周一为一周之始） */
export function mondayOfWeekKey(key) {
    const d = new Date(dayStart(key));
    const shift = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
    d.setDate(d.getDate() - shift);
    return dayKeyOfDate(d);
}
/** 周一键 → 周日键 */
export function weekEndKey(monday) {
    return addDaysKey(monday, 6);
}
// ---------------------------------------------------------------------------
// 多帧 zstd 解码（帧头解析 + 撕裂尾部 resync）
// ---------------------------------------------------------------------------
const ZSTD_MAGIC = 0xfd2fb528;
function isSkippableMagic(m) {
    return m >= 0x184d2a50 && m <= 0x184d2a5f;
}
function findMagic(buf, from) {
    for (let i = from; i + 4 <= buf.length; i++) {
        if (buf.readUInt32LE(i) === ZSTD_MAGIC)
            return i;
    }
    return -1;
}
/** 解析一帧的物理结束偏移（不含本帧之前内容）。 */
function parseFrameEnd(buf, off) {
    let p = off + 4;
    const fhd = buf[p];
    p += 1;
    const fcsFlag = fhd >> 6;
    const single = (fhd >> 5) & 1;
    const checksum = (fhd >> 2) & 1;
    const dictId = fhd & 3;
    p += [0, 1, 2, 4][dictId];
    if (!single)
        p += 1; // window descriptor
    p += fcsFlag === 0 ? (single ? 1 : 0) : fcsFlag === 1 ? 2 : fcsFlag === 2 ? 4 : 8;
    let last = false;
    let guard = 0;
    while (!last) {
        if (p + 3 > buf.length)
            throw new Error('torn block header');
        const bh = buf.readUIntLE(p, 3);
        p += 3;
        last = (bh & 1) === 1;
        const type = (bh >>> 1) & 3;
        const size = bh >>> 3;
        if (type === 3)
            throw new Error('reserved block type');
        const payload = type === 1 ? 1 : size;
        if (p + payload > buf.length)
            throw new Error('torn block payload');
        p += payload;
        if (++guard > 1e7)
            throw new Error('runaway blocks');
    }
    if (checksum) {
        if (p + 4 > buf.length)
            throw new Error('torn checksum');
        p += 4;
    }
    return p;
}
/** zstdDecompressSync 在当前 @types/node 的可用性由运行时决定，这里收窄类型。 */
const zstdDecompressSync = zlib.zstdDecompressSync;
/** 逐帧解出完整 JSONL 文本；损坏/撕裂帧跳过并计数（下次扫描再收敛）。 */
export function decodeZstdJsonl(buf) {
    let off = 0;
    let text = '';
    let dropped = 0;
    while (off + 4 <= buf.length) {
        const magic = buf.readUInt32LE(off);
        if (isSkippableMagic(magic)) {
            if (off + 8 > buf.length)
                break;
            const size = buf.readUInt32LE(off + 4);
            if (off + 8 + size > buf.length)
                break;
            off += 8 + size;
            continue;
        }
        if (magic !== ZSTD_MAGIC) {
            const nx = findMagic(buf, off + 1);
            if (nx < 0)
                break;
            dropped += 1;
            off = nx;
            continue;
        }
        let end;
        try {
            end = parseFrameEnd(buf, off);
        }
        catch {
            const nx = findMagic(buf, off + 4);
            dropped += 1;
            if (nx < 0)
                break;
            off = nx;
            continue;
        }
        try {
            text += zstdDecompressSync(buf.subarray(off, end)).toString('utf8');
        }
        catch {
            dropped += 1;
        }
        off = end;
    }
    return { text, dropped };
}
/** 镜像 dsh-llm lastAssistantStreamChunk(stream, 'usage')?.usage */
function lastStreamUsage(stream) {
    if (!Array.isArray(stream))
        return undefined;
    for (let i = stream.length - 1; i >= 0; i--) {
        const r = stream[i];
        if (r && r.type === 'chunk' && r.chunk && r.chunk.type === 'usage' && r.chunk.usage !== undefined) {
            return r.chunk.usage;
        }
    }
    return undefined;
}
/** 镜像 token-meter usageOf() */
function usageOf(ev) {
    if (ev.type === 'assistant/message' && ev.data && ev.data.usage !== undefined)
        return ev.data.usage;
    if (ev.type !== 'assistant/message' && ev.type !== 'assistant/attempt')
        return undefined;
    return lastStreamUsage(ev.data?.stream);
}
function bucketsFrom(u) {
    return [
        Number(u.inputTokens) || 0,
        Number(u.outputTokens) || 0,
        Number(u.cacheReadTokens ?? 0) || 0,
        Number(u.cacheWriteTokens ?? 0) || 0,
    ];
}
function bucketsEqual(a, b) {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}
function extractTitle(ev) {
    const d = ev?.data;
    let t;
    if (typeof d === 'string')
        t = d;
    else if (d && typeof d === 'object')
        t = d.title ?? d.name;
    if (typeof t !== 'string' || !t.trim())
        return '';
    return t.trim().slice(0, 120);
}
export function foldSessionLines(text) {
    const out = { id: '', cwd: '', title: '', first: 0, last: 0, days: {}, turns: 0, steps: 0 };
    const turnSet = new Set();
    let last = null;
    for (const line of text.split('\n')) {
        if (!line)
            continue;
        let ev;
        try {
            ev = JSON.parse(line);
        }
        catch {
            continue;
        }
        if (ev.type === 'session') {
            if (typeof ev.id === 'string')
                out.id = ev.id;
            if (typeof ev.cwd === 'string')
                out.cwd = ev.cwd;
            continue;
        }
        const t = typeof ev.time === 'number' ? ev.time : 0;
        if (t > 0) {
            if (out.first === 0 || t < out.first)
                out.first = t;
            if (t > out.last)
                out.last = t;
        }
        if (ev.type === 'session/title') {
            const title = extractTitle(ev);
            if (title)
                out.title = title;
            continue;
        }
        if (ev.type === 'turn/start' && typeof ev.data?.turn === 'number') {
            turnSet.add(ev.data.turn);
            continue;
        }
        if (ev.type === 'step/end') {
            out.steps += 1;
            continue;
        }
        if (ev.type === 'llm/retry-started') {
            if (last && last.turn === ev.data?.turn && last.step === ev.data?.step)
                last = null;
            continue;
        }
        if (ev.type !== 'assistant/message' && ev.type !== 'assistant/attempt')
            continue;
        const sample = usageOf(ev);
        if (sample === undefined || t <= 0)
            continue;
        const day = dayKey(t);
        const b = bucketsFrom(sample);
        const turn = ev.data?.turn;
        const step = ev.data?.step;
        const prev = last !== null && last.turn === turn && last.step === step ? last : null;
        if (prev !== null && bucketsEqual(prev.b, b))
            continue; // 投影：无变化，归属日也不动
        if (prev !== null) {
            const d = out.days[prev.day];
            if (d) {
                d[0] -= prev.b[0];
                d[1] -= prev.b[1];
                d[2] -= prev.b[2];
                d[3] -= prev.b[3];
            }
        }
        const d = (out.days[day] ??= [0, 0, 0, 0]);
        d[0] += b[0];
        d[1] += b[1];
        d[2] += b[2];
        d[3] += b[3];
        last = { turn, step, day, b };
    }
    out.turns = turnSet.size;
    return out;
}
// ---------------------------------------------------------------------------
// 文件枚举
// ---------------------------------------------------------------------------
function listLogFiles(root) {
    const out = [];
    const walk = (dir) => {
        let ents;
        try {
            ents = fs.readdirSync(dir, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const e of ents) {
            const p = path.join(dir, e.name);
            if (e.isDirectory())
                walk(p);
            else if (e.isFile() && LOG_RE.test(e.name))
                out.push(path.relative(root, p));
        }
    };
    walk(root);
    return out;
}
/** 投影读取 memo：按 mtime 复用已解析 meta——未变更文件只 stat 不再读盘+JSON.parse（扫描耗时大头）。 */
const projMemo = new Map();
async function readProjcache() {
    const map = new Map();
    let files;
    try {
        files = fs.readdirSync(PROJ_DIR);
    }
    catch {
        projMemo.clear();
        return map;
    }
    const seen = new Set();
    let n = 0;
    for (const f of files) {
        if ((n++ & 3) === 0)
            await new Promise((r) => setImmediate(r)); // 每 4 个文件让出事件循环
        if (!f.endsWith('.json'))
            continue;
        const key = f.replace(/\.json$/, '');
        seen.add(key);
        const file = path.join(PROJ_DIR, f);
        try {
            const st = fs.statSync(file);
            const memo = projMemo.get(key);
            if (memo && memo.mtime === st.mtimeMs) {
                map.set(key, memo.meta);
                continue;
            }
            const j = JSON.parse(fs.readFileSync(file, 'utf8'));
            const rec = j.record ?? j;
            const totalsRaw = rec.rows?.tokenUsage?.val?.totals;
            const stats = rec.rows?.sessionStats?.val;
            const title = typeof rec.rows?.title?.val === 'string' ? String(rec.rows.title.val).slice(0, 120) : '';
            const labelRaw = rec.rows?.subagent?.val?.identity?.label;
            const subagentLabel = typeof labelRaw === 'string' ? labelRaw : '';
            const headVals = rec.rows?.subagentCatalog?.val?.head?.values;
            const children = Array.isArray(headVals)
                ? headVals.map((v) => String(v?.childId ?? '')).filter(Boolean)
                : [];
            const meta = {
                mtime: st.mtimeMs,
                created: typeof rec.identity?.createdAt === 'number' ? rec.identity.createdAt : 0,
                totals: totalsRaw
                    ? [
                        Number(totalsRaw.uncachedInputTokens) || 0,
                        Number(totalsRaw.outputTokens) || 0,
                        Number(totalsRaw.cacheReadTokens) || 0,
                        Number(totalsRaw.cacheWriteTokens) || 0,
                    ]
                    : null,
                turns: Number(stats?.turns) || 0,
                steps: Number(stats?.steps) || 0,
                title,
                cwd: typeof rec.identity?.cwd === 'string' ? rec.identity.cwd : '',
                subagentLabel,
                children,
            };
            projMemo.set(key, { mtime: st.mtimeMs, meta });
            map.set(key, meta);
        }
        catch {
            /* 单个缓存文件损坏跳过（不入 memo，下次扫描重试） */
        }
    }
    for (const k of projMemo.keys())
        if (!seen.has(k))
            projMemo.delete(k);
    return map;
}
// ---------------------------------------------------------------------------
// 缓存读写
// ---------------------------------------------------------------------------
function loadCache() {
    const fresh = { version: CACHE_VERSION, sessions: {}, orphans: {}, archived: {}, lastRun: 0 };
    try {
        const doc = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        if (doc && doc.version === CACHE_VERSION && doc.sessions && doc.orphans) {
            if (!doc.archived)
                doc.archived = {}; // 旧版缓存升级兼容
            return doc;
        }
    }
    catch {
        /* 不存在/损坏 → 重建 */
    }
    return fresh;
}
function saveCache(doc) {
    try {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        const tmp = CACHE_FILE + '.' + Math.random().toString(36).slice(2, 8) + '.tmp'; // 随机后缀防并发写互踩
        fs.writeFileSync(tmp, JSON.stringify(doc));
        fs.renameSync(tmp, CACHE_FILE);
    }
    catch {
        /* 缓存写失败不影响本次结果 */
    }
}
// ---------------------------------------------------------------------------
// 指标计算
// ---------------------------------------------------------------------------
/** 剥 "session-" 前缀：日志 header / 部分 projcache 文件名 / childId 三侧 id 形态不一 */
function bareId(id) {
    return id.replace(/^session-/, '');
}
function computeMetrics(days, sessions, orphans, archived, subagentBare) {
    const total = [0, 0, 0, 0];
    const dayTotals = {};
    for (const [day, b] of Object.entries(days)) {
        const t = b[0] + b[1] + b[2] + b[3];
        dayTotals[day] = t;
        total[0] += b[0];
        total[1] += b[1];
        total[2] += b[2];
        total[3] += b[3];
    }
    const totalTokens = total[0] + total[1] + total[2] + total[3];
    const dayKeys = Object.keys(dayTotals).filter((d) => dayTotals[d] > 0).sort();
    const activeDays = dayKeys.length;
    let peakDay = null;
    for (const d of dayKeys) {
        if (peakDay === null || dayTotals[d] > peakDay.tokens)
            peakDay = { day: d, tokens: dayTotals[d] };
    }
    let longestStreak = 0;
    {
        let run = 0;
        let prev = null;
        for (const d of dayKeys) {
            run = prev !== null && addDaysKey(prev, 1) === d ? run + 1 : 1;
            if (run > longestStreak)
                longestStreak = run;
            prev = d;
        }
    }
    let currentStreak = 0;
    {
        const today = todayKey();
        let cursor = dayTotals[today] > 0 ? today : addDaysKey(today, -1);
        let guard = 0;
        while (dayTotals[cursor] !== undefined && dayTotals[cursor] > 0 && guard++ < 3650) {
            currentStreak += 1;
            cursor = addDaysKey(cursor, -1);
        }
    }
    const today = todayKey();
    const monday = mondayOfWeekKey(today);
    let weekTokens = 0;
    for (let i = 0; i < 7; i++)
        weekTokens += dayTotals[addDaysKey(monday, i)] ?? 0;
    let prevWeekTokens = 0;
    const prevMonday = addDaysKey(monday, -7);
    for (let i = 0; i < 7; i++)
        prevWeekTokens += dayTotals[addDaysKey(prevMonday, i)] ?? 0;
    const monthPrefix = today.slice(0, 7);
    let monthTokens = 0;
    for (const d of Object.keys(dayTotals))
        if (d.startsWith(monthPrefix))
            monthTokens += dayTotals[d];
    // 最长会话：日志事件区间 优先，孤儿投影 createdAt→mtime 兜底
    let longest = null;
    for (const s of [...Object.values(sessions), ...Object.values(archived)]) {
        const ms = s.first > 0 && s.last > s.first ? s.last - s.first : 0;
        if (ms > 0 && (longest === null || ms > longest.ms)) {
            longest = { ms, title: s.title, cwd: s.cwd };
        }
    }
    for (const o of Object.values(orphans)) {
        const ms = o.created > 0 && o.mtime > o.created ? o.mtime - o.created : 0;
        if (ms > 0 && (longest === null || ms > longest.ms)) {
            longest = { ms, title: o.title, cwd: o.cwd };
        }
    }
    let turns = 0;
    let steps = 0;
    for (const s of [...Object.values(sessions), ...Object.values(archived)]) {
        turns += s.turns;
        steps += s.steps;
    }
    for (const o of Object.values(orphans)) {
        turns += o.turns;
        steps += o.steps;
    }
    // 会话拆分：主 / 子代理（子代理由 projcache rows.subagent.label 或父会话 subagentCatalog 判定）
    let mainSessions = 0;
    let subagentSessions = 0;
    let subagentTokens = 0;
    const allEntries = [
        ...Object.values(sessions).map((s) => ({ id: s.id, days: s.days })),
        ...Object.values(archived).map((s) => ({ id: s.id, days: s.days })),
        ...Object.values(orphans).map((o) => ({ id: o.id, days: { [o.day]: o.b } })),
    ];
    for (const e of allEntries) {
        if (subagentBare.has(bareId(e.id))) {
            subagentSessions++;
            for (const b of Object.values(e.days))
                subagentTokens += b[0] + b[1] + b[2] + b[3];
        }
        else {
            mainSessions++;
        }
    }
    let deletedTokens = 0;
    for (const s of Object.values(archived)) {
        for (const b of Object.values(s.days))
            deletedTokens += b[0] + b[1] + b[2] + b[3];
    }
    const deletedSessions = Object.keys(archived).length;
    return {
        totalTokens,
        uncachedInputTokens: total[0],
        outputTokens: total[1],
        cacheReadTokens: total[2],
        cacheWriteTokens: total[3],
        activeDays,
        firstDay: dayKeys.length ? dayKeys[0] : null,
        lastDay: dayKeys.length ? dayKeys[dayKeys.length - 1] : null,
        currentStreak,
        longestStreak,
        peakDay,
        avgPerActiveDay: activeDays > 0 ? Math.round(totalTokens / activeDays) : 0,
        sessions: Object.keys(sessions).length + Object.keys(orphans).length,
        mainSessions,
        subagentSessions,
        subagentTokens,
        deletedSessions,
        deletedTokens,
        turns,
        steps,
        longestSession: longest,
        cacheReadShare: totalTokens > 0 ? total[2] / totalTokens : 0,
        todayTokens: dayTotals[today] ?? 0,
        yesterdayTokens: dayTotals[addDaysKey(today, -1)] ?? 0,
        weekTokens,
        prevWeekTokens,
        monthTokens,
    };
}
function mergeDays(sessions, orphans, archived) {
    const days = {};
    const add = (day, b) => {
        const d = (days[day] ??= [0, 0, 0, 0]);
        d[0] += b[0];
        d[1] += b[1];
        d[2] += b[2];
        d[3] += b[3];
    };
    for (const s of Object.values(sessions)) {
        for (const [day, b] of Object.entries(s.days))
            add(day, b);
    }
    for (const s of Object.values(archived)) {
        for (const [day, b] of Object.entries(s.days))
            add(day, b);
    }
    for (const o of Object.values(orphans))
        add(o.day, o.b);
    return days;
}
// ---------------------------------------------------------------------------
// 扫描（增量、串行化）
// ---------------------------------------------------------------------------
let inflight = null;
/** 已删除日志 → 归档保留已折叠分桶（删除会话不丢历史用量）；复活且重解码成功 → 移回活会话。 */
function archiveDeletedLogs(cache, alive) {
    let changed = false;
    for (const rel of Object.keys(cache.sessions)) {
        if (!alive.has(rel)) {
            cache.archived[rel] = cache.sessions[rel];
            delete cache.sessions[rel];
            changed = true;
        }
    }
    for (const rel of Object.keys(cache.archived)) {
        // 解码失败则保留归档，避免数据丢失
        if (alive.has(rel) && cache.sessions[rel]) {
            delete cache.archived[rel];
            changed = true;
        }
    }
    return changed;
}
/**
 * 空 days 归档兜底：会话在首次折叠出用量前就被删/删除竞争 → 用同 id 投影 totals 回填
 *（与 orphan 同源同口径）。★ 勿写 `pm.totals > 0`：totals 是四元数组，`数组 > 0` 会强转
 * 恒为 false 使回填永不触发（本轮审计修掉的静默丢数 bug）。回填者已含在 archived 的
 * bareId 孤儿排除里，不会双计。
 */
function backfillEmptyArchived(archived, proj) {
    let changed = false;
    for (const rel of Object.keys(archived)) {
        const a = archived[rel];
        if (a.days && Object.keys(a.days).length > 0)
            continue;
        const ab = bareId(a.id);
        let pm = null;
        for (const [pid, m] of proj) {
            if (bareId(pid) === ab) {
                pm = m;
                break;
            }
        }
        if (!pm || !pm.totals)
            continue;
        const day = a.first > 0 ? dayKey(a.first) : pm.created > 0 ? dayKey(pm.created) : null;
        const t = pm.totals[0] + pm.totals[1] + pm.totals[2] + pm.totals[3];
        if (t > 0 && day) {
            a.days = { [day]: [pm.totals[0], pm.totals[1], pm.totals[2], pm.totals[3]] };
            changed = true;
        }
    }
    return changed;
}
/** 孤儿投影：projcache 有、对应日志/归档不存在 → 按创建日归桶（未变更复用旧条目）。返回是否有变动。 */
function collectOrphans(cache, proj) {
    // 两侧 id 形态不一（日志 header 与部分 projcache 文件名带 "session-" 前缀）→ 统一剥前缀再比，
    // 否则全部误判孤儿、与日志双计；归档（含已回填空归档）bareId 同样在排除集合内。
    const logBareIds = new Set();
    for (const s of Object.values(cache.sessions))
        logBareIds.add(bareId(s.id));
    for (const s of Object.values(cache.archived))
        logBareIds.add(bareId(s.id));
    const live = {};
    let changed = false;
    for (const [id, meta] of proj) {
        if (logBareIds.has(bareId(id)))
            continue; // 有日志/归档则不重复计孤儿（避免双计）
        if (meta.totals === null)
            continue;
        const prev = cache.orphans[id];
        if (prev && prev.mtime === meta.mtime) {
            live[id] = prev;
            continue;
        }
        if (meta.created <= 0)
            continue;
        live[id] = {
            id,
            created: meta.created,
            mtime: meta.mtime,
            day: dayKey(meta.created),
            b: meta.totals,
            turns: meta.turns,
            steps: meta.steps,
            title: meta.title,
            cwd: meta.cwd,
        };
        changed = true;
    }
    if (Object.keys(live).length !== Object.keys(cache.orphans).length)
        changed = true;
    cache.orphans = live;
    return changed;
}
async function runScan() {
    if (typeof zstdDecompressSync !== 'function') {
        // 早失败：否则缺 zstd 支持的运行时会把每帧解码吞成 dropped，静默产出 0 数据
        throw new Error('zlib.zstdDecompressSync 不可用（运行时缺少 zstd 支持）');
    }
    const t0 = Date.now();
    const cache = loadCache();
    const proj = await readProjcache();
    const rels = listLogFiles(SESSIONS_ROOT);
    const alive = new Set(rels);
    let decoded = 0;
    let cacheHits = 0;
    let droppedFrames = 0;
    let dirty = false; // 任何分桶/归档/孤儿变动才回写 cache.json（无变更的 60s 轮询零磁盘写）
    // 让出事件循环：每个文件解码是同步 CPU 工作，逐文件 yield（8ms 切片）保证宿主 UI 不被卡住
    let sliceAt = Date.now() + 8;
    for (const rel of rels) {
        if (Date.now() >= sliceAt) {
            await new Promise((r) => setImmediate(r));
            sliceAt = Date.now() + 8;
        }
        const abs = path.join(SESSIONS_ROOT, rel);
        let st;
        try {
            st = fs.statSync(abs);
        }
        catch {
            continue;
        }
        const prev = cache.sessions[rel];
        if (prev && prev.mtime === st.mtimeMs && prev.size === st.size) {
            cacheHits += 1;
            continue;
        }
        try {
            const buf = fs.readFileSync(abs);
            const { text, dropped } = decodeZstdJsonl(buf);
            droppedFrames += dropped;
            const folded = foldSessionLines(text);
            cache.sessions[rel] = {
                path: rel,
                mtime: st.mtimeMs,
                size: st.size,
                id: folded.id || path.basename(path.dirname(abs)),
                cwd: folded.cwd,
                title: folded.title,
                first: folded.first,
                last: folded.last,
                days: folded.days,
                turns: folded.turns,
                steps: folded.steps,
            };
            decoded += 1;
            dirty = true;
        }
        catch {
            /* 整文件不可解 → 保留旧缓存（若有） */
        }
    }
    // 归档 → 空归档兜底 → 孤儿投影（拆为独立纯函数，runScan 只做编排）
    const archived = cache.archived;
    if (archiveDeletedLogs(cache, alive))
        dirty = true;
    if (backfillEmptyArchived(archived, proj))
        dirty = true;
    if (collectOrphans(cache, proj))
        dirty = true;
    if (dirty) {
        cache.lastRun = Date.now();
        saveCache(cache);
    }
    // 子代理识别：rows.subagent.identity.label（子会话自身） ∪ 父会话 subagentCatalog.childId
    const subagentBare = new Set();
    for (const [id, meta] of proj) {
        if (meta.subagentLabel)
            subagentBare.add(bareId(id));
        for (const c of meta.children)
            subagentBare.add(bareId(c));
    }
    const days = mergeDays(cache.sessions, cache.orphans, archived);
    const metrics = computeMetrics(days, cache.sessions, cache.orphans, archived, subagentBare);
    const dayTotals = {};
    for (const [d, b] of Object.entries(days))
        dayTotals[d] = b[0] + b[1] + b[2] + b[3];
    return {
        dayTotals,
        metrics,
        source: {
            logs: rels.length,
            orphans: Object.keys(cache.orphans).length,
            archived: Object.keys(archived).length,
            decoded,
            droppedFrames,
            cacheHits,
            scanMs: Date.now() - t0,
            updatedAt: Date.now(),
        },
    };
}
/** 串行化：并发调用共享同一次扫描。 */
export function scan() {
    if (inflight)
        return inflight;
    inflight = runScan().finally(() => {
        inflight = null;
    });
    return inflight;
}
//# sourceMappingURL=aggregate.js.map