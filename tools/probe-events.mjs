// Probe: decode one durable session log (multi-frame zstd) and inspect event shapes/timestamps.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'
import { Transform } from 'node:stream'

const root = path.join(os.homedir(), '.dsh', 'sessions')
const files = []
function walk(dir) {
  let ents
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name === 'session.v4.jsonl.zstd') files.push(p)
  }
}
walk(root)
console.log('session logs:', files.length)
if (!files.length) process.exit(1)
// pick a mid-size one
files.sort((a, b) => fs.statSync(a).size - fs.statSync(b).size)
const target = files[Math.floor(files.length / 2)]
console.log('target:', target, fs.statSync(target).size, 'bytes')

const buf = await new Promise((resolve, reject) => {
  const chunks = []
  const dec = zlib.createZstdDecompress()
  dec.on('data', (c) => chunks.push(c))
  dec.on('end', () => resolve(Buffer.concat(chunks)))
  dec.on('error', reject)
  fs.createReadStream(target).pipe(dec)
})
const lines = buf.toString('utf8').split('\n').filter(Boolean)
console.log('decoded lines:', lines.length)

const types = {}
const usageSamples = []
const tsFieldCounts = {}
for (const line of lines) {
  let ev
  try { ev = JSON.parse(line) } catch { continue }
  const t = ev.type ?? '(none)'
  types[t] = (types[t] || 0) + 1
  for (const k of ['at', 'ts', 'time', 'timestamp', 'createdAt', 'startedAt', 'endedAt', 'wallMs', 'now']) {
    if (ev[k] !== undefined) tsFieldCounts[k] = (tsFieldCounts[k] || 0) + 1
  }
  const s = JSON.stringify(ev)
  if (/"usage"|usageTokens|outputTokens|uncachedInputTokens|cacheReadTokens/.test(s) && usageSamples.length < 3) {
    usageSamples.push(s.slice(0, 1200))
  }
}
console.log('type counts:', JSON.stringify(types, null, 1))
console.log('top-level ts-ish fields:', JSON.stringify(tsFieldCounts))
console.log('--- usage samples ---')
usageSamples.forEach((s, i) => console.log(`[${i}]`, s, '\n'))
// header
console.log('--- first line ---')
console.log(lines[0].slice(0, 600))
// show one turn/step boundary event for timestamp shape
for (const line of lines) {
  try {
    const ev = JSON.parse(line)
    if (ev.type && /turn|step/.test(ev.type)) { console.log('--- boundary sample ---'); console.log(JSON.stringify(ev).slice(0, 800)); break }
  } catch {}
}
