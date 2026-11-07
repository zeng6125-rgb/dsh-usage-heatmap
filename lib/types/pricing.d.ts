export type Buckets = [number, number, number, number];
export interface Rates {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
}
export interface PriceEntry {
    rates: Rates;
    source: 'override' | 'pi-ai' | 'openrouter';
}
export interface PricingTable {
    usdCny: number;
    entries: Record<string, PriceEntry>;
    sources: {
        piAi: number;
        openrouter: number;
        overrides: number;
    };
}
export interface ModelCost {
    usd: number;
    cny: number;
    priced: boolean;
    source: string;
    /** 命中的四桶单价（USD/百万 token），供明细行悬停核对算式；未定价为 undefined */
    rates?: Rates;
    /** 该模型四桶 token 原始值，配合 rates 可复算金额 */
    buckets?: Buckets;
}
export interface ProviderCost {
    tokens: number;
    usd: number;
    cny: number;
    models: number;
}
export interface ModelPricing {
    usdCny: number;
    totalUsd: number;
    totalCny: number;
    pricedTokens: number;
    unpricedTokens: number;
    tableSources: {
        piAi: number;
        openrouter: number;
        overrides: number;
    };
    models: Record<string, ModelCost>;
    byProvider: Record<string, ProviderCost>;
}
/** 归一化匹配键：小写 + 只保留字母数字（去 provider 前缀歧义、连字符、点号） */
export declare function normalizeModelKey(s: string): string;
/** 同步加载：pi-ai 内置表 + 用户覆盖表。任何源缺失/损坏都退化为「其余源照常」。 */
export declare function loadLocalPricing(): PricingTable;
/** OpenRouter /api/v1/models 响应合并：USD/token 字符串 ×1e6；只填空缺，不覆盖已有价。 */
export declare function mergeOpenRouter(table: PricingTable, json: unknown): PricingTable;
/** 后台刷新：失败（离线/超时）静默保留本地表，绝不阻塞面板；失败重试一次，避免启动瞬时抖动导致本轮无 OpenRouter 价。 */
export declare function refreshPricing(): Promise<PricingTable>;
export declare function costOf(rates: Rates, b: Buckets): number;
/** 由逐模型四桶生成成本视图；不改缓存口径、不重扫日志。 */
export declare function buildModelPricing(models: Record<string, Buckets>, table: PricingTable): ModelPricing;
