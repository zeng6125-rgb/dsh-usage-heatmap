// Probe: locate usage-carrying events & their shapes in a decoded session log.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import zlib from 'node:zlib'

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
files.sort((a, b) => fs.statSync(a).size - fs.statSync(b).size)

function splitFrames(buf) {
  const frames = []
  let off = 0
  while (off + 4 <= buf.length) {
    const magic = buf.readUInt32LE(off)
    if (magic >= 0x184d2a50 && magic <= 0x184d2a5f) {
      const size = buf.readUInt32LE(off + 4)
      off += 8 + size
      continue
    }
    if (magic !== 0xfd2fb528) throw new Error(`bad magic at ${off}`)
    let p = off + 4
    const fhd = buf[p]; p++
    const fcsFlag = fhd >> 6
    const single = (fhd >> 5) & 1
    const checksum = (fhd >> 2) & 1
    const dictId = fhd & 3
    p += [0, 1, 2, 4][dictId]
    if (!single) p += 1
    p += fcsFlag === 0 ? (single ? 1 : 0) : fcsFlag === 1 ? 2 : fcsFlag === 2 ? 4 : 8
    let last = false
    while (!last) {
      const bh = buf.readUIntLE(p, 3); p += 3
      last = !!(bh & 1)
      const type = (bh >>> 1) & 0x3
      const size = bh >>> 3
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

// scan up to 3 files for usage event shapes
const targets = [files[Math.floor(files.length / 2)], files[files.length - 1], files[0]]
const found = {}
for (const f of targets) {
  let lines
  try { lines = decodeFile(f) } catch (e) { console.log('skip', f, e.message); continue }
  console.log('==', f, lines.length, 'lines')
  for (const line of lines) {
    let ev
    try { ev = JSON.parse(line) } catch { continue }
    // search for token-ish keys recursively (depth 4)
    const hits = []
    ;(function walk(o, p, d) {
      if (!o || typeof o !== 'object' || d > 4) return
      for (const k of Object.keys(o)) {
        const v = o[k]
        const kp = p + '.' + k
        if (/uncachedInputTokens|outputTokens|cacheReadTokens|cacheWriteTokens|inputTokens|totalTokens|usage/i.test(k)) hits.push(kp + '=' + (typeof v === 'object' ? JSON.stringify(v).slice(0, 300) : String(v)))
        if (typeof v === 'object') walk(v, kp, d + 1)
      }
    })(ev, ev.type, 0)
    if (hits.length && !found[ev.type]) {
      found[ev.type] = hits.slice(0, 8)
      console.log('  [' + ev.type + '] time=' + ev.time + ' hits:', JSON.stringify(hits.slice(0, 8), null, 1))
    }
  }
}
console.log('=== types carrying token fields ===')
for (const [t, h] of Object.entries(found)) console.log(t, '→', h.length, 'hit patterns; first:', h[0])
