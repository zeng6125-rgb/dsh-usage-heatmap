/** 一个会话某天的分桶：[uncachedInput, output, cacheRead, cacheWrite] */
export type DayBuckets = Record<string, [number, number, number, number]>;
/** 模型分桶："provider/model" → [uncachedInput, output, cacheRead, cacheWrite] */
export type ModelBuckets = Record<string, [number, number, number, number]>;
export interface LogSessionEntry {
    /** sessions 根目录下的相对路径（稳定键） */
    path: string;
    mtime: number;
    size: number;
    /** 日志 header 的 id（session-<uuid>） */
    id: string;
    cwd: string;
    title: string;
    /** 首/末事件时间（ms） */
    first: number;
    last: number;
    days: DayBuckets;
    /** 模型分桶（同 ModelBuckets）。缺 / mv 不符 = 不可信，下次扫描对该文件全量重折补齐 */
    models?: ModelBuckets;
    /** 模型口径版本（MODELS_V） */
    mv?: number;
    turns: number;
    steps: number;
    /**
     * 增量续扫（会话日志仅追加，dsh-session-persistence-jsonl README：committed events are
     * never rewritten）：r = 已消费的完整帧字节边界（下次只解折叠 r 之后的新帧；撕裂/未闭合
     * 尾帧不计入消费，其起点即下次续扫的安全边界）。条目缺 r 或 r<0 = 不可续扫（旧缓存条目，
     * 下次变更时全量折叠并补齐本组字段，自动升级）。
     */
    r?: number;
    /** 前缀 [0,r) sha256（append 不变性守卫，见 foldZstdSessionSteps seed 路径） */
    h?: string;
    /** 折叠状态机 st.last 快照（跨扫描边界的同 turn+step usage 替换去重依赖它），null = 无 */
    u?: {
        turn?: number;
        step?: number;
        day: string;
        b: [number, number, number, number];
        m?: string;
    } | null;
    /** turnSet 快照（轮数计数；缺 = 旧条目，不可续扫） */
    t?: number[];
}
export interface OrphanProjEntry {
    /** projcache 文件名（裸 uuid） */
    id: string;
    created: number;
    /** projcache 文件 mtime（判变更） */
    mtime: number;
    day: string;
    b: [number, number, number, number];
    turns: number;
    steps: number;
    title: string;
    cwd: string;
}
export interface UsageMetrics {
    totalTokens: number;
    uncachedInputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    activeDays: number;
    firstDay: string | null;
    lastDay: string | null;
    currentStreak: number;
    longestStreak: number;
    peakDay: {
        day: string;
        tokens: number;
    } | null;
    avgPerActiveDay: number;
    sessions: number;
    /** 会话拆分：主会话 / 子代理会话（含已归档） */
    mainSessions: number;
    subagentSessions: number;
    subagentTokens: number;
    /** 已删除但已归档保留的会话 */
    deletedSessions: number;
    deletedTokens: number;
    turns: number;
    steps: number;
    longestSession: {
        ms: number;
        title: string;
        cwd: string;
    } | null;
    cacheReadShare: number;
    todayTokens: number;
    yesterdayTokens: number;
    weekTokens: number;
    prevWeekTokens: number;
    monthTokens: number;
}
export interface ScanResult {
    /** 本地日 → 当日总 token（client 热力图直接消费；payloadFrom 透传为 payload.days） */
    dayTotals: Record<string, number>;
    metrics: UsageMetrics;
    /** 模型 → [uncachedInput, output, cacheRead, cacheWrite]。仅含带模型字段的用量；已删会话/孤儿投影无模型明细，不计入 */
    models: ModelBuckets;
    source: {
        logs: number;
        orphans: number;
        archived: number;
        decoded: number;
        droppedFrames: number;
        cacheHits: number;
        scanMs: number;
        updatedAt: number;
    };
}
export declare const SESSIONS_ROOT: string;
export declare const PROJ_DIR: string;
export declare function dayKey(ms: number): string;
export declare function todayKey(): string;
/** 该日所在周的周一键（周一为一周之始） */
export declare function mondayOfWeekKey(key: string): string;
/** 周一键 → 周日键 */
export declare function weekEndKey(monday: string): string;
/**
 * 逐帧解出完整 JSONL 文本；损坏/撕裂帧跳过并计数（下次扫描再收敛）。
 * 文本模式下保留「逐帧 toString 再拼接」的解码语义（与历史实现逐字节一致）。
 *
 * **不在扫描主路径上**（主路径走 foldZstdSession，不构造整段文本），但**不是死代码**：
 * 它是等价性验收的对外锚点——tools/byte-equiv.mjs（decodeZstdJsonl 文本 hash 对比）
 * 与 tools/perf-probe.mjs（legacy 基线计时）都依赖此导出，verifier 亦用它做独立复现。
 * 故保留导出与语义，勿删；删除前须先确认 tools/ 侧不再消费。
 */
export declare function decodeZstdJsonl(buf: Buffer): {
    text: string;
    dropped: number;
};
type Buckets = [number, number, number, number];
interface FoldedSession {
    id: string;
    cwd: string;
    title: string;
    first: number;
    last: number;
    days: DayBuckets;
    /** 模型分桶（同 LogSessionEntry.models） */
    models: ModelBuckets;
    turns: number;
    steps: number;
}
/**
 * 整段文本折叠（先 split 再逐行进状态机）。**不在扫描主路径上**，但**不是死代码**：
 * tools/byte-equiv.mjs 用它做「整段折叠 == 流式折叠」的交叉验证锚点。保留导出与语义。
 */
export declare function foldSessionLines(text: string): FoldedSession;
/** st.last（同 turn+step usage 替换去重指针）。turn/step 可缺（事件 data 不带时原样存 undefined）。m = 模型键，'' = 无模型字段。 */
type LastRef = {
    turn?: number;
    step?: number;
    day: string;
    b: Buckets;
    m: string;
} | null;
interface FoldState {
    out: FoldedSession;
    turnSet: Set<number>;
    last: LastRef;
}
/** 续扫快照（runScan 写入缓存条目、下次续扫恢复）：append-only 日志只折叠尾部新帧。 */
interface FoldResume {
    /** 已消费的完整帧字节边界（撕裂尾帧不计入；下次续解起点）。-1 = 本次未闭合尾部不可续（下次全量） */
    r: number;
    /** 前缀 [0,r) 的 sha256（append 不变性守卫：改写/迁移/压缩转换 → 摘要不符回全量） */
    h: string;
    /** st.last 快照（原始值；JSON 侧 undefined 键会消失，恢复时按缺省 undefined 处理） */
    u: LastRef;
    /** turnSet 快照（轮数计数） */
    t: number[];
}
/** 续扫种子：off = 上次已消费完整帧边界；st = 上次落盘的折叠状态（runScan 侧深拷贝构造）。 */
export interface FoldSeed {
    off: number;
    st: FoldState;
}
/**
 * 逐帧折叠驱动：解码/折叠是同步 CPU 工作，按 sliceMs 时间片在帧之间**与行之间**主动让出
 * （yield 一次），调用方 await 一次 setImmediate 即可把控制权还给宿主事件循环。
 * 单帧 zstd 解码不可分割，故阻塞上限 ≈ 最大单帧解码耗时（本机实测 388ms / 11.7MB）；
 * 帧内按行让出，使 19MB / 8952 帧这类大文件不会一次同步跑满数秒（历史实测单次阻塞 3.2s）。
 * 时间片判定放在生成器内：只有真正到期才 yield，避免每行都产生一次 Promise。
 *
 * seed=null 全量折叠；seed 提供时从 seed.off 起只解折叠**尾部新帧**，状态从 seed.st 续跑
 * （日志仅追加 ⇒ 字节级恒等；调用方须先用 digestPrefix 守卫前缀，改写即不符回全量）。
 * 撕裂尾帧不计入消费边界 ⇒ resume.r 指向撕裂帧起点，其完整化由下次扫描续解收敛。
 * 跨扫描边界的同 turn+step 替换去重靠 st.last（u 快照）续接；轮数计数靠 turnSet（t 快照）。
 */
export declare function foldZstdSessionSteps(buf: Buffer, sliceMs?: number, seed?: FoldSeed | null): Generator<void, {
    folded: FoldedSession;
    dropped: number;
    resume: FoldResume;
}, void>;
/**
 * 流式折叠：逐帧解码 → 按 '\n' 切行（跨帧 carry）→ 逐行折叠。
 * 与 decodeZstdJsonl + foldSessionLines 的结果逐字节等价（81 文件实测零差异），
 * 但不构造整段 JSONL 文本、不 concat 大 Buffer，峰值内存与 GC 压力显著下降。
 */
export declare function foldZstdSession(buf: Buffer): {
    folded: FoldedSession;
    dropped: number;
    resume: FoldResume;
};
/** 串行化：并发调用共享同一次扫描。 */
export declare function scan(): Promise<ScanResult>;
export {};
