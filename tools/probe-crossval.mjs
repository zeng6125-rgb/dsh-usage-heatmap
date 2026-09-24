// Probe: cross-validate projcache totals vs folded log daily totals over ALL sessions.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'

const home = os.homedir()
const pcDir = path.join(home, '.dsh', 'storages', 'session_projcache', 'sessions')
const sessRoot = path.join(home, '.dsh', 'sessions')

// ---- projcache ----
const projs = new Map()
for (const f of fs.readdirSync(pcDir)) {
  if (!f.endsWith('.json')) continue
  try {
    const j = JSON.parse(fs.readFileSync(path.join(pcDir, f), 'utf8'))
    const rec = j.record || j
    const id = f.replace(/\.json$/, '')
    projs.set(id, {
      createdAt: rec.identity?.createdAt,
      mtime: fs.statSync(path.join(pcDir, f)).mtimeMs,
      totals: rec.rows?.tokenUsage?.val?.totals,
      stats: rec.rows?.sessionStats?.val,
      title: rec.rows?.title?.val,
    })
  } catch (e) { console.log('proj parse fail', f, e.message) }
}
console.log('projcache sessions:', projs.size)

// ---- logs ----
const logs = []
function walk(dir) {
  let ents
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name === 'session.v4.jsonl.zstd') logs.push(p)
  }
}
walk(sessRoot)
console.log('log files:', logs.length)

function splitFrames(buf) {
  const frames = []
  let off = 0
  while (off + 4 <= buf.length) {
    const magic = buf.readUInt32LE(off)
    if (magic >= 0x184d2a50 && magic <= 0x184d2a5f) { off += 8 + buf.readUInt32LE(off + 4); continue }
    if (magic !== 0xfd2fb528) throw new Error(`bad magic at ${off}`)
    let p = off + 4
    const fhd = buf[p]; p++
    const fcsFlag = fhd >> 6, single = (fhd >> 5) & 1, checksum = (fhd >> 2) & 1, dictId = fhd & 3
    p += [0, 1, 2, 4][dictId]
    if (!single) p += 1
    p += fcsFlag === 0 ? (single ? 1 : 0) : fcsFlag === 1 ? 2 : fcsFlag === 2 ? 4 : 8
    let last = false
    while (!last) {
      const bh = buf.readUIntLE(p, 3); p += 3
      last = !!(bh & 1)
      const type = (bh >>> 1) & 0x3, size = bh >>> 3
      p += type === 1 ? 1 : size
    }
    if (checksum) p += 4
    frames.push({ start: off, end: p })
    off = p
  }
  return frames
}

function decodeFile(f) {
  const raw = fs.readFileSync(f)
  let out = ''
  for (const fr of splitFrames(raw)) out += zlib.zstdDecompressSync(raw.subarray(fr.start, fr.end)).toString('utf8')
  return out.split('\n').filter(Boolean)
}

function localDay(ms) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const bucketsFrom = (u) => ({
  uncachedInputTokens: u.inputTokens,
  outputTokens: u.outputTokens,
  cacheReadTokens: u.cacheReadTokens ?? 0,
  cacheWriteTokens: u.cacheWriteTokens ?? 0,
})
const eq = (a, b) => a.uncachedInputTokens === b.uncachedInputTokens && a.outputTokens === b.outputTokens && a.cacheReadTokens === b.cacheReadTokens && a.cacheWriteTokens === b.cacheWriteTokens

function lastStreamUsage(stream) {
  if (!Array.isArray(stream)) return undefined
  for (let i = stream.length - 1; i >= 0; i--) {
    const c = stream[i]?.chunk
    if (c && c.usage !== undefined) return c.usage
  }
  return undefined
}
function usageOf(ev) {
  if (ev.type === 'assistant/message' && ev.data?.usage !== undefined) return ev.data.usage
  if (ev.type !== 'assistant/message' && ev.type !== 'assistant/attempt') return undefined
  return lastStreamUsage(ev.data?.stream)
}

const globalDays = {}
const perSession = []
let decodeErrors = 0
let parseErrors = 0
const t0 = Date.now()
for (const f of logs) {
  let lines
  try { lines = decodeFile(f) } catch (e) { decodeErrors++; console.log('decode fail', f, e.message); continue }
  let header = null, last = null, firstTime = Infinity, lastTime = 0
  const days = {}
  let events = 0, turns = new Set(), steps = 0
  for (const line of lines) {
    let ev
    try { ev = JSON.parse(line) } catch { parseErrors++; continue }
    events++
    if (ev.type === 'session') { header = ev; continue }
    if (typeof ev.time === 'number') {
      if (ev.time < firstTime) firstTime = ev.time
      if (ev.time > lastTime) lastTime = ev.time
    }
    if (ev.type === 'turn/start') turns.add(ev.data?.turn)
    if (ev.type === 'step/end') steps++
    if (ev.type === 'llm/retry-started' && last && last.turn === ev.data?.turn && last.step === ev.data?.step) { last = null; continue }
    if (ev.type !== 'assistant/message' && ev.type !== 'assistant/attempt') continue
    const sample = usageOf(ev)
    if (sample === undefined) continue
    const day = typeof ev.time === 'number' ? localDay(ev.time) : null
    if (day === null) continue
    const b = bucketsFrom(sample)
    const prev = last !== null && last.turn === ev.data.turn && last.step === ev.data.step ? last : null
    if (prev !== null && eq(prev.b, b)) continue
    if (prev !== null) {
      const d = days[prev.day]; d.u -= prev.b.uncachedInputTokens; d.o -= prev.b.outputTokens; d.cr -= prev.b.cacheReadTokens; d.cw -= prev.b.cacheWriteTokens
    }
    const d = days[day] ??= { u: 0, o: 0, cr: 0, cw: 0 }
    d.u += b.uncachedInputTokens; d.o += b.outputTokens; d.cr += b.cacheReadTokens; d.cw += b.cacheWriteTokens
    last = { turn: ev.data.turn, step: ev.data.step, day, b }
    if (day && d.u < 0) console.log('NEGATIVE day bucket!', day)
  }
  const sum = Object.values(days).reduce((s, d) => ({ u: s.u + d.u, o: s.o + d.o, cr: s.cr + d.cr, cw: s.cw + d.cw }), { u: 0, o: 0, cr: 0, cw: 0 })
  const st = fs.statSync(f)
  const sessId = header?.id ?? path.basename(path.dirname(f))
  perSession.push({ file: f, id: sessId, bare: sessId.replace(/^session-/, ''), events, days, sum, firstTime: firstTime === Infinity ? null : firstTime, lastTime, mtimeMs: st.mtimeMs })
  for (const [day, d] of Object.entries(days)) {
    const g = globalDays[day] ??= { u: 0, o: 0, cr: 0, cw: 0 }
    g.u += d.u; g.o += d.o; g.cr += d.cr; g.cw += d.cw
  }
}
console.log('decoded in', ((Date.now() - t0) / 1000).toFixed(1) + 's', 'decodeErrors:', decodeErrors, 'parseErrors:', parseErrors)

// ---- cross-validation ----
const bareIds = new Set(perSession.map(s => s.bare))
let overlap = 0, mismatch = 0, matched = 0
const examples = []
for (const [id, p] of projs) {
  if (bareIds.has(id)) overlap++
}
console.log('projcache ids matching log bare ids:', overlap, '/', projs.size)

for (const s of perSession) {
  const p = projs.get(s.bare)
  if (!p || !p.totals) continue
  const t = p.totals
  const ok = t.uncachedInputTokens === s.sum.u && t.outputTokens === s.sum.o && t.cacheReadTokens === s.sum.cr && t.cacheWriteTokens === s.sum.cw
  if (ok) matched++
  else {
    mismatch++
    if (examples.length < 5) examples.push({ id: s.bare, proj: t, folded: s.sum, events: s.events })
  }
}
console.log('sessions with projcache+log: matched:', matched, 'mismatched:', mismatch)
examples.forEach(e => console.log(' mismatch:', JSON.stringify(e)))

const aggDays = Object.values(globalDays).reduce((s, d) => ({ u: s.u + d.u, o: s.o + d.o, cr: s.cr + d.cr, cw: s.cw + d.cw }), { u: 0, o: 0, cr: 0, cw: 0 })
const aggProj = [...projs.values()].reduce((s, p) => p.totals ? ({ u: s.u + p.totals.uncachedInputTokens, o: s.o + p.totals.outputTokens, cr: s.cr + p.totals.cacheReadTokens, cw: s.cw + p.totals.cacheWriteTokens }) : s, { u: 0, o: 0, cr: 0, cw: 0 })
console.log('aggregate folded(days):', JSON.stringify(aggDays))
console.log('aggregate projcache  :', JSON.stringify(aggProj))
console.log('total folded =', aggDays.u + aggDays.o + aggDays.cr + aggDays.cw, ' total proj =', aggProj.u + aggProj.o + aggProj.cr + aggProj.cw)

const dayKeys = Object.keys(globalDays).sort()
console.log('days covered:', dayKeys.length, dayKeys[0], '→', dayKeys[dayKeys.length - 1])
console.log('sessions decoded:', perSession.length, ' logs without projcache:', perSession.filter(s => !projs.has(s.bare)).length, ' projcache without log:', [...projs.keys()].filter(id => !bareIds.has(id)).length)
console.log('sample top-5 days:', dayKeys.map(k => [k, globalDays[k].u + globalDays[k].o + globalDays[k].cr + globalDays[k].cw]).sort((a, b) => b[1] - a[1]).slice(0, 5).map(x => x.join('=')).join(' '))
