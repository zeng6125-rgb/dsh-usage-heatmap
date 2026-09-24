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
/** 逐帧解出完整 JSONL 文本；损坏/撕裂帧跳过并计数（下次扫描再收敛）。 */
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
export declare function foldSessionLines(text: string): FoldedSession;
/** 串行化：并发调用共享同一次扫描。 */
export declare function scan(): Promise<ScanResult>;
export {};
