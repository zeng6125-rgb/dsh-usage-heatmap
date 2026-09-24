// Probe: projection cache structure (session-level totals).
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const dir = path.join(os.homedir(), '.dsh', 'storages', 'session_projcache', 'sessions')
const files = fs.readdirSync(dir)
console.log('files:', files.length)
let withTok = 0, samplePrinted = 0
for (const f of files) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
  const rec = j.record || j
  const tok = rec.rows?.tokenUsage?.val?.totals
  if (tok) withTok++
  if (samplePrinted < 2 && tok) {
    samplePrinted++
    const st = fs.statSync(path.join(dir, f))
    console.log('--- sample', f, '---')
    console.log('top keys:', Object.keys(j))
    console.log('identity:', JSON.stringify(rec.identity))
    console.log('tokenUsage.totals:', JSON.stringify(tok))
    console.log('tokenUsage keys:', Object.keys(rec.rows.tokenUsage.val))
    console.log('sessionStats:', JSON.stringify(rec.rows.sessionStats?.val))
    console.log('title:', JSON.stringify(rec.rows.title?.val))
    console.log('mtime:', st.mtime.toISOString())
  }
}
console.log('sessions with tokenUsage:', withTok, '/', files.length)
