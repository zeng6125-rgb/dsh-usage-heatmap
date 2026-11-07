import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)

/** 与 performance.test.mjs 相同的转译注入加载器；globals 注入可替换 node:fs / node:os / fetch */
function load(file, internals, overrides = {}, globals = {}) {
  const source = fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
  const mod = { exports: {} }
  const keys = Object.keys(globals)
  new Function('require', 'module', 'exports', ...keys, code + '\nmodule.exports.testApi = {' + internals + '};')(
    id => overrides[id] || require(id), mod, mod.exports, ...keys.map(k => globals[k]),
  )
  return mod.exports.testApi
}

/** 最小 pi-ai 目录 + 覆盖表（不触碰真实 ~/.dsh）；env 在模块加载前定型 */
function fixture({ piAi = {}, overrides = {}, openRouter = null } = {}) {
  const home = path.join(os.tmpdir(), 'uh-pricing-fixture-' + Math.random().toString(36).slice(2))
  const dataDir = path.join(home, 'app', 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'providers', 'data')
  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(path.join(dataDir, 'deepseek.json'), JSON.stringify({ 'openai-completions': piAi }))
  const overrideFile = path.join(home, '.dsh', 'storages', 'usage-heatmap', 'pricing-overrides.json')
  fs.mkdirSync(path.dirname(overrideFile), { recursive: true })
  fs.writeFileSync(overrideFile, JSON.stringify(overrides))
  const fetchImpl = openRouter === null ? async () => { throw new Error('offline') } : async () => ({ ok: true, json: async () => openRouter })
  // PI_AI_DATA / OVERRIDE_FILE 现在惰性求值：注入 os.homedir 即可隔离 fixture
  process.env.DSH_APP_ROOT = path.join(home, 'app', 'node_modules')
  const fakeOs = { ...os, homedir: () => home }
  const api = load('src/pricing.ts', 'loadLocalPricing, mergeOpenRouter, buildModelPricing, costOf, normalizeModelKey, refreshPricing', {
    'node:os': fakeOs,
  }, { fetch: fetchImpl })
  return { api, home, overrideFile, cleanup: () => fs.rmSync(home, { recursive: true, force: true }) }
}

const R = (input, output, cacheRead, cacheWrite) => ({ input, output, cacheRead, cacheWrite })

test('costOf: USD per 1M tokens, four buckets, no hidden totalTokens inference', () => {
  const { api, cleanup } = fixture()
  // 1M input @ $3 + 1M output @ $15 + 2M cacheRead @ $0.3 + 1M cacheWrite @ $3.75 = 3+15+0.6+3.75 = 22.35
  assert.equal(api.costOf(R(3, 15, 0.3, 3.75), [1e6, 1e6, 2e6, 1e6]), 22.35)
  cleanup()
})

test('normalizeModelKey: lowercase, strips punctuation, keeps provider path shape via alnum only', () => {
  const { api, cleanup } = fixture()
  assert.equal(api.normalizeModelKey('DeepSeek-V4.1-Flash'), 'deepseekv41flash')
  assert.equal(api.normalizeModelKey('qwen/Qwen3.8-Max'), 'qwenqwen38max')
  assert.equal(api.normalizeModelKey('  open-code / space-bunny-free '), 'opencodespacebunnyfree')
  cleanup()
})

test('loadLocalPricing: reads pi-ai rates and honors override precedence + usdCny', () => {
  const { api, cleanup } = fixture({
    piAi: {
      'chat:deepseek-flash': { id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash', cost: R(0.3, 1.2, 0.006, 0) },
    },
    overrides: {
      usdCny: 7.3,
      models: { 'deepseek-flash': R(1, 2, 0.1, 0.5), 'my/custom-model': R(2, 4, 0.2, 1) },
    },
  })
  const t = api.loadLocalPricing()
  assert.equal(t.usdCny, 7.3)
  assert.deepEqual(t.entries.deepseekflash.rates, R(1, 2, 0.1, 0.5))
  assert.equal(t.entries.deepseekflash.source, 'override')
  assert.equal(t.entries.mycustommodel.source, 'override')
  assert.equal(t.sources.piAi, 1)
  assert.equal(t.sources.overrides, 2)
  cleanup()
})

test('mergeOpenRouter: USD/token strings ×1e6, only fills gaps, skips malformed', () => {
  const { api, cleanup } = fixture({
    piAi: { 'chat:deepseek-flash': { id: 'deepseek-flash', cost: R(0.3, 1.2, 0.006, 0) } },
  })
  const t = api.loadLocalPricing()
  const merged = api.mergeOpenRouter(t, { data: [
    { id: 'deepseek/deepseek-flash', pricing: { prompt: '0.000003', completion: '0.000015', input_cache_read: '0.0000003', input_cache_write: '0.000003' } },
    { id: 'meta-llama/llama-free', pricing: { prompt: '0', completion: '0', input_cache_read: '0', input_cache_write: '0' } },
    { id: 'broken', pricing: null },
    { id: 'no-pricing' },
  ] })
  // 已有 pi-ai 价格不被 OpenRouter 覆盖
  assert.deepEqual(merged.entries.deepseekflash.rates, R(0.3, 1.2, 0.006, 0))
  // 全零价模型不写入（免费/占位不算价格）
  assert.equal(merged.entries.metallamallamafree, undefined)
  assert.equal(merged.sources.openrouter, 0)
  // 有效新模型 ×1e6：0.000003 → 3 USD/1M
  const t2 = api.mergeOpenRouter(api.loadLocalPricing(), { data: [
    { id: 'meta-llama/llama-3', pricing: { prompt: '0.000003', completion: '0.000015', input_cache_read: '0.0000003', input_cache_write: '0.000003' } },
  ] })
  assert.deepEqual(t2.entries.metallamallama3.rates, R(3, 15, 0.3, 3))
  assert.equal(t2.sources.openrouter, 1)
  cleanup()
})

test('buildModelPricing: priced totals, unpriced never counted as $0, provider grouping', () => {
  const { api, cleanup } = fixture({
    overrides: { usdCny: 7.2, models: {
      'deepseek-official/deepseek-flash': R(1, 2, 0.1, 0),
      'qwen/qwen-max': R(2, 4, 0.2, 0),
    } },
  })
  const t = api.loadLocalPricing()
  const models = {
    'deepseek-official/deepseek-flash': [1e6, 1e6, 0, 0],   // 1 + 2 = $3
    'qwen/qwen-max': [1e6, 0, 0, 0],                          // 2 = $2
    'jyld2/tr-alpha-channel': [9e6, 0, 0, 0],                 // 未定价
  }
  const p = api.buildModelPricing(models, t)
  assert.equal(p.totalUsd, 5)
  assert.equal(p.totalCny, 36)
  assert.equal(p.pricedTokens, 3e6)
  assert.equal(p.unpricedTokens, 9e6)
  assert.equal(p.models['deepseek-official/deepseek-flash'].usd, 3)
  assert.equal(p.models['jyld2/tr-alpha-channel'].priced, false)
  assert.equal(p.byProvider['deepseek-official'].usd, 3)
  assert.equal(p.byProvider.qwen.usd, 2)
  assert.equal(p.byProvider.jyld2.models, 1)
  assert.equal(p.byProvider.jyld2.usd, 0)
  cleanup()
})

test('refreshPricing: offline keeps local table and reports zero openrouter count', async () => {
  const { api, cleanup } = fixture({ openRouter: null })
  const t = await api.refreshPricing()
  assert.equal(t.sources.openrouter, 0)
  assert.equal(typeof t.usdCny, 'number')
  cleanup()
})

test('buildModelPricing: priced rows carry rates and buckets so the cost formula is auditable', () => {
  const { api, cleanup } = fixture({
    overrides: { usdCny: 7.2, models: { 'p/model-x': R(1, 2, 0.1, 0.5) } },
  })
  const t = api.loadLocalPricing()
  const buckets = [1e6, 2e6, 3e6, 4e6]
  const p = api.buildModelPricing({ 'p/model-x': buckets }, t)
  const c = p.models['p/model-x']
  assert.equal(c.priced, true)
  assert.deepEqual(c.rates, R(1, 2, 0.1, 0.5))
  assert.deepEqual(c.buckets, buckets)
  // 逐桶复算：1*1 + 2*2 + 0.1*3 + 0.5*4 = 7.3 USD
  assert.equal(c.usd, 7.3)
  assert.equal(p.models['p/model-x'].cny, 7.3 * 7.2)
  cleanup()
})

test('buildModelPricing: unpriced rows expose no rates (never a fake 0-price formula)', () => {
  const { api, cleanup } = fixture()
  const p = api.buildModelPricing({ 'custom/unknown': [1e6, 0, 0, 0] }, api.loadLocalPricing())
  const c = p.models['custom/unknown']
  assert.equal(c.priced, false)
  assert.equal(c.rates, undefined)
  assert.equal(c.buckets, undefined)
  assert.equal(c.usd, 0)
  cleanup()
})
