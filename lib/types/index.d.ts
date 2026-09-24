/**
 * @dsh-external/dsh-usage-heatmap — 模型用量统计面板（ui-panel 形态）。
 * host 侧：/api 前缀路由（SWR 状态）+ 汇总工具；client 侧：settings.section 面板。
 * 数据：src/aggregate.ts 解码耐久会话日志 + 孤儿投影缓存，按本地日聚合。
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
export declare const name = "@dsh-external/dsh-usage-heatmap";
export declare const inject: string[];
export interface Config {
    title: string;
}
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    title: z<string, string, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    title: z<string, string, "defined">;
}>>, "plain">;
export declare function apply(ctx0: Context, config: Config): void;
