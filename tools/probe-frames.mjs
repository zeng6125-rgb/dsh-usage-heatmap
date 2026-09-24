// Probe: understand zstd frame layout of session logs & decode ALL frames.
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
const target = files[Math.floor(files.length / 2)]
const raw = fs.readFileSync(target)
console.log('target:', target, raw.length, 'bytes')

// 1) count frame magics
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
let magicCount = 0
for (let i = 0; i + 4 <= raw.length; i++) {
  if (raw[i] === 0x28 && raw[i + 1] === 0xb5 && raw[i + 2] === 0x2f && raw[i + 3] === 0xfd) magicCount++
}
console.log('magic count (whole file):', magicCount)

// 2) sync decompress whole buffer
try {
  const out = zlib.zstdDecompressSync(raw)
  console.log('zstdDecompressSync(whole) lines:', out.toString('utf8').split('\n').filter(Boolean).length)
} catch (e) {
  console.log('zstdDecompressSync(whole) error:', e.message)
}

// 3) frame splitter: parse zstd frames until input exhausted
function splitFrames(buf) {
  const frames = []
  let off = 0
  while (off + 4 <= buf.length) {
    const magic = buf.readUInt32LE(off)
    if (magic === 0x184d2a50 || magic === 0x184d2a51 || magic === 0x184d2a52 || magic === 0x184d2a53
      || magic === 0x184d2a54 || magic === 0x184d2a55 || magic === 0x184d2a56 || magic === 0x184d2a57
      || magic === 0x184d2a58 || magic === 0x184d2a59 || magic === 0x184d2a5a || magic === 0x184d2a5b
      || magic === 0x184d2a5c || magic === 0x184d2a5d || magic === 0x184d2a5e || magic === 0x184d2a5f) {
      // skippable frame: magic + u32 size + payload
      const size = buf.readUInt32LE(off + 4)
      frames.push({ kind: 'skip', start: off, end: off + 8 + size })
      off += 8 + size
      continue
    }
    if (magic !== 0xfd2fb528) throw new Error(`bad magic at ${off}: 0x${magic.toString(16)}`)
    let p = off + 4
    const fhd = buf[p]; p++
    const fcsFlag = fhd >> 6
    const single = (fhd >> 5) & 1
    const checksum = (fhd >> 2) & 1
    const dictId = fhd & 3
    p += [0, 1, 2, 4][dictId] // dictionary ID
    if (!single) p += 1 // window descriptor
    let fcsSize = 0
    if (fcsFlag === 0) fcsSize = single ? 1 : 0
    else if (fcsFlag === 1) fcsSize = 2
    else if (fcsFlag === 2) fcsSize = 4
    else fcsSize = 8
    p += fcsSize
    // blocks
    let blocks = 0
    let last = false
    while (!last) {
      if (p + 3 > buf.length) throw new Error('truncated block header')
      const bh = buf.readUIntLE(p, 3)
      p += 3
      last = !!(bh & 1)
      const type = (bh >>> 1) & 0x3
      const size = bh >>> 3
      if (type === 3) throw new Error('reserved block type')
      p += type === 1 ? 1 : size // RLE payload = 1 byte
      blocks++
      if (blocks > 1e7) throw new Error('runaway')
    }
    if (checksum) p += 4
    frames.push({ kind: 'data', start: off, end: p, blocks })
    off = p
  }
  return frames
}

const frames = splitFrames(raw)
console.log('parsed frames:', frames.length, frames.slice(0, 5).map(f => `${f.kind}:${f.end - f.start}${f.blocks ? '/' + f.blocks + 'blk' : ''}`))

let all = ''
let decoded = 0
for (const f of frames) {
  if (f.kind !== 'data') continue
  const out = zlib.zstdDecompressSync(raw.subarray(f.start, f.end))
  all += out.toString('utf8')
  decoded++
}
const lines = all.split('\n').filter(Boolean)
console.log('decoded data frames:', decoded, 'lines:', lines.length)

const types = {}
const tsFields = {}
const samples = {}
for (const line of lines) {
  let ev
  try { ev = JSON.parse(line) } catch { continue }
  const t = ev.type ?? '(none)'
  types[t] = (types[t] || 0) + 1
  for (const k of Object.keys(ev)) {
    if (/^(at|ts|time|timestamp|.*At|.*Ms)$/.test(k)) tsFields[k] = (tsFields[k] || 0) + 1
  }
  if (/usage|tokens/i.test(JSON.stringify(Object.keys(ev))) || ev.usage) {
    if (!samples['usage:' + t]) samples['usage:' + t] = JSON.stringify(ev).slice(0, 1000)
  }
}
console.log('type counts:', JSON.stringify(types, null, 1))
console.log('ts-ish fields:', JSON.stringify(tsFields, null, 1))
for (const [k, v] of Object.entries(samples)) console.log('--- sample', k, '---\n', v)
// also peek nested: find any event with .usage object anywhere
outer: for (const line of lines) {
  try {
    const ev = JSON.parse(line)
    const s = JSON.stringify(ev)
    if (s.includes('"usage"')) { console.log('--- event containing "usage" ---'); console.log(s.slice(0, 1500)); break outer }
  } catch {}
}
