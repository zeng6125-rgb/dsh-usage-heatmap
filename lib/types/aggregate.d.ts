/** 一个会话某天的分桶：[uncachedInput, output, cacheRead, cacheWrite] */
export type DayBuckets = Record<string, [number, number, number, number]>;
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
    turns: number;
    steps: number;
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
interface FoldedSession {
    id: string;
    cwd: string;
    title: string;
    first: number;
    last: number;
    days: DayBuckets;
    turns: number;
    steps: number;
}
/**
 * 整段文本折叠（先 split 再逐行进状态机）。**不在扫描主路径上**，但**不是死代码**：
 * tools/byte-equiv.mjs 用它做「整段折叠 == 流式折叠」的交叉验证锚点。保留导出与语义。
 */
export declare function foldSessionLines(text: string): FoldedSession;
/**
 * 逐帧折叠驱动：解码/折叠是同步 CPU 工作，按 sliceMs 时间片在帧之间**与行之间**主动让出
 * （yield 一次），调用方 await 一次 setImmediate 即可把控制权还给宿主事件循环。
 * 单帧 zstd 解码不可分割，故阻塞上限 ≈ 最大单帧解码耗时（本机实测 388ms / 11.7MB）；
 * 帧内按行让出，使 19MB / 8952 帧这类大文件不会一次同步跑满数秒（历史实测单次阻塞 3.2s）。
 * 时间片判定放在生成器内：只有真正到期才 yield，避免每行都产生一次 Promise。
 */
export declare function foldZstdSessionSteps(buf: Buffer, sliceMs?: number): Generator<void, {
    folded: FoldedSession;
    dropped: number;
}, void>;
/**
 * 流式折叠：逐帧解码 → 按 '\n' 切行（跨帧 carry）→ 逐行折叠。
 * 与 decodeZstdJsonl + foldSessionLines 的结果逐字节等价（81 文件实测零差异），
 * 但不构造整段 JSONL 文本、不 concat 大 Buffer，峰值内存与 GC 压力显著下降。
 */
export declare function foldZstdSession(buf: Buffer): {
    folded: FoldedSession;
    dropped: number;
};
/** 串行化：并发调用共享同一次扫描。 */
export declare function scan(): Promise<ScanResult>;
export {};
