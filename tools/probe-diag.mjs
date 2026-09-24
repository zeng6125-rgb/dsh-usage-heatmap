// 诊断探针：① projcache identity 字段（找子代理标识）② 日志 header/首事件字段
// ③ 全量 projcache totals 求和 vs 面板口径 ④ sessions 目录规模
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const HOME = os.homedir()
const PROJ = path.join(HOME, '.dsh', 'storages', 'session_projcache', 'sessions')
const ROOT = path.join(HOME, '.dsh', 'sessions')

// ---- ① projcache ----
let files = []
try { files = fs.readdirSync(PROJ).filter(f => f.endsWith('.json')) } catch (e) { console.log('PROJ ERR', e.message) }
console.log('projcache files:', files.length)

const identityKeys = new Set()
const samples = []
let sumTotals = [0, 0, 0, 0]
let withTotals = 0
const idList = []
for (const f of files) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(PROJ, f), 'utf8'))
    const rec = j.record ?? j
    const id = rec.identity ?? {}
    Object.keys(id).forEach(k => identityKeys.add(k))
    idList.push({ file: f, id })
    const t = rec.rows?.tokenUsage?.val?.totals
    if (t) {
      withTotals++
      sumTotals[0] += Number(t.uncachedInputTokens) || 0
      sumTotals[1] += Number(t.outputTokens) || 0
      sumTotals[2] += Number(t.cacheReadTokens) || 0
      sumTotals[3] += Number(t.cacheWriteTokens) || 0
    }
    if (samples.length < 3) samples.push({ file: f, identity: id, rowKeys: Object.keys(rec.rows ?? {}) })
  } catch {}
}
console.log('identity keys:', [...identityKeys].join(', '))
console.log('samples:', JSON.stringify(samples, null, 2).slice(0, 3000))
console.log('projcache totals sum [uncachedIn, out, cacheRead, cacheWrite]:', sumTotals, '=', sumTotals.reduce((a, b) => a + b, 0))
console.log('withTotals:', withTotals)

// ---- ② sessions 日志树 ----
const logRe = /^session\.v\d+\.jsonl\.zstd$/
let logs = []
const walk = d => {
  let ents
  try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.isFile() && logRe.test(e.name)) logs.push(p)
  }
}
walk(ROOT)
console.log('session logs:', logs.length)

// 抽 2 个日志读 header + 前若干事件的 type，找子代理/parent 标识
for (const p of logs.slice(0, 2)) {
  const buf = fs.readFileSync(p)
  // 简易多帧解码（复用 zlib 单帧限制 → 用自写帧头? 这里直接尝试全解再截断）
  const zlib = await import('node:zlib')
  let text = ''
  try { text = zlib.zstdDecompressSync(buf).toString('utf8') } catch { text = '<decode fail>' }
  const lines = text.split('\n').filter(Boolean).slice(0, 12)
  console.log('--- log', path.relative(ROOT, p))
  for (const l of lines) {
    try {
      const ev = JSON.parse(l)
      const brief = { type: ev.type, id: ev.id, cwd: ev.cwd, data: typeof ev.data === 'object' && ev.data ? Object.keys(ev.data).slice(0, 12) : ev.data }
      console.log(JSON.stringify(brief).slice(0, 400))
    } catch {}
  }
}

// ---- ③ 目录名形态（子代理可能有命名约定） ----
const relDirs = []
const walkDirs = d => {
  let ents
  try { ents = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    if (e.isDirectory()) { relDirs.push(path.relative(ROOT, path.join(d, e.name))); walkDirs(path.join(d, e.name)) }
  }
}
walkDirs(ROOT)
console.log('dirs sample:', relDirs.slice(0, 20))

// ---- ④ projcache id 与 log id 差集 ----
const logBare = new Set(logs.map(p => path.basename(path.dirname(p)).replace(/^session-/, '')))
const projBare = files.map(f => f.replace(/\.json$/, '').replace(/^session-/, ''))
const projOnly = projBare.filter(id => !logBare.has(id))
const logOnly = logBare.size - projBare.filter(id => logBare.has(id)).length
console.log('projcache without log (true orphans):', projOnly)
console.log('logs without projcache count:', logOnly)
