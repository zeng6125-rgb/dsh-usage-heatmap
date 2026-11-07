# Spec: 模型计费 + 模型明细（v0.2.0）

## 决策（用户 2026-11-07 拍板）

- 价格来源 = **A 混合**：OpenRouter `/api/v1/models` 后台拉取（失败静默、不阻塞面板）+ pi-ai 内置表离线兜底 + `~/.dsh/storages/usage-heatmap/pricing-overrides.json` 可编辑覆盖表。
- 金额 = **USD 与 CNY 同时展示**；汇率默认 `7.2`，可在覆盖表 `usdCny` 修改。
- 代价：README「插件不发起任何网络请求」改为「仅向 OpenRouter 拉取公开价目表，用量数据始终只在本地」。

## 能力图

| 模块 | 职责 | 依赖 |
|---|---|---|
| pricing | 价格表构建、成本计算（纯函数） | — |
| host-payload | 启动时加载/后台刷新，payload 增 `pricing` | pricing |
| model-detail | 模型卡第三版式「明细」：全量表 + provider 分组 + 成本列 | host-payload |

Build order: pricing → host-payload → model-detail

## 价格源事实（本机实测）

- pi-ai: `<app>/node_modules/@earendil-works/pi-ai/dist/providers/data/*.json`，43 文件 / 1712 模型 / 1540 有价；`cost` = USD per 1M tokens，字段 `input/output/cacheRead/cacheWrite`，可选 `tiers[]`。
- OpenRouter: `https://openrouter.ai/api/v1/models` → `data[].pricing.{prompt,completion,input_cache_read,input_cache_write}`，单位 USD/token（×1e6 对齐 pi-ai）。
- 日志 usage 只有四桶 `[uncachedInput, output, cacheRead, cacheWrite]`，**无金额**；`cacheWriteTokens` 常缺失按 0。
- 本机自定义路由（qwen / jyld2 / Qwen3.8-Max / tr-alpha-channel）不在任何 catalog → 必须由覆盖表填价，否则显示「未定价」，**不按 0 计**。

## 契约

```ts
// src/pricing.ts
export interface Rates { input: number; output: number; cacheRead: number; cacheWrite: number } // USD / 1M tokens
export interface PriceEntry { rates: Rates; source: 'override' | 'pi-ai' | 'openrouter' }
export interface PricingTable {
  usdCny: number
  entries: Record<string, PriceEntry>          // key = normalizeModelKey(全名或裸 model)
  sources: { piAi: number; openrouter: number; overrides: number }
}
export type Buckets = [number, number, number, number]  // [uncachedInput, output, cacheRead, cacheWrite]

export function normalizeModelKey(s: string): string          // 小写 + 只留 [a-z0-9]
export function loadLocalPricing(): PricingTable              // pi-ai + overrides（同步，缺源返回空表）
export function mergeOpenRouter(table: PricingTable, json: unknown): PricingTable  // 纯函数；缺字段跳过该模型
export function costOf(rates: Rates, b: Buckets): number      // USD
export function buildModelPricing(models: Record<string, Buckets>, table: PricingTable): ModelPricing

export interface ModelPricing {
  usdCny: number
  totalUsd: number          // 已定价模型成本合计
  pricedTokens: number      // 已定价模型 token 合计
  unpricedTokens: number    // 未定价模型 token 合计（含 mMiss 口径外部分不计）
  models: Record<string, { usd: number; cny: number; priced: boolean; source: string }>
  byProvider: Record<string, { tokens: number; usd: number; cny: number; models: number }>
}
```

- 成本公式：`(input*b0 + output*b1 + cacheRead*b2 + cacheWrite*b3) / 1e6`，与 pi-ai `calculateCost` 同口径（不做 1h cache write 双倍，本机无该字段）。
- `priced` = rates 至少有任一非零；全零视为未定价。
- 匹配顺序：覆盖表（全名 → 裸名）→ pi-ai（id/name 归一化精确，再取最短包含）→ OpenRouter（id 归一化精确，再后缀）→ unpriced。
- provider 分组：`provider/model` 取 `/` 前；无 `/` 归「其他」。
- payload: `pricing = buildModelPricing(r.models, table)`，**不改 aggregate 的缓存口径 / MODELS_V、不重扫日志**。

## 界面

- 模型卡 `.uh-seg` 增第三个按钮「明细」，顺序：按日期 / 按模型 / 明细（默认仍按日期）。
- 明细版式：全模型表格（不再 top8 + 其他），列 = 模型 / 输入 / 输出 / 缓存读 / 缓存写 / 合计 / 占比 / 成本（`$x.xx · ¥y.yy`）。
- 按 provider 分组：组头显示组名 + 模型数 + 组小计 token + 组成本，可折叠；表头 sticky。
- 排序：点表头切「按 token / 按成本」降序。
- 未定价行成本列显示「未定价」（tertiary 灰），汇总行写「已定价 X / 共 Y 个模型 · 未定价部分 Z tokens 不计入金额」。
- 汇总条：面板顶部显示总成本 `USD · CNY` + 汇率来源 + 「价目表：pi-ai N / OpenRouter M / 自定义 K · 更新于 …」。
- 沿用既有 `uh-*` 设计系统（细分隔线、tabular-nums、分组色条、hover 高亮），不改其它卡片视觉。

## 边界

- Always: `npm test` 全绿 + typecheck + host/client 构建 + 3080 探针截图验收 + 发版前确认 `sum(days)==totalTokens`。
- Ask first: 无（本规格已授权）。
- Never: 不读 `llm-headers`/任何密钥；不碰 3081；不改 aggregate 缓存口径；不把未定价算成 0；不在 UI 里显示 API key。

## 验证

- `tests/pricing.test.mjs`：已知价格字面量算成本（非 tautology）、未定价不计费、汇率换算、OpenRouter 单位换算、缺字段容错、分组小计。
- `npm test` 全绿；`npm run typecheck` 0 错；`npx tsc -p tsconfig.json` + `npm run build:client`；`dev_reload_package` [active]。
- 浏览器探针（headless Edge，只访问 127.0.0.1:3080）截明细版式；`sum(days)==totalTokens` HTTP 校验。
- 发版 0.2.0：GitHub Release + npm，README 更新网络说明与截图。

## 已知取舍

- OpenRouter 拉取失败/离线时自动退化为 pi-ai + 覆盖表，面板显示来源计数。
- 免费/未定价模型不会凭空产生金额；差额行继续诚实披露无模型明细部分（与成本无关）。
- 阶梯价 `tiers[]` 本期不实现：本机日志无对应字段，加了也无可验证数据（勿过度搭建）。
