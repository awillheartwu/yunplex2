import { DEFAULT_CONFIG } from '../server/lib/config/defaults'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { closeDb, initDb, writeConfigToDb } from '../server/lib/db'
import { markSetupComplete, setAdminPassword } from '../server/lib/auth/store'

const dataDir = mkdtempSync('/tmp/reyunplex-browser-tests-')
const projectRoot = resolve(import.meta.dirname, '..')
const nuxtBin = resolve(projectRoot, 'node_modules/nuxt/bin/nuxt.mjs')
const production = process.env.PLAYWRIGHT_PRODUCTION === '1'
const port = production ? '3013' : '3011'

initDb(dataDir)
const testConfig = structuredClone(DEFAULT_CONFIG)
testConfig.sync.enabled = false
testConfig.netease.cookie = ''
testConfig.plex.server = ''
testConfig.plex.token = ''
writeConfigToDb(testConfig)
await setAdminPassword('browser-test-password')
markSetupComplete()
closeDb()

const child = spawn(process.execPath, production ? [resolve(projectRoot, '.output/server/index.mjs')] : [
  nuxtBin,
  'dev',
  '--host',
  '127.0.0.1',
  '--port',
  port,
  '--dotenv',
  '/dev/null',
], {
  cwd: projectRoot,
  env: {
    ...process.env,
    NODE_OPTIONS: '--no-deprecation',
    NUXT_DATA_DIR: dataDir,
    NITRO_HOST: '127.0.0.1',
    NITRO_PORT: port,
    NUXT_IGNORE_LOCK: '1',
  },
  stdio: 'inherit',
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => child.kill(signal))
}

child.on('exit', code => {
  rmSync(dataDir, { recursive: true, force: true })
  process.exitCode = code ?? 0
})
