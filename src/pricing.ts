/**
 * 模型计费价格表与成本计算（纯函数层）。
 *
 * 价格口径：USD / 1,000,000 tokens，四桶 [uncachedInput, output, cacheRead, cacheWrite]，
 * 与 pi-ai `calculateCost` 一致（本期不做 1h cache write 双倍——本机日志无该字段）。
 * 日志 usage 只有四桶、无金额；未定价模型显示「未定价」且不计入金额，绝不按 0 计。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type Buckets = [number, number, number, number]
export interface Rates { input: number; output: number; cacheRead: number; cacheWrite: number }
export interface PriceEntry { rates: Rates; source: 'override' | 'pi-ai' | 'openrouter' }
export interface PricingTable {
  usdCny: number
  entries: Record<string, PriceEntry>
  sources: { piAi: number; openrouter: number; overrides: number }
}
export interface ModelCost { usd: number; cny: number; priced: boolean; source: string }
export interface ProviderCost { tokens: number; usd: number; cny: number; models: number }
export interface ModelPricing {
  usdCny: number
  totalUsd: number
  totalCny: number
  pricedTokens: number
  unpricedTokens: number
  tableSources: { piAi: number; openrouter: number; overrides: number }
  models: Record<string, ModelCost>
  byProvider: Record<string, ProviderCost>
}

const overrideFile = (): string => path.join(os.homedir(), '.dsh', 'storages', 'usage-heatmap', 'pricing-overrides.json')
const piAiDataDir = (): string => process.env.DSH_APP_ROOT
  ? path.join(process.env.DSH_APP_ROOT, '@earendil-works', 'pi-ai', 'dist', 'providers', 'data')
  : path.join(os.homedir(), 'AppData', 'Local', 'DSH Desktop Rust', 'resources', 'app', 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'providers', 'data')

const isRates = (v: any): v is Rates => v && typeof v === 'object' &&
  [v.input, v.output, v.cacheRead, v.cacheWrite].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0)

/** 归一化匹配键：小写 + 只保留字母数字（去 provider 前缀歧义、连字符、点号） */
export function normalizeModelKey(s: string): string {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function put(table: PricingTable, key: string, rates: Rates, source: PriceEntry['source']): void {
  const k = normalizeModelKey(key)
  if (k) table.entries[k] = { rates, source }
}

/** 同步加载：pi-ai 内置表 + 用户覆盖表。任何源缺失/损坏都退化为「其余源照常」。 */
export function loadLocalPricing(): PricingTable {
  const table: PricingTable = {
    usdCny: 7.2,
    entries: {},
    sources: { piAi: 0, openrouter: 0, overrides: 0 },
  }

  const dir = piAiDataDir()
  try {
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue
      const j = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
      for (const api of Object.values(j) as any[]) {
        if (!api || typeof api !== 'object') continue
        for (const m of Object.values(api) as any[]) {
          if (!m || !isRates(m.cost)) continue
          // 全零 = 未定价，不写入（避免把 catalog 里的免费/占位条目当价格）
          if (!(m.cost.input || m.cost.output || m.cost.cacheRead || m.cost.cacheWrite)) continue
          put(table, m.id || '', m.cost, 'pi-ai')
          if (m.name && m.name !== m.id) put(table, m.name, m.cost, 'pi-ai')
          table.sources.piAi++
        }
      }
    }
  } catch { /* 目录不存在：跳过 */ }

  try {
    const j = JSON.parse(fs.readFileSync(overrideFile(), 'utf8'))
    if (typeof j.usdCny === 'number' && j.usdCny > 0) table.usdCny = j.usdCny
    if (j.models && typeof j.models === 'object') {
      for (const [name, rates] of Object.entries(j.models)) {
        if (!isRates(rates)) continue
        put(table, name, rates, 'override')
        table.sources.overrides++
      }
    }
  } catch { /* 无覆盖表：用默认值 */ }

  return table
}

/** OpenRouter /api/v1/models 响应合并：USD/token 字符串 ×1e6；只填空缺，不覆盖已有价。 */
export function mergeOpenRouter(table: PricingTable, json: unknown): PricingTable {
  const data = (json as any)?.data
  if (!Array.isArray(data)) return table
  for (const m of data) {
    const p = m?.pricing
    if (!p || typeof p !== 'object') continue
    const num = (v: any): number => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n * 1e6 : 0 }
    const rates: Rates = {
      input: num(p.prompt), output: num(p.completion),
      cacheRead: num(p.input_cache_read), cacheWrite: num(p.input_cache_write),
    }
    if (!(rates.input || rates.output || rates.cacheRead || rates.cacheWrite)) continue
    const k = normalizeModelKey(m.id || '')
    if (!k) continue
    // 同时按 id 全名与裸名（去 provider 前缀）探测；任一已有价就跳过，避免覆盖本地/覆盖表权威价
    const bare = String(m.id || '').split('/').pop() || ''
    const kb = bare && bare !== m.id ? normalizeModelKey(bare) : ''
    if (table.entries[k] || (kb && table.entries[kb])) continue
    put(table, m.id, rates, 'openrouter')
    if (kb) put(table, bare, rates, 'openrouter')
    table.sources.openrouter++
  }
  return table
}

/** 后台刷新：失败（离线/超时）静默保留本地表，绝不阻塞面板。 */
export async function refreshPricing(): Promise<PricingTable> {
  const table = loadLocalPricing()
  try {
    const r = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(8000) })
    if (r.ok) mergeOpenRouter(table, await r.json())
  } catch { /* 离线：pi-ai + 覆盖表照常 */ }
  return table
}

export function costOf(rates: Rates, b: Buckets): number {
  return (rates.input * b[0] + rates.output * b[1] + rates.cacheRead * b[2] + rates.cacheWrite * b[3]) / 1e6
}

function lookup(table: PricingTable, fullName: string): PriceEntry | undefined {
  const exact = table.entries[normalizeModelKey(fullName)]
  if (exact) return exact
  const bare = fullName.includes('/') ? fullName.slice(fullName.indexOf('/') + 1) : ''
  return bare ? table.entries[normalizeModelKey(bare)] : undefined
}

/** 由逐模型四桶生成成本视图；不改缓存口径、不重扫日志。 */
export function buildModelPricing(models: Record<string, Buckets>, table: PricingTable): ModelPricing {
  const out: ModelPricing = {
    usdCny: table.usdCny,
    totalUsd: 0, totalCny: 0,
    pricedTokens: 0, unpricedTokens: 0,
    tableSources: { ...table.sources },
    models: {}, byProvider: {},
  }
  for (const name of Object.keys(models)) {
    const b = models[name]
    const tokens = b[0] + b[1] + b[2] + b[3]
    const entry = lookup(table, name)
    const priced = !!entry && (entry.rates.input || entry.rates.output || entry.rates.cacheRead || entry.rates.cacheWrite) > 0
    const usd = priced ? costOf(entry!.rates, b) : 0
    const cny = usd * table.usdCny
    out.models[name] = { usd, cny, priced, source: entry?.source || 'unpriced' }
    out.totalUsd += usd
    if (priced) out.pricedTokens += tokens
    else out.unpricedTokens += tokens

    const provider = name.includes('/') ? name.slice(0, name.indexOf('/')) : '其他'
    const g = (out.byProvider[provider] ??= { tokens: 0, usd: 0, cny: 0, models: 0 })
    g.tokens += tokens
    g.usd += usd
    g.cny += cny
    g.models++
  }
  out.totalCny = out.totalUsd * table.usdCny
  return out
}
