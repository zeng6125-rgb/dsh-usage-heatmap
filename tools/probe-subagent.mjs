// 探查 projcache rows 里的子代理标识：subagent / subagentCatalog / sessionListMetadata / subagentTiming
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const PROJ = path.join(os.homedir(), '.dsh', 'storages', 'session_projcache', 'sessions')
const files = fs.readdirSync(PROJ).filter(f => f.endsWith('.json'))

const pick = ['subagent', 'subagentCatalog', 'sessionListMetadata', 'subagentTiming', 'sessionStats']
const agg = {}
for (const k of pick) agg[k] = { shapes: new Map() }

for (const f of files) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(PROJ, f), 'utf8'))
    const rec = j.record ?? j
    for (const k of pick) {
      const v = rec.rows?.[k]?.val
      let shape
      if (v === null || v === undefined) shape = String(v)
      else if (Array.isArray(v)) shape = 'array[' + v.length + ']:' + JSON.stringify(v.slice(0, 2)).slice(0, 200)
      else if (typeof v === 'object') shape = 'obj{' + Object.keys(v).sort().join(',') + '}=' + JSON.stringify(v).slice(0, 260)
      else shape = typeof v + ':' + String(v).slice(0, 120)
      const m = agg[k].shapes
      m.set(shape, (m.get(shape) ?? 0) + 1)
    }
  } catch {}
}

for (const k of pick) {
  console.log('=== ' + k)
  for (const [shape, n] of agg[k].shapes) console.log('  x' + n + '  ' + shape)
}
