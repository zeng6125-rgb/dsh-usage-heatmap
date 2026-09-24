// 实证 peer 范围：必须走 **git 依赖**解析路径（github: / git+file:），
// 本地目录（file:）的 peer 解析行为不同，会掩盖 ETARGET。
// 用法：node tools/probe-peer-ranges.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const SRC = path.resolve(import.meta.dirname, '..')
const WORK = path.join(os.tmpdir(), 'uh-peer-probe')

const base = JSON.parse(fs.readFileSync(path.join(SRC, 'package.json'), 'utf8'))
delete base.peerDependencies

// 每条分支都带预发布锚点：node-semver 只放行「元组相同且自身带预发布标签」的比较符，
// 所以 >=0.1.5-rc.1 <0.1.6-0 能匹配 0.1.5-rc.3，而 >=0.0.1-rc <2 匹配不到它。
const TOOLS = '>=0.1.5-rc.1 <0.1.6-0 || >=0.1.6-alpha.1 <0.1.7-0 || >=0.1.7-alpha.1 <2'
const SLOTS = TOOLS

const CANDIDATES = {
  // 我上一步误加的 dsh-client-runtime（范围与它的发布线不符）
  withRuntime: {
    '@deepseek-ai/dsh-llm': TOOLS,
    '@deepseek-ai/dsh-tools': TOOLS,
    '@deepseek-ai/cordis': '>=4.0.1-rc.1 <5',
    '@deepseek-ai/schemastery': '^3.18.2',
    '@deepseek-ai/dsh-client-ui-slots': SLOTS,
    '@deepseek-ai/dsh-client-runtime': TOOLS,
  },
  // 只声明产物真正需要、且范围已被证明可解析的
  proposed: {
    '@deepseek-ai/dsh-tools': TOOLS,
    '@deepseek-ai/cordis': '>=4.0.1-rc.1 <5',
    '@deepseek-ai/schemastery': '^3.18.2',
    '@deepseek-ai/dsh-client-ui-slots': SLOTS,
    'react': '>=18 <20',
  },
  // 更保守：不带 react
  proposedNoReact: {
    '@deepseek-ai/dsh-tools': TOOLS,
    '@deepseek-ai/cordis': '>=4.0.1-rc.1 <5',
    '@deepseek-ai/schemastery': '^3.18.2',
    '@deepseek-ai/dsh-client-ui-slots': SLOTS,
  },
}

// Node 24 on Windows refuses to spawn a .cmd without a shell (spawnSync EINVAL),
// so the npm invocation goes through the shell on win32 only. Arguments are all
// literals this script builds, so there is nothing to interpolate.
const NPM = 'npm'
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe', shell: process.platform === 'win32' })

function gitRepoFor(name, peers) {
  const dir = path.join(WORK, `repo-${name}`)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ ...base, peerDependencies: peers }, null, 2),
  )
  fs.cpSync(path.join(SRC, 'lib'), path.join(dir, 'lib'), { recursive: true })
  fs.copyFileSync(path.join(SRC, 'cordis.patch.yml'), path.join(dir, 'cordis.patch.yml'))
  fs.writeFileSync(path.join(dir, 'README.md'), '# probe\n')
  run('git', ['init', '-q'], dir)
  run('git', ['add', '-A'], dir)
  run('git', ['-c', 'user.name=p', '-c', 'user.email=p@e', 'commit', '-qm', 'probe'], dir)
  return dir
}

fs.rmSync(WORK, { recursive: true, force: true })
console.log('git 依赖路径下的 peer 解析结果（本地目录测试会掩盖 ETARGET）\n')
for (const [name, peers] of Object.entries(CANDIDATES)) {
  const repo = gitRepoFor(name, peers)
  const consumer = path.join(WORK, `consumer-${name}`)
  fs.mkdirSync(consumer, { recursive: true })
  fs.writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify({ name: 'consumer', version: '1.0.0', private: true }, null, 2),
  )
  let ok = true
  let why = ''
  try {
    run(NPM, ['install', '--dry-run', '--no-audit', '--no-fund', `git+file:///${repo.replace(/\\/g, '/')}`], consumer)
  } catch (e) {
    ok = false
    const out = String(e.stdout ?? '') + String(e.stderr ?? '')
    if (process.env.PROBE_DEBUG) console.log(`\n--- raw (${name}) ---\n${out.slice(0, 1500)}\n--- end ---\n`)
    why = (/npm error (?:code \w+|notarget[^\n]*)/.exec(out) ?? [out.split('\n').find((l) => /error/.test(l)) ?? `exit ${e.status}: ${String(e.message).slice(0, 120)}`])[0].slice(0, 150)
  }
  console.log(`${ok ? '✓ 可安装' : '✗ 失败  '}  ${name}`)
  if (!ok) console.log(`            ${why}`)
  else console.log(`            peers: ${Object.keys(peers).join(', ')}`)
}
