/** Isolated real-service observation. Source data is read-only; never clones sources or bindings. */
import { spawn } from 'node:child_process'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, openSync, appendFileSync, cpSync, readdirSync, readlinkSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import Database from 'better-sqlite3'
import { initDb, closeDb, writeConfigToDb } from '../../server/lib/db'
import { setDataDir } from '../../server/lib/config/store'
import { setAdminPassword, markSetupComplete } from '../../server/lib/auth/store'
import { sanitizeDiagnosticMessage } from '../../server/lib/domain-error'
import { migrateConfig } from '../../server/lib/config/validation'
import { createSource, updateSource } from '../../server/lib/playlist/store'

const [donorPath, outputPath, portArg = '3014', mode = 'soak'] = process.argv.slice(2)
if (!donorPath || !outputPath) throw new Error('Usage: soak.ts READONLY_DATABASE NEW_OUTPUT_DIRECTORY [PORT]')
const donor = resolve(donorPath), output = resolve(outputPath)
const port = Number(portArg)
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port')
process.umask(0o077)
mkdirSync(output, { mode: 0o700 }) // Refuse reuse: each run has a new, exclusive scope.
const reportPath = join(output, 'status.json')
const token = randomUUID(), scope = `reyunplex-acceptance-${token}`
const data = join(output, 'data'), base = `http://127.0.0.1:${port}`
if (!['soak', 'smoke', 'quick'].includes(mode)) throw new Error('Expected soak, smoke or quick')
const duration = mode === 'soak' ? 24 * 60 * 60 * 1000 : 120000, midpoint = mode === 'soak' ? duration / 2 : 0
const report: Record<string, unknown> = { status: 'preparing', scope, nativePlatform: `${process.platform}/${process.arch}`, dockerValidated: false, externalWorkload: true }
function checkpoint(patch: Record<string, unknown>) {
  Object.assign(report, patch, { updatedAt: new Date().toISOString() })
  writeFileSync(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 })
}
checkpoint({ stage: 'preparing' })
try {
const d = new Database(donor, { readonly: true, fileMustExist: true })
const raw = d.prepare("SELECT value FROM config WHERE key='app'").get() as { value: string }
const selected = d.prepare("SELECT netease_playlist_id FROM playlist_sources WHERE type='playlist' ORDER BY created_at LIMIT 1").get() as { netease_playlist_id: number } | undefined
const before = createHash('sha256').update(JSON.stringify(d.prepare('SELECT * FROM song_identity_bindings ORDER BY netease_song_id').all())).digest('hex')
d.close()
if (!selected) throw new Error('No playlist available for isolated workload')
const cfg = migrateConfig(JSON.parse(raw.value)).config
if (process.env.YUNPLEX2_ACCEPTANCE_MEDIA_ROOT) cfg.download.dir = resolve(process.env.YUNPLEX2_ACCEPTANCE_MEDIA_ROOT)
if (process.env.YUNPLEX2_ACCEPTANCE_PLEX_PREFIX) cfg.download.plexLibraryPathPrefix = process.env.YUNPLEX2_ACCEPTANCE_PLEX_PREFIX
if (!cfg.netease.cookie || !cfg.plex.server || !cfg.plex.token) throw new Error('External connection configuration is missing')
cfg.sync.enabled = false
cfg.sync.initializeMediaOnFirstSync = mode === 'quick'
cfg.sync.songLimit = 1
cfg.sync.downloadConcurrency = 1
cfg.sync.autoDownloadAlbum = false
cfg.sync.skipPlexPlaylist = false
cfg.sync.unverifiedMediaPolicy = 'download_managed'
cfg.initializationMatching = { ...cfg.initializationMatching!, enabled: mode === 'quick' }
if (mode === 'quick') {
  cfg.other.pathFormat = `${scope}/${cfg.other.pathFormat}`
  mkdirSync(join(cfg.download.dir, scope), {mode:0o700})
} else {
  cfg.download.dir = join(cfg.download.dir, scope)
  cfg.download.plexLibraryPathPrefix = cfg.download.plexLibraryPathPrefix ? `${cfg.download.plexLibraryPathPrefix.replace(/\/$/, '')}/${scope}` : ''
  mkdirSync(cfg.download.dir, { mode: 0o700 })
}
initDb(data); setDataDir(data); writeConfigToDb(cfg)
const password = randomBytes(32).toString('hex')
await setAdminPassword(password); markSetupComplete()
// Resolve playlist metadata, but never reuse its Plex title or rating key.
const source = await createSource(selected.netease_playlist_id, cfg.netease.cookie, { type: 'playlist', name: scope })
updateSource(source.id, { name: scope, plexPlaylistName: scope, plexPlaylistRatingKey: '', enabled: false, syncLimit: 1, initializeMediaOnFirstSync: mode === 'quick', autoCreatePlexPlaylist: true, skipPlexPlaylist: false })
closeDb()
const frozenBuild = join(output, 'build')
cpSync(resolve('.output'), frozenBuild, { recursive: true, verbatimSymlinks: true })
const artifact = join(frozenBuild, 'server/index.mjs')
const hash = createHash('sha256')
function hashDirectory(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = join(dir, entry.name)
    if (entry.isDirectory()) hashDirectory(file)
    else { hash.update(file.slice(frozenBuild.length)); hash.update(entry.isSymbolicLink() ? readlinkSync(file) : readFileSync(file)) }
  }
}
hashDirectory(frozenBuild)
const artifactHash = hash.digest('hex')
const log = openSync(join(output, 'server.log'), 'a', 0o600)
const child = spawn(process.execPath, [artifact], { env: { ...process.env, NUXT_DATA_DIR: data, NITRO_HOST: '127.0.0.1', NITRO_PORT: String(port), YUNPLEX2_TRUSTED_PROXIES: '', YUNPLEX2_DEV_AUTH_DISABLED: 'false' }, stdio: ['ignore', log, log] })
let exited = false
child.on('exit', () => { exited = true })
let cookie = '', csrf = ''
async function request(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(`${base}/api${path}`, { method, headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) })
  const payload = await response.json()
  if (!response.ok || payload.code !== 0) throw new Error(`Acceptance request failed: ${path} (${response.status})`)
  return { response, payload }
}
async function converge(expectFailure = false) {
  const accepted = await request(`/playlist-sources/${source.id}/sync`, { mode: 'full' })
  const item = accepted.payload.data.results?.[0]
  if (item?.status !== 'accepted' || !item.requestId) throw new Error('Scoped convergence was not accepted')
  const observation = new Database(join(data, 'data.db'), { readonly: true, fileMustExist: true })
  try {
    for (let attempt = 0; attempt < 180; attempt++) {
      if (exited) throw new Error('Runtime exited during convergence')
      const row = observation.prepare('SELECT q.status AS request_status, r.status AS run_status FROM source_sync_queue q LEFT JOIN task_runs r ON r.id=q.run_id WHERE q.id=?').get(item.requestId) as { request_status: string; run_status: string } | undefined
      if (row && ['completed', 'failed', 'cancelled'].includes(row.request_status)) {
        appendFileSync(join(output, 'workload.jsonl'), JSON.stringify({ at: Date.now(), expectFailure, ...row }) + '\n')
        const valid = expectFailure ? ['failed', 'partial'].includes(row.run_status) : row.run_status === 'success'
        if (!valid) throw new Error('Scoped convergence did not reach its expected outcome')
        if (!expectFailure) {
          const current = (await request(`/playlist-sources/${source.id}`)).payload.data
          if (current.plexPlaylistName !== scope || !current.plexPlaylistRatingKey || !current.lastAppliedPlexFingerprint) throw new Error('Scoped Plex read-back evidence missing')
          checkpoint({ plexPlaylistRatingKey: current.plexPlaylistRatingKey, plexReadBackVerified: true })
        }
        return
      }
      await delay(2000)
    }
    throw new Error('Scoped convergence exceeded six minutes')
  } finally { observation.close() }
}
try {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (exited) throw new Error('Isolated server exited during startup')
    try { await request('/system/ready'); break } catch { if (attempt === 59) throw new Error('Startup timeout'); await delay(1000) }
  }
  const login = await request('/auth/login', { password })
  cookie = login.response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  csrf = login.payload.data.csrfToken
  if (mode === 'quick') {
    checkpoint({stage:'quick-analysis',pid:child.pid})
    await request(`/playlist-sources/${source.id}/initialization/start`, {})
    let initialization: {id:string;revision:number;status:string}|undefined
    for(let attempt=0;attempt<180;attempt++) {
      initialization=(await request(`/playlist-sources/${source.id}/initialization`)).payload.data.initialization
      if(initialization?.status==='awaiting_review')break
      if(initialization?.status==='failed')throw new Error('Quick analysis failed')
      await delay(2000)
    }
    if(initialization?.status!=='awaiting_review')throw new Error('Quick analysis timed out')
    const preview=(await request(`/playlist-sources/${source.id}/initialization/quick-preview`,{initializationId:initialization.id,revision:initialization.revision,threshold:85})).payload.data
    const accepted=(await request(`/playlist-sources/${source.id}/initialization/quick-confirm`,{operationId:preview.operationId,token:preview.token,start:true})).payload.data
    const repeated=(await request(`/playlist-sources/${source.id}/initialization/quick-confirm`,{operationId:preview.operationId,token:preview.token,start:true})).payload.data
    if(accepted.requestId!==repeated.requestId)throw new Error('Quick confirmation was not idempotent')
    for(let attempt=0;attempt<180;attempt++) {
      const state=(await request(`/playlist-sources/${source.id}/initialization`)).payload.data.initialization
      if(state?.status==='completed'){checkpoint({quickConfirmed:true,quickCounts:preview.counts});break}
      if(state?.quickStatus==='failed')throw new Error('Quick execution failed')
      if(attempt===179)throw new Error('Quick execution timed out')
      await delay(2000)
    }
    const observation=new Database(join(data,'data.db'),{readonly:true,fileMustExist:true})
    try {
      for(let attempt=0;attempt<180;attempt++) {
        const pending=observation.prepare("SELECT COUNT(*) n FROM source_sync_queue WHERE status IN ('pending','running')").get() as {n:number}
        if(!pending.n)break
        if(attempt===179)throw new Error('Quick follow-up timed out')
        await delay(2000)
      }
      const disabled=observation.prepare('SELECT enabled FROM playlist_sources WHERE id=?').get(source.id) as {enabled:number}
      if(disabled.enabled!==0)throw new Error('Quick processing enabled scheduled synchronization')
    } finally {observation.close()}
    checkpoint({stage:'correction-download'})
    const media=(await request(`/match-management/overview?sourceId=${source.id}`)).payload.data.items[0]
    if(!media?.binding?.plexRatingKey)throw new Error('Missing binding for correction acceptance')
    const originalRatingKey=media.binding.plexRatingKey
    const prefix=cfg.download.plexLibraryPathPrefix.replace(/\/$/,'')
    const originalPath=media.binding.plexFilePath.startsWith(prefix+'/') ? join(cfg.download.dir,media.binding.plexFilePath.slice(prefix.length+1)) : null
    const originalHash=originalPath?createHash('sha256').update(readFileSync(originalPath)).digest('hex'):null
    const correctionBody={expectedBindingUpdatedAt:media.binding.updatedAt}
    const correction=(await request(`/match-management/bindings/${media.target.neteaseSongId}/download`,correctionBody)).payload.data
    const correctionAgain=(await request(`/match-management/bindings/${media.target.neteaseSongId}/download`,correctionBody)).payload.data
    if(correction.correctionId!==correctionAgain.correctionId)throw new Error('Correction request was not idempotent')
    await converge()
    const corrected=(await request(`/match-management/overview?sourceId=${source.id}`)).payload.data.items[0]
    if(corrected.binding?.plexRatingKey===originalRatingKey||!corrected.localMedia?.filePath?.includes(scope))throw new Error('Correction did not switch to isolated managed copy')
    const unchanged=originalPath&&originalHash===createHash('sha256').update(readFileSync(originalPath)).digest('hex')
    if(!unchanged)throw new Error('Original file did not remain unchanged')
    checkpoint({correctionVerified:true,originalFileUnchanged:true})
  }
  checkpoint({ stage: 'warmup', pid: child.pid })
  await converge()
  checkpoint({ warmupPassed: true })
  const started = Date.now()
  let lastUptime = 0, lastWorkload = 0, workloadRequests = 0, samples = 0, failureRecoveryVerified = false
  checkpoint({ status: 'running', startedAt: new Date(started).toISOString(), expectedEndAt: new Date(started + duration).toISOString(), artifactHash, sourceId: source.id, donorIdentityHash: before })
  while (Date.now() - started < duration) {
    if (exited) throw new Error('Server exited; continuous observation invalid')
    const active = Date.now() - started >= midpoint
    if (active && Date.now() - lastWorkload >= 30 * 60 * 1000) {
      if (!failureRecoveryVerified) {
        try {
          await request('/config', { plex: { server: '127.0.0.1', port: 1 } }, 'PUT')
          await converge(true)
        } finally { await request('/config', { plex: cfg.plex }, 'PUT') }
        await converge()
        failureRecoveryVerified = true
        checkpoint({ failureRecoveryVerified })
      } else await converge()
      workloadRequests++; lastWorkload = Date.now()
    }
    const stream = await fetch(`${base}/api/sync/events`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(10000) })
    if (!stream.ok) throw new Error('SSE connection failed')
    await stream.body?.cancel()
    await delay(1000)
    const { payload } = await request('/system/runtime')
    const metrics = payload.data
    if (metrics.uptime < lastUptime || !metrics.readiness.ready) throw new Error('Runtime restarted or lost readiness')
    lastUptime = metrics.uptime; samples++
    appendFileSync(join(output, 'metrics.jsonl'), JSON.stringify(metrics) + '\n', { mode: 0o600 })
    checkpoint({ phase: active ? 'workload' : 'idle', samples, workloadRequests, elapsedSeconds: Math.floor((Date.now() - started) / 1000) })
    await delay(59000)
  }
  checkpoint({ status: mode === 'soak' ? 'observation_complete' : 'smoke_complete', verdict: 'pending_review', reason: 'Review resource trends, workload outcomes and external read-back; elapsed time alone is not acceptance.' })
} catch (error) {
  checkpoint({ status: 'failed', reason: error instanceof Error ? error.message : 'Observation failed' })
  process.exitCode = 1
} finally {
  const original = new Database(donor, { readonly: true, fileMustExist: true })
  const after = createHash('sha256').update(JSON.stringify(original.prepare('SELECT * FROM song_identity_bindings ORDER BY netease_song_id').all())).digest('hex')
  original.close()
  checkpoint({ donorIdentityUnchanged: after === before })
  child.kill('SIGTERM')
  if (!exited) await new Promise<void>(resolveExit => {
    const timer = setTimeout(resolveExit, 120000)
    child.once('exit', () => { clearTimeout(timer); resolveExit() })
  })
  if (!exited) child.kill('SIGKILL')
  closeDb()
}

} catch (error) { checkpoint({ status: 'failed', reason: sanitizeDiagnosticMessage(error instanceof Error ? error.message : 'Preparation failed') }); closeDb(); process.exitCode = 1 }
