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
/**
 * 逐帧解码迭代器：帧头解析 → 撕裂尾部 resync → 单帧解码的唯一实现，
 * 由 decodeZstdJsonl（整段文本）与 foldZstdSession（流式折叠）共用。
 * yield 每个成功解出的帧；return 丢弃帧数（损坏/撕裂帧跳过，下次扫描再收敛）。
 */
function* iterDecodedFrames(buf) {
    let off = 0;
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
        // 解码放在 try 内、yield 放在 try 外：消费方抛错不得被误计为「丢弃帧」而静默吞掉
        let decoded = null;
        try {
            decoded = zstdDecompressSync(buf.subarray(off, end));
        }
        catch {
            dropped += 1;
        }
        if (decoded !== null)
            yield decoded;
        off = end;
    }
    return dropped;
}
/**
 * 逐帧解出完整 JSONL 文本；损坏/撕裂帧跳过并计数（下次扫描再收敛）。
 * 文本模式下保留「逐帧 toString 再拼接」的解码语义（与历史实现逐字节一致）。
 *
 * **不在扫描主路径上**（主路径走 foldZstdSession，不构造整段文本），但**不是死代码**：
 * 它是等价性验收的对外锚点——tools/byte-equiv.mjs（decodeZstdJsonl 文本 hash 对比）
 * 与 tools/perf-probe.mjs（legacy 基线计时）都依赖此导出，verifier 亦用它做独立复现。
 * 故保留导出与语义，勿删；删除前须先确认 tools/ 侧不再消费。
 */
export function decodeZstdJsonl(buf) {
    const chunks = [];
    const it = iterDecodedFrames(buf);
    let r = it.next();
    while (!r.done) {
        chunks.push(r.value.toString('utf8'));
        r = it.next();
    }
    return { text: chunks.join(''), dropped: r.done ? r.value : 0 };
}
/**
 * 镜像 dsh-llm lastAssistantStreamChunk(stream, 'usage')?.usage
 *
 * ★ 判空用 `!= null` 而非 `!== undefined`：上游在"本次调用未上报 usage"时可能给出
 *   **null**（而非省略字段），二者语义同为"无数据"。若只判 undefined，null 会穿过本函数
 *   → 穿过 foldAssistantSample 的 `=== undefined` 守卫 → 在 bucketsFrom 里
 *   `Number(u.inputTokens)` 抛 TypeError → 被 runScan 的 per-file try/catch 吞掉
 *   → **整个会话文件被跳过**（该文件此前所有行的记账一并丢失）。
 *   改为 `!= null` 后，null 与 undefined 走同一条"继续向前找"的路径，口径不变。
 */
function lastStreamUsage(stream) {
    if (!Array.isArray(stream))
        return undefined;
    for (let i = stream.length - 1; i >= 0; i--) {
        const r = stream[i];
        if (r && r.type === 'chunk' && r.chunk && r.chunk.type === 'usage' && r.chunk.usage != null) {
            return r.chunk.usage;
        }
    }
    return undefined;
}
/**
 * 镜像 token-meter usageOf()
 *
 * ★ 同上：`ev.data.usage != null` —— null 视同"未上报"，落到下方流尾兜底，
 *   与 undefined 的行为完全一致（保持既有口径，不改变任何非 null 值的处理）。
 */
function usageOf(ev) {
    if (ev.type === 'assistant/message' && ev.data && ev.data.usage != null)
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
/**
 * assistant/* 的记账尾段（投影差量 → 归属日分桶）——**唯一实现**。
 * 快路径（readAssistantData）与回退路径（整行 JSON.parse）都汇入此处，
 * 保证两条路径不会各自演化出口径差异。
 */
function foldAssistantSample(st, t, sample, turn, step) {
    // `== null` 同时覆盖 undefined 与 null：上游把"未上报 usage"表达为 null 时，
    // 与字段缺失同义处理（跳过本次记账），避免在 bucketsFrom 抛错导致整文件被丢弃。
    if (sample == null || t <= 0)
        return;
    const out = st.out;
    const day = dayKey(t);
    const b = bucketsFrom(sample);
    const last = st.last;
    const prev = last !== null && last.turn === turn && last.step === step ? last : null;
    if (prev !== null && bucketsEqual(prev.b, b))
        return; // 投影：无变化，归属日也不动
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
    st.last = { turn, step, day, b };
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
/**
 * 整段文本折叠（先 split 再逐行进状态机）。**不在扫描主路径上**，但**不是死代码**：
 * tools/byte-equiv.mjs 用它做「整段折叠 == 流式折叠」的交叉验证锚点。保留导出与语义。
 */
export function foldSessionLines(text) {
    const st = newFoldState();
    for (const line of text.split('\n'))
        foldLine(st, line);
    return finishFold(st);
}
function newFoldState() {
    return {
        out: { id: '', cwd: '', title: '', first: 0, last: 0, days: {}, turns: 0, steps: 0 },
        turnSet: new Set(),
        last: null,
    };
}
/**
 * 解析行内顶层 `"time":<整数>`。返回 NaN = 未按预期形态出现，调用方须回退 JSON.parse。
 * 两种已实测锚定的形态（本机 170,789 行 / 81 文件全部命中，0 例外）：
 *   消费类型：`{"type":"<ty>","time":T,`
 *   其余类型：`{"type":"<ty>","seq":N,"time":T,`
 * 命中时跳过整行 JSON.parse——这是扫描的最大单项开销（CPU 剖面 51%）。
 */
function parseLineTime(line, from) {
    let i = line.charCodeAt(from) === 0x2c ? from + 1 : -1; // ','
    if (i < 0 || line.charCodeAt(i) !== 0x22)
        return NaN; // '"'
    if (line.startsWith('"time":', i)) {
        i += 7;
    }
    else if (line.startsWith('"seq":', i)) {
        i += 6;
        const d0 = i;
        while (i < line.length) {
            const c = line.charCodeAt(i);
            if (c < 0x30 || c > 0x39)
                break;
            i++;
        }
        if (i === d0 || !line.startsWith(',"time":', i))
            return NaN;
        i += 8;
    }
    else {
        return NaN;
    }
    const n0 = i;
    if (line.charCodeAt(i) === 0x2d)
        i++; // '-'
    while (i < line.length) {
        const c = line.charCodeAt(i);
        if (c < 0x30 || c > 0x39)
            break;
        i++;
    }
    if (i === n0)
        return NaN;
    return Number(line.slice(n0, i));
}
// ---------------------------------------------------------------------------
// assistant/message 免全量解析快路径
// ---------------------------------------------------------------------------
/** 跳过 `line[j]` 处的一个 JSON 值，返回其结束偏移；-1 = 语法异常（未闭合）。 */
function skipJsonValue(line, j) {
    const c = line.charCodeAt(j);
    if (c === 0x22) {
        // 字符串：处理转义，注意 \\ 与 \" 的先后
        let k = j + 1;
        let esc = false;
        while (k < line.length) {
            const ch = line.charCodeAt(k);
            if (esc)
                esc = false;
            else if (ch === 0x5c)
                esc = true;
            else if (ch === 0x22)
                return k + 1;
            k++;
        }
        return -1;
    }
    if (c === 0x7b || c === 0x5b) {
        // 容器：配对计数，内部字符串整体跳过
        let d = 0;
        let k = j;
        let inStr = false;
        let esc = false;
        while (k < line.length) {
            const ch = line.charCodeAt(k);
            if (inStr) {
                if (esc)
                    esc = false;
                else if (ch === 0x5c)
                    esc = true;
                else if (ch === 0x22)
                    inStr = false;
                k++;
                continue;
            }
            if (ch === 0x22) {
                inStr = true;
                k++;
                continue;
            }
            if (ch === 0x7b || ch === 0x5b)
                d++;
            else if (ch === 0x7d || ch === 0x5d) {
                d--;
                if (d === 0)
                    return k + 1;
            }
            k++;
        }
        return -1;
    }
    // 数字 / true / false / null：扫到分隔符
    let k = j;
    while (k < line.length) {
        const ch = line.charCodeAt(k);
        if (ch === 0x2c || ch === 0x7d || ch === 0x5d || ch <= 0x20)
            break;
        k++;
    }
    return k;
}
/**
 * 只读出 `data.{turn,step,usage}` —— assistant/message 的免全量解析路径。
 *
 * 动机（本机夹具实测）：该类型 26,466 行 / 447.1MB，平均 17,714 字节、最大 2,427,812 字节；
 * 而 `data` 对象起始于行内偏移 58，`data.usage` 的值中位偏移仅 1,836 字节（p90 9,399 /
 * p99 36,487 / 最大 592,875，占行长比例最大 44.1%）。即 ~99.7% 的字节是 message 正文与
 * stream，折叠逻辑**从不消费**，却要为 4 个数字付整行 JSON.parse 的代价（CPU 剖面里
 * `foldLine` 自耗时 40.5%，其中几乎全是它）。
 *
 * 做法：按 JSON 语法正向扫到 `data` 内的目标键，只对 `usage` 的**值文本片段**做 JSON.parse
 * （小对象，解析权威，不手写数字解析）；turn/step 是纯整数字面量，用 Number() 取。
 *
 * 安全边界：任一前提不成立即返回 null，调用方**回退整行 JSON.parse**——快路径只负责省时间，
 * 口径唯一性由回退路径兜底。扫描器严格跳过字符串内容（含转义），故 message 正文里出现的
 * `"usage":` 不会被误命中（实测 26,466 行 0 误判）。
 */
function readAssistantData(line) {
    let i = 0;
    let depth = 0;
    let inStr = false;
    let esc = false;
    let strStart = -1;
    let curKey = null; // 刚读完的键名，等待其值
    let curKeyDepth = -1;
    let awaitingValue = false;
    let dataDepth = -1;
    let turn = null;
    let step = null;
    let usageStart = -1;
    let usageEnd = -1;
    while (i < line.length) {
        const c = line.charCodeAt(i);
        if (awaitingValue) {
            if (c === 0x20 || c === 0x09) {
                i++;
                continue;
            }
            const wanted = dataDepth > 0 && curKeyDepth === dataDepth;
            if (wanted && curKey === 'usage' && c === 0x7b) {
                const e = skipJsonValue(line, i);
                if (e < 0)
                    return null;
                usageStart = i;
                usageEnd = e;
                awaitingValue = false;
                curKey = null;
                if (turn !== null && step !== null)
                    break; // 三个目标齐了：不再扫行尾的 surfaceOp
                i = e;
                continue;
            }
            if (wanted && (curKey === 'turn' || curKey === 'step')) {
                const e = skipJsonValue(line, i);
                if (e < 0)
                    return null;
                const n = Number(line.slice(i, e));
                if (!Number.isInteger(n))
                    return null;
                if (curKey === 'turn')
                    turn = n;
                else
                    step = n;
                awaitingValue = false;
                curKey = null;
                i = e;
                continue;
            }
            awaitingValue = false; // 非目标值：交给下面的常规分派（容器进入 / 字符串跳过 / 标量略过）
        }
        if (inStr) {
            if (esc)
                esc = false;
            else if (c === 0x5c)
                esc = true;
            else if (c === 0x22) {
                inStr = false;
                if (line.charCodeAt(i + 1) === 0x3a) { // 键名后紧跟 ':' 才算键
                    curKey = line.slice(strStart + 1, i);
                    curKeyDepth = depth;
                }
            }
            i++;
            continue;
        }
        if (c === 0x22) {
            inStr = true;
            strStart = i;
            i++;
            continue;
        }
        if (c === 0x7b || c === 0x5b) {
            depth++;
            if (curKey === 'data' && curKeyDepth === depth - 1)
                dataDepth = depth;
            curKey = null;
            i++;
            continue;
        }
        if (c === 0x7d || c === 0x5d) {
            if (depth === dataDepth)
                dataDepth = -1; // data 对象已闭合
            depth--;
            curKey = null;
            i++;
            continue;
        }
        if (c === 0x3a) {
            awaitingValue = true;
            i++;
            continue;
        }
        if (c === 0x2c) {
            curKey = null;
            i++;
            continue;
        }
        i++;
    }
    if (usageStart < 0 || turn === null || step === null)
        return null;
    let usage;
    try {
        usage = JSON.parse(line.slice(usageStart, usageEnd));
    }
    catch {
        return null;
    }
    if (!usage || typeof usage !== 'object')
        return null;
    return { turn, step, usage: usage };
}
function foldLine(st, line) {
    if (!line)
        return;
    const out = st.out;
    // 每条事件行都以 `{"type":"` 开头（实测 170,789/170,789 行成立）；否则回退全量解析
    let ty = '';
    let body = 0; // 行内游标：type 值结束引号的下一位
    if (line.length > 9 && line.charCodeAt(0) === 0x7b && line.startsWith('"type":"', 1)) {
        const q = line.indexOf('"', 9);
        if (q > 9) {
            ty = line.slice(9, q);
            body = q + 1;
        }
    }
    if (ty === '') {
        let ev;
        try {
            ev = JSON.parse(line);
        }
        catch {
            return;
        }
        if (!ev || typeof ev.type !== 'string')
            return;
        ty = ev.type;
        body = -1; // 无游标 → 一律走全量解析分支
    }
    const needsEvent = ty === 'session' || ty === 'session/title' || ty === 'turn/start' ||
        ty === 'llm/retry-started' || ty === 'assistant/attempt';
    // assistant/message 走免全量解析快路径（该类型 26,466 行 / 447.1MB，平均 17.7KB；
    // 只消费 data.{turn,step,usage} 三项）。任一前提不成立即回退下面的整行 JSON.parse。
    if (ty === 'assistant/message') {
        let t = 0;
        if (body >= 0) {
            const ft = parseLineTime(line, body);
            if (ft === ft)
                t = ft;
        }
        const d = readAssistantData(line);
        if (d !== null && t > 0) {
            if (out.first === 0 || t < out.first)
                out.first = t;
            if (t > out.last)
                out.last = t;
            foldAssistantSample(st, t, d.usage, d.turn, d.step);
            return;
        }
        // 回退：整行解析（口径权威路径）
    }
    let ev = null;
    if (needsEvent || ty === 'assistant/message') {
        try {
            ev = JSON.parse(line);
        }
        catch {
            return;
        }
        if (!ev || typeof ev.type !== 'string')
            return;
        ty = ev.type;
    }
    if (ty === 'session') {
        if (typeof ev.id === 'string')
            out.id = ev.id;
        if (typeof ev.cwd === 'string')
            out.cwd = ev.cwd;
        return;
    }
    // 顶层 time：消费类型全量解析后取字段；其余类型走免解析快路径（失败回退 JSON.parse）
    let t = 0;
    if (ev !== null) {
        t = typeof ev.time === 'number' ? ev.time : 0;
    }
    else if (body >= 0) {
        const ft = parseLineTime(line, body);
        if (ft === ft)
            t = ft; // NaN 自比较为 false
    }
    if (t === 0 || t !== t) {
        // 快路径未命中或 time 非数字：回退全量解析取权威值
        try {
            const ev2 = JSON.parse(line);
            t = typeof ev2?.time === 'number' ? ev2.time : 0;
        }
        catch {
            t = 0;
        }
    }
    if (t > 0) {
        if (out.first === 0 || t < out.first)
            out.first = t;
        if (t > out.last)
            out.last = t;
    }
    if (ty === 'session/title') {
        const title = extractTitle(ev);
        if (title)
            out.title = title;
        return;
    }
    if (ty === 'turn/start') {
        if (typeof ev?.data?.turn === 'number')
            st.turnSet.add(ev.data.turn);
        return;
    }
    if (ty === 'step/end') {
        out.steps += 1;
        return;
    }
    if (ty === 'llm/retry-started') {
        const last = st.last;
        if (last && last.turn === ev?.data?.turn && last.step === ev?.data?.step)
            st.last = null;
        return;
    }
    if (ty !== 'assistant/message' && ty !== 'assistant/attempt')
        return;
    foldAssistantSample(st, t, usageOf(ev), ev?.data?.turn, ev?.data?.step);
}
function finishFold(st) {
    st.out.turns = st.turnSet.size;
    return st.out;
}
/**
 * 逐帧折叠驱动：解码/折叠是同步 CPU 工作，按 sliceMs 时间片在帧之间**与行之间**主动让出
 * （yield 一次），调用方 await 一次 setImmediate 即可把控制权还给宿主事件循环。
 * 单帧 zstd 解码不可分割，故阻塞上限 ≈ 最大单帧解码耗时（本机实测 388ms / 11.7MB）；
 * 帧内按行让出，使 19MB / 8952 帧这类大文件不会一次同步跑满数秒（历史实测单次阻塞 3.2s）。
 * 时间片判定放在生成器内：只有真正到期才 yield，避免每行都产生一次 Promise。
 */
export function* foldZstdSessionSteps(buf, sliceMs = 8) {
    const st = newFoldState();
    let sliceAt = Date.now() + sliceMs;
    const due = () => {
        if (Date.now() < sliceAt)
            return false;
        sliceAt = Date.now() + sliceMs;
        return true;
    };
    const it = iterDecodedFrames(buf);
    let carry = '';
    let r = it.next();
    while (!r.done) {
        const chunk = r.value.toString('utf8');
        if (chunk.length > 0) {
            const seg = chunk.split('\n');
            if (carry !== '') {
                seg[0] = carry + seg[0];
                carry = '';
            }
            carry = seg.pop() ?? '';
            for (let i = 0; i < seg.length; i++) {
                foldLine(st, seg[i]);
                if (due())
                    yield;
            }
        }
        if (due())
            yield;
        r = it.next();
    }
    if (carry !== '')
        foldLine(st, carry);
    return { folded: finishFold(st), dropped: r.done ? r.value : 0 };
}
/**
 * 流式折叠：逐帧解码 → 按 '\n' 切行（跨帧 carry）→ 逐行折叠。
 * 与 decodeZstdJsonl + foldSessionLines 的结果逐字节等价（81 文件实测零差异），
 * 但不构造整段 JSONL 文本、不 concat 大 Buffer，峰值内存与 GC 压力显著下降。
 */
export function foldZstdSession(buf) {
    const it = foldZstdSessionSteps(buf);
    let r = it.next();
    while (!r.done)
        r = it.next();
    return r.value;
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
/**
 * 分桶 → 指标。dayTotals 与四元合计在同一次遍历中产出，并作为返回值交给 runScan 直接
 * 作为 payload.days——避免 runScan 再遍历一遍 days 重算同一份合计（原实现重复两遍）。
 */
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
    // 会话集合：日志会话 ∪ 已删归档（两侧同为 LogSessionEntry）——只在此处展开一次，
    // 下面最长会话 / 轮步计数 / 主-子代理拆分 / 归档 token 各自复用，不再重复 spread 建中间数组。
    const logEntries = [...Object.values(sessions), ...Object.values(archived)];
    // 最长会话：日志事件区间 优先，孤儿投影 createdAt→mtime 兜底
    let longest = null;
    for (const s of logEntries) {
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
    for (const s of logEntries) {
        turns += s.turns;
        steps += s.steps;
    }
    for (const o of Object.values(orphans)) {
        turns += o.turns;
        steps += o.steps;
    }
    // 会话拆分：主 / 子代理（子代理由 projcache rows.subagent.label 或父会话 subagentCatalog 判定）
    // 归档会话的 token 直接来自其分桶，顺带算出 deletedTokens——两者同源，故一次遍历。
    let mainSessions = 0;
    let subagentSessions = 0;
    let subagentTokens = 0;
    let deletedTokens = 0;
    const countEntry = (id, days, isArchived) => {
        if (subagentBare.has(bareId(id))) {
            subagentSessions++;
            for (const b of Object.values(days)) {
                const t = b[0] + b[1] + b[2] + b[3];
                subagentTokens += t;
                if (isArchived)
                    deletedTokens += t;
            }
        }
        else {
            mainSessions++;
            if (isArchived)
                for (const b of Object.values(days))
                    deletedTokens += b[0] + b[1] + b[2] + b[3];
        }
    };
    for (const s of Object.values(sessions))
        countEntry(s.id, s.days, false);
    for (const s of Object.values(archived))
        countEntry(s.id, s.days, true);
    for (const o of Object.values(orphans))
        countEntry(o.id, { [o.day]: o.b }, false);
    const deletedSessions = Object.keys(archived).length;
    const metrics = {
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
    return { metrics, dayTotals };
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
    // 让出事件循环：解码+折叠是同步 CPU 工作，按 8ms 时间片让出。
    // 时间片检查同时落在「文件之间」与「帧之间」——单文件 19MB/8952 帧时若只在文件边界检查，
    // 一次同步执行会长达数秒（实测 3.2s），宿主 UI 被卡死。帧内不可分割，故阻塞上限 ≈ 单帧解码耗时。
    let sliceAt = Date.now() + 8;
    const yieldIfDue = async () => {
        if (Date.now() >= sliceAt) {
            await new Promise((r) => setImmediate(r));
            sliceAt = Date.now() + 8;
        }
    };
    for (const rel of rels) {
        await yieldIfDue();
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
            const steps = foldZstdSessionSteps(buf);
            let r = steps.next();
            while (!r.done) {
                await yieldIfDue();
                r = steps.next();
            }
            const { folded, dropped } = r.value;
            droppedFrames += dropped;
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
    // dayTotals 由 computeMetrics 顺带产出（同一次遍历），不再二次遍历 days
    const { metrics, dayTotals } = computeMetrics(days, cache.sessions, cache.orphans, archived, subagentBare);
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