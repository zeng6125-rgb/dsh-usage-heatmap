import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function load(file, internals, overrides = {}, globals = {}, mutate = s => s) {
  const source = mutate(fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8'))
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
  const mod = { exports: {} }
  const keys = Object.keys(globals)
  new Function('require', 'module', 'exports', ...keys, code + '\nmodule.exports.testApi = {' + internals + '};')(
    id => overrides[id] || require(id), mod, mod.exports, ...keys.map(k => globals[k]),
  )
  return mod.exports.testApi
}

test('mtime invalidation mutation is caught by directory membership tests', async () => {
  let stamp = 1, name = 'session.v4.jsonl.zstd'
  const io = { ...fs,
    statSync: () => ({ mtimeMs: stamp, ctimeMs: 1, ino: 1 }),
    readdirSync: () => [{ name, isDirectory: () => false, isFile: () => true }],
  }
  const check = async api => {
    await api.listLogFiles('fixture')
    stamp = 2; name = 'session.v5.jsonl.zstd'
    assert.deepEqual(await api.listLogFiles('fixture'), ['session.v5.jsonl.zstd'])
  }
  await check(load('src/aggregate.ts', 'listLogFiles', { 'node:fs': io }))
  stamp = 1; name = 'session.v4.jsonl.zstd'
  const mutant = load('src/aggregate.ts', 'listLogFiles', { 'node:fs': io }, {}, s => s.replace('hit.mtime === st.mtimeMs', 'true'))
  await assert.rejects(() => check(mutant), { code: 'ERR_ASSERTION' })
})

function directoryFixture() {
  const root = path.resolve('fixture-sessions')
  const dirs = new Map()
  let reads = 0
  const dirent = (name, directory = false) => ({ name, isDirectory: () => directory, isFile: () => !directory })
  const set = (dir, names, stamp = 1, ino = dir) => dirs.set(dir, { entries: names.map(n => dirent(n[0], n[1])), mtimeMs: stamp, ctimeMs: stamp, ino })
  set(root, [['one', true]])
  set(path.join(root, 'one'), [['session.v4.jsonl.zstd'], ['ignore.txt']])
  const io = {
    ...fs,
    statSync(dir) { const d = dirs.get(String(dir)); if (!d) throw new Error('ENOENT'); return d },
    readdirSync(dir) { reads++; const d = dirs.get(String(dir)); if (!d) throw new Error('ENOENT'); return d.entries },
  }
  const api = load('src/aggregate.ts', 'listLogFiles', { 'node:fs': io })
  return { root, dirs, set, api, reads: () => reads }
}

test('unchanged log directories reuse enumeration while returning every log', async () => {
  const f = directoryFixture()
  const first = await f.api.listLogFiles(f.root)
  const reads = f.reads()
  assert.deepEqual(await f.api.listLogFiles(f.root), first)
  assert.equal(first.length, 1)
  assert.equal(f.reads(), reads, 'a cache-hit scan must not re-read unchanged directories')
})

test('cache-hit log enumeration performs no path joins or relative computations', async () => {
  let joins = 0, relatives = 0
  const realPath = require('node:path')
  const spyPath = { ...realPath, join: (...a) => { joins++; return realPath.join(...a) }, relative: (...a) => { relatives++; return realPath.relative(...a) } }
  const root = path.resolve('path-spy-fixture')
  const sub = path.join(root, 'one')
  const dirent = (name, directory) => ({ name, isDirectory: () => directory, isFile: () => !directory })
  const dirs = new Map([
    [root, { entries: [dirent('one', true)], mtimeMs: 1, ctimeMs: 1, ino: root }],
    [sub, { entries: [dirent('session.v4.jsonl.zstd', false)], mtimeMs: 1, ctimeMs: 1, ino: sub }],
  ])
  const io = { ...fs,
    statSync(d) { const x = dirs.get(String(d)); if (!x) throw new Error('ENOENT'); return x },
    readdirSync(d) { const x = dirs.get(String(d)); if (!x) throw new Error('ENOENT'); return x.entries },
  }
  const api = load('src/aggregate.ts', 'listLogFiles', { 'node:fs': io, 'node:path': spyPath })
  const first = await api.listLogFiles(root)
  assert.deepEqual(first, [path.join('one', 'session.v4.jsonl.zstd')])
  joins = 0; relatives = 0
  assert.deepEqual(await api.listLogFiles(root), first)
  assert.equal(joins, 0, 'a memo hit must not join paths again')
  assert.equal(relatives, 0, 'a memo hit must not compute relative paths again')
})

test('directory membership changes reveal new logs and remove deleted logs', async () => {
  const f = directoryFixture()
  await f.api.listLogFiles(f.root)
  f.set(path.join(f.root, 'one'), [['session.v5.jsonl.zstd']], 2)
  assert.deepEqual(await f.api.listLogFiles(f.root), [path.join('one', 'session.v5.jsonl.zstd')])
  f.set(f.root, [['two', true]], 3)
  f.set(path.join(f.root, 'two'), [['session.v4.jsonl.zstd']], 3)
  assert.deepEqual(await f.api.listLogFiles(f.root), [path.join('two', 'session.v4.jsonl.zstd')])
  f.set(f.root, [['one', true]], 4)
  f.set(path.join(f.root, 'one'), [['session.v6.jsonl.zstd']], 2)
  assert.deepEqual(await f.api.listLogFiles(f.root), [path.join('one', 'session.v6.jsonl.zstd')])
})

test('ctime changes invalidate a directory even when its mtime is unchanged', async () => {
  const f = directoryFixture()
  await f.api.listLogFiles(f.root)
  f.set(path.join(f.root, 'one'), [['session.v5.jsonl.zstd']], 1)
  f.dirs.get(path.join(f.root, 'one')).ctimeMs = 2
  assert.deepEqual(await f.api.listLogFiles(f.root), [path.join('one', 'session.v5.jsonl.zstd')])
})

test('missing directories are skipped without leaking memoized logs', async () => {
  const f = directoryFixture()
  await f.api.listLogFiles(f.root)
  f.dirs.delete(path.join(f.root, 'one'))
  assert.deepEqual(await f.api.listLogFiles(f.root), [])
})

test('directory identity invalidates cached members after same-timestamp replacement', async () => {
  const f = directoryFixture()
  await f.api.listLogFiles(f.root)
  f.set(path.join(f.root, 'one'), [['session.v5.jsonl.zstd']], 1, 'replacement')
  assert.deepEqual(await f.api.listLogFiles(f.root), [path.join('one', 'session.v5.jsonl.zstd')])
})

test('unchanged scan reuses derived aggregates instead of recomputing every bucket', async () => {
  // 用 isolated fixture：连续两轮全命中且未跨日，dayTotals/metrics/models/dayModels 必须同引用
  const home = path.resolve('reuse-fixture-home')
  const root = path.join(home, '.dsh', 'sessions')
  const cwd = path.join(root, 'workspace')
  const logDir = path.join(cwd, 'session-one')
  const logFile = path.join(logDir, 'session.v4.jsonl.zstd')
  const dirent = (name, directory) => ({ name, isDirectory: () => directory, isFile: () => !directory })
  const dirs = new Map([
    [root, { entries: [dirent('workspace', true)], mtimeMs: 1, ctimeMs: 1, ino: root }],
    [cwd, { entries: [dirent('session-one', true)], mtimeMs: 1, ctimeMs: 1, ino: cwd }],
    [logDir, { entries: [dirent('session.v4.jsonl.zstd', false)], mtimeMs: 1, ctimeMs: 1, ino: logDir }],
  ])
  const time = new Date(2026, 9, 12, 3).getTime()
  const ev = { type: 'assistant/message', time, data: { turn: 1, step: 1, message: { source: { provider: 'fixture', model: 'model' } }, usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 0 } } }
  const buf = zlib.zstdCompressSync(Buffer.from(JSON.stringify({ type: 'session', id: 'session-one', cwd: 'fixture' }) + '\n' + JSON.stringify(ev) + '\n'))
  const files = new Map([[logFile, { data: buf, mtimeMs: 1 }]])
  const io = { ...fs,
    readdirSync(d) { const x = dirs.get(String(d)); if (!x) throw new Error('ENOENT'); return x.entries },
    statSync(f) { const x = files.get(String(f)) || dirs.get(String(f)); if (!x) throw new Error('ENOENT'); return { mtimeMs: x.mtimeMs, size: x.data ? x.data.length : 0 } },
    readFileSync(f) { const x = files.get(String(f)); if (!x) throw new Error('ENOENT'); return x.data },
    mkdirSync() {}, writeFileSync() {}, renameSync() {},
  }
  const api = load('src/aggregate.ts', 'scan', { 'node:fs': io, 'node:os': { ...os, homedir: () => home } })
  const a = await api.scan()
  const b = await api.scan()
  assert.equal(b.source.decoded, 0, 'second scan is a full cache hit')
  assert.equal(b.dayTotals, a.dayTotals, 'dayTotals reused')
  assert.equal(b.metrics, a.metrics, 'metrics reused')
  assert.equal(b.models, a.models, 'models reused')
  assert.equal(b.dayModels, a.dayModels, 'dayModels reused')
})

test('derived aggregates are recomputed after a data change, never served stale', async () => {
  const home = path.resolve('reuse-change-home')
  const root = path.join(home, '.dsh', 'sessions')
  const cwd = path.join(root, 'workspace')
  const logDir = path.join(cwd, 'session-one')
  const logFile = path.join(logDir, 'session.v4.jsonl.zstd')
  const dirent = (name, directory) => ({ name, isDirectory: () => directory, isFile: () => !directory })
  const dirs = new Map([
    [root, { entries: [dirent('workspace', true)], mtimeMs: 1, ctimeMs: 1, ino: root }],
    [cwd, { entries: [dirent('session-one', true)], mtimeMs: 1, ctimeMs: 1, ino: cwd }],
    [logDir, { entries: [dirent('session.v4.jsonl.zstd', false)], mtimeMs: 1, ctimeMs: 1, ino: logDir }],
  ])
  const time = new Date(2026, 9, 12, 3).getTime()
  const ev = (turn, input) => ({ type: 'assistant/message', time: time + turn, data: { turn, step: 1, message: { source: { provider: 'fixture', model: 'model' } }, usage: { inputTokens: input, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 0 } } })
  const frame = evs => zlib.zstdCompressSync(Buffer.from(evs.map(e => JSON.stringify(e)).join('\n') + '\n'))
  const sessionFrame = zlib.zstdCompressSync(Buffer.from(JSON.stringify({ type: 'session', id: 'session-one', cwd: 'fixture' }) + '\n'))
  const first = Buffer.concat([sessionFrame, frame([ev(1, 10)])])
  const files = new Map([[logFile, { data: first, mtimeMs: 1 }]])
  let stamp = 1
  const io = { ...fs,
    readdirSync(d) { const x = dirs.get(String(d)); if (!x) throw new Error('ENOENT'); return x.entries },
    statSync(f) { const x = files.get(String(f)) || dirs.get(String(f)); if (!x) throw new Error('ENOENT'); return { mtimeMs: x.mtimeMs, size: x.data ? x.data.length : 0 } },
    readFileSync(f) { const x = files.get(String(f)); if (!x) throw new Error('ENOENT'); return x.data },
    mkdirSync() {}, writeFileSync() {}, renameSync() {},
  }
  const api = load('src/aggregate.ts', 'scan', { 'node:fs': io, 'node:os': { ...os, homedir: () => home } })
  const a = await api.scan()
  assert.equal(a.metrics.totalTokens, 15)
  assert.equal((await api.scan()).dayTotals, a.dayTotals, 'hit reuses')
  files.set(logFile, { data: Buffer.concat([first, frame([ev(2, 20)])]), mtimeMs: ++stamp })
  const c = await api.scan()
  assert.equal(c.metrics.totalTokens, 40, 'append is folded')
  assert.notEqual(c.dayTotals, a.dayTotals, 'changed input must not reuse stale derived')
  assert.equal((await api.scan()).dayTotals, c.dayTotals, 'hit reuses the new result')
})

test('projection memo hits avoid fixed-count yields; slow reads still yield', async () => {
  let now = 0, yields = 0, readMs = 0
  const io = {
    ...fs,
    readdirSync: () => Array.from({ length: 12 }, (_, i) => i + '.json'),
    statSync: () => ({ mtimeMs: 1, size: 120 }),
    readFileSync: () => { now += readMs; return '{"identity":{"createdAt":1},"rows":{}}' },
  }
  class Clock extends Date { static now() { return now } }
  const api = load('src/aggregate.ts', 'readProjcache', { 'node:fs': io }, { Date: Clock, setImmediate: callback => { yields++; callback() } })
  assert.equal((await api.readProjcache()).size, 12)
  yields = 0
  assert.equal((await api.readProjcache()).size, 12)
  assert.equal(yields, 0, 'cheap memo hits must not schedule unconditional event-loop yields')
  now = 0; yields = 0; readMs = 10
  const slow = load('src/aggregate.ts', 'readProjcache', { 'node:fs': io }, { Date: Clock, setImmediate: callback => { yields++; callback() } })
  assert.equal((await slow.readProjcache()).size, 12)
  assert.ok(yields > 0, 'expensive projection reads must still let the host event loop run')
})

test('isolated scans detect append, new logs, and deletion without losing daily/model buckets', async () => {
  const home = path.resolve('isolated-fixture-home')
  const root = path.join(home, '.dsh', 'sessions')
  const cwd = path.join(root, 'workspace')
  const logDir = id => path.join(cwd, id)
  const logFile = id => path.join(logDir(id), 'session.v4.jsonl.zstd')
  const dirs = new Map()
  const files = new Map()
  const dirent = (name, directory) => ({ name, isDirectory: () => directory, isFile: () => !directory })
  const setDir = (dir, entries, mtime = 1) => dirs.set(dir, { entries: entries.map(e => dirent(e[0], e[1])), mtimeMs: mtime, ctimeMs: mtime, ino: dir })
  setDir(root, [['workspace', true]])
  setDir(cwd, [['session-one', true]])
  setDir(logDir('session-one'), [['session.v4.jsonl.zstd', false]])
  const time = new Date(2026, 9, 12, 3).getTime()
  // 镜像持久化 writer 的字段顺序：message/source 先于 usage（快路径在 usage 完整后停止）。
  const event = (turn, input) => ({ type: 'assistant/message', time: time + turn, data: { turn, step: 1, message: { source: { provider: 'fixture', model: 'model' } }, usage: { inputTokens: input, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 0 } } })
  const frame = events => zlib.zstdCompressSync(Buffer.from(events.map(e => JSON.stringify(e)).join('\n') + '\n'))
  const first = frame([{ type: 'session', id: 'session-one', cwd: 'fixture' }, event(1, 10)])
  files.set(logFile('session-one'), { data: first, mtimeMs: 1 })
  let stamp = 1
  const io = { ...fs,
    readdirSync(dir) { const d = dirs.get(String(dir)); if (!d) throw new Error('ENOENT'); return d.entries },
    statSync(file) { const f = files.get(String(file)); if (f) return { mtimeMs: f.mtimeMs, size: f.data.length }; const d = dirs.get(String(file)); if (d) return d; throw new Error('ENOENT') },
    readFileSync(file) { const f = files.get(String(file)); if (f) return f.data; throw new Error('ENOENT') },
    mkdirSync() {}, writeFileSync() {}, renameSync() {},
  }
  const api = load('src/aggregate.ts', 'scan, dayKey', { 'node:fs': io, 'node:os': { ...os, homedir: () => home } })
  const check = (result, total, logs, deleted) => {
    assert.equal(result.metrics.totalTokens, total)
    assert.equal(result.dayTotals[api.dayKey(time)], total)
    assert.equal(result.models['fixture/model'].reduce((a,b) => a+b, 0), total)
    assert.equal(result.dayModels[api.dayKey(time)]['fixture/model'].reduce((a,b) => a+b, 0), total)
    assert.equal(result.source.logs, logs)
    assert.equal(result.metrics.deletedSessions, deleted)
  }
  check(await api.scan(), 15, 1, 0)
  const hit = await api.scan()
  check(hit, 15, 1, 0)
  assert.equal(hit.source.decoded, 0)
  const appended = Buffer.concat([first, frame([event(2, 20)])])
  files.set(logFile('session-one'), { data: appended, mtimeMs: ++stamp })
  check(await api.scan(), 40, 1, 0)
  setDir(cwd, [['session-one', true], ['session-two', true]], ++stamp)
  setDir(logDir('session-two'), [['session.v4.jsonl.zstd', false]], stamp)
  files.set(logFile('session-two'), { data: frame([{ type: 'session', id: 'session-two', cwd: 'fixture' }, event(3, 30)]), mtimeMs: stamp })
  check(await api.scan(), 75, 2, 0)
  setDir(cwd, [['session-two', true]], ++stamp)
  dirs.delete(logDir('session-one')); files.delete(logFile('session-one'))
  check(await api.scan(), 75, 1, 1)
})

function clientFixture(fetcher) {
  let now = 100_000
  let interval
  let effect
  const react = { createElement() {}, useState: v => [v, () => {}], useEffect: fn => { effect = fn } }
  const document = { getElementById: () => ({}), visibilityState: 'visible' }
  class Clock extends Date { static now() { return now } }
  const api = load('src/client/index.ts', 'fetchState, usePanelData, getCache: () => _cache', { react }, {
    Date: Clock, fetch: fetcher, document,
    setInterval: fn => { interval = fn; return 1 }, clearInterval() {},
  })
  return { api, advance: ms => { now += ms }, mount: () => { api.usePanelData(); return effect() }, poll: () => interval(), visibility: v => { document.visibilityState = v } }
}
const state = { days: { '2026-10-12': 10 }, metrics: { totalTokens: 10 }, source: { updatedAt: 1 } }
const response = s => ({ ok: true, status: 200, json: async () => structuredClone(s) })

test('unchanged responses renew client TTL without replacing the data reference', async () => {
  let calls = 0
  const f = clientFixture(async () => { calls++; return response(state) })
  const first = await f.api.fetchState()
  f.advance(10_001)
  assert.equal(await f.api.fetchState(), first)
  assert.equal(await f.api.fetchState(), first)
  assert.equal(calls, 2, 'an unchanged response is still a successful cache renewal')
})

test('poll with only freshness telemetry changed reuses the data reference (no whole-panel rerender)', async () => {
  let n = 0
  const f = clientFixture(async () => {
    n++
    const s = structuredClone(state)
    s.updatedAt = 1000 + n * 15_000
    s.source = { logs: 1, cacheHits: 1, scanMs: 10 + n * 3, updatedAt: 1000 + n * 15_000 }
    return response(s)
  })
  const first = await f.api.fetchState(true)
  f.advance(10_001)
  const second = await f.api.fetchState(true)
  assert.equal(second, first, 'only updatedAt changed → bail out')
  assert.equal(n, 2)
})

test('changed payload or source counters replace the data reference', async () => {
  let n = 0
  const f = clientFixture(async () => {
    n++
    const s = structuredClone(state)
    s.days = { '2026-10-12': 10 + n }
    s.source = { logs: n, cacheHits: n, scanMs: 19, updatedAt: 1000 + n * 15_000 }
    return response(s)
  })
  const first = await f.api.fetchState(true)
  f.advance(10_001)
  const second = await f.api.fetchState(true)
  assert.notEqual(second, first, 'real data change must produce a new reference')
  assert.equal(second.days['2026-10-12'], 12)
})

test('a forced refresh waits for a fresh request rather than joining a stale one', async () => {
  const calls = []
  let resolve
  const f = clientFixture(url => { calls.push(url); return calls.length === 1 ? new Promise(r => { resolve = r }) : Promise.resolve(response(state)) })
  const ordinary = f.api.fetchState()
  const forced = f.api.fetchState(true)
  resolve(response(state))
  await Promise.all([ordinary, forced])
  assert.equal(calls.length, 2)
  assert.ok(calls[1].endsWith('?fresh=1'))
})

test('simultaneous forced refreshes coalesce into one request', async () => {
  let calls = 0, resolve
  const f = clientFixture(() => { calls++; return new Promise(r => { resolve = r }) })
  const a = f.api.fetchState(true)
  const b = f.api.fetchState(true)
  assert.equal(a, b)
  resolve(response(state))
  await a
  assert.equal(calls, 1)
})

test('panel polling retrieves fresh scan results in the same response', async () => {
  const calls = []
  const f = clientFixture(async url => { calls.push(url); return response(state) })
  const cleanup = f.mount()
  for (let i = 0; i < 12; i++) await Promise.resolve()
  calls.length = 0
  f.advance(15_000)
  await f.poll()
  for (let i = 0; i < 12; i++) await Promise.resolve()
  assert.equal(calls.length, 1)
  assert.ok(calls[0].endsWith('?fresh=1'), 'polling must not receive stale host SWR and wait another period')
  cleanup()
})

test('hidden panels do not spend scan work on periodic polling', async () => {
  const calls = []
  const f = clientFixture(async url => { calls.push(url); return response(state) })
  const cleanup = f.mount()
  for (let i = 0; i < 12; i++) await Promise.resolve()
  calls.length = 0
  f.visibility('hidden')
  f.advance(15_000)
  await f.poll()
  assert.equal(calls.length, 0)
  cleanup()
})

test('HTTP errors keep the last good state and allow retries', async () => {
  let bad = false
  const f = clientFixture(async () => bad ? { ok: false, status: 500, json: async () => ({ error: 'scan failed' }) } : response(state))
  const good = await f.api.fetchState()
  bad = true
  await assert.rejects(f.api.fetchState(true), /scan failed/)
  assert.equal(f.api.getCache().data, good)
  bad = false
  await f.api.fetchState(true)
})
