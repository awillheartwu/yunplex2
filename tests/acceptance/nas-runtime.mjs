// Runs only inside the disposable, immutable-image container. stdout is redacted JSON.
import { createRequire } from 'node:module'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const require = createRequire('/app/.output/server/package.json')
const Database = require('better-sqlite3')
const base = 'http://127.0.0.1:3000', control = '/control'
const read = name => JSON.parse(readFileSync(`${control}/${name}.json`, 'utf8'))
const save = (name, value) => writeFileSync(`${control}/${name}.json`, JSON.stringify(value), { mode: 0o600 })
const fixture = read('fixture')
const db = new Database('/app/data/data.db', { readonly: true, fileMustExist: true })
let auth = existsSync(`${control}/auth.json`) ? read('auth') : {}
function credentials() {
  if (existsSync('/bootstrap/seed.db')) {
    const seed = new Database('/bootstrap/seed.db', { readonly: true, fileMustExist: true })
    const value = JSON.parse(seed.prepare('SELECT value FROM connection').get().value)
    seed.close()
    return value
  }
  return JSON.parse(db.prepare("SELECT value FROM config WHERE key='app'").get().value)
}
async function api(path, body, method = body === undefined ? 'GET' : 'POST') {
  const response = await fetch(`${base}/api${path}`, {
    method, headers: { Cookie: auth.cookie || '', Origin: base, 'Content-Type': 'application/json', 'X-CSRF-Token': auth.csrf || '' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(65000),
  })
  const payload = await response.json()
  if (!response.ok || payload.code !== 0) throw new Error(`API ${path.split('?')[0]} rejected (${response.status}, code ${payload.code})`)
  return { data: payload.data, response }
}
async function plex(path, method = 'GET', legacy = false) {
  const cfg = credentials()
  const url = new URL(read('upstream').url)
  const response = await fetch(new URL(path, url), { method,
    headers: { Accept: 'application/json', 'X-Plex-Token': cfg.plex.token, 'X-Plex-Pms-Api-Version': legacy ? '0.0' : '1.0' },
    signal: AbortSignal.timeout(30000),
  })
  if (!response.ok) throw new Error(`Plex ${method} ${path.split('?')[0]} rejected (${response.status})`)
  const text = await response.text()
  return text.trim().startsWith('{') ? JSON.parse(text).MediaContainer : null
}
function source() {
  return fixture.sourceId ? db.prepare('SELECT id, name, enabled, plex_playlist_name, plex_playlist_rating_key, last_status, last_job_id, last_applied_plex_fingerprint FROM playlist_sources WHERE id=?').get(fixture.sourceId) : null
}
function journal() {
  const row = db.prepare('SELECT value FROM app_state WHERE key=?').get(`plex-playlist-write:${fixture.sourceId}`)
  if (!row) return null
  const value = JSON.parse(row.value)
  return { kind: value.kind, submitted: value.submitted, acknowledged: value.acknowledged, playlistKey: value.playlistKey }
}
async function ownPlaylist() {
  const s = source()
  if (!s?.plex_playlist_rating_key || s.plex_playlist_name !== fixture.title) throw new Error('Owned playlist not established')
  const result = await plex(`/playlists/${s.plex_playlist_rating_key}`)
  const meta = result.Metadata?.[0]
  if (meta?.title !== fixture.title || meta.playlistType !== 'audio' || meta.smart) throw new Error('Playlist scope mismatch')
  return s.plex_playlist_rating_key
}
async function items() {
  const key = await ownPlaylist()
  const result = await plex(`/playlists/${key}/items?X-Plex-Container-Size=100`)
  const list = result.Metadata || []
  if (list.length !== result.totalSize && result.totalSize !== undefined) throw new Error('Incomplete playlist readback')
  return list.map(item => ({ key: item.ratingKey, itemId: item.playlistItemID,
    file: item.Media?.[0]?.Part?.[0]?.file, title: item.title }))
}
function files() {
  const result = []
  function walk(path) {
    for (const name of readdirSync(path).sort()) {
      const file = join(path, name), stat = statSync(file)
      if (stat.isDirectory()) walk(file)
      else result.push({ path: file.slice('/mnt/acceptance/'.length), bytes: stat.size,
        sha256: createHash('sha256').update(readFileSync(file)).digest('hex') })
    }
  }
  walk('/mnt/acceptance')
  return result
}
function state() {
  return { source: source(), journal: journal(),
    requests: db.prepare('SELECT id,status,run_id,last_error FROM source_sync_queue ORDER BY created_at DESC LIMIT 5').all()
      .map(({ last_error, ...row }) => ({ ...row, hasError: !!last_error })),
    runs: db.prepare('SELECT id,status FROM task_runs ORDER BY started_at DESC LIMIT 5').all(),
    tasks: db.prepare('SELECT id,song_id,status,operation,retry_count,error_code,execution_intent_json FROM download_tasks ORDER BY created_at').all()
      .map(({ execution_intent_json, ...row }) => ({ ...row, intent: JSON.parse(execution_intent_json || 'null') })),
    failures: db.prepare('SELECT id,status,failure_kind,song_id,download_task_ids FROM failure_records').all() }
}
async function start(mode = 'full') {
  for (let attempt = 0; attempt < 180; attempt++) {
    if (db.prepare("SELECT COUNT(*) n FROM source_sync_queue WHERE status IN ('pending','running')").get().n) {
      await delay(1000)
      continue
    }
    const result = await api(`/playlist-sources/${fixture.sourceId}/sync`, { mode })
    const request = result.data.results?.[0]
    // Only an explicit busy response proves no request was submitted; unknown writes are never retried.
    if (request?.status === 'busy') { await delay(1000); continue }
    if (request?.status !== 'accepted' || !request.requestId) throw new Error(`Sync request not accepted (${request?.status || 'missing'})`)
    return request
  }
  throw new Error('Previous private workload did not become idle within three minutes')
}
async function settle(requestId, expect = 'success') {
  for (let i = 0; i < 180; i++) {
    const request = db.prepare('SELECT q.status,r.status AS run_status FROM source_sync_queue q LEFT JOIN task_runs r ON r.id=q.run_id WHERE q.id=?').get(requestId)
    if (request && ['completed', 'failed', 'cancelled'].includes(request.status)) {
      if (expect !== 'any' && request.run_status !== expect) throw new Error(`Unexpected terminal run: ${request.run_status}`)
      return { request, state: state(), items: await items(), files: files() }
    }
    await delay(1000)
  }
  throw new Error('Sync settlement exceeded three minutes')
}
async function setup() {
  const cfg = credentials()
  const sections = (await plex('/library/sections')).Directory || []
  const template = sections.find(section => section.title === cfg.plex.section || section.key === cfg.plex.section)
  if (!template || template.type !== 'artist') throw new Error('Music library template missing')
  const params = new URLSearchParams({ name: fixture.title, type: 'artist', scanner: template.scanner,
    agent: template.agent, language: template.language || 'zh-CN', location: fixture.mediaRoot,
    'prefs[hidden]': '1', 'prefs[respectTags]': '1' })
  await plex(`/library/sections?${params}`, 'POST', true)
  const created = ((await plex('/library/sections')).Directory || []).filter(section => section.title === fixture.title)
  if (created.length !== 1 || created[0].Location?.[0]?.path !== fixture.mediaRoot) throw new Error('New library scope mismatch')
  fixture.libraryKey = created[0].key
  save('fixture', fixture)
  await plex(`/library/sections/${fixture.libraryKey}/refresh`, 'POST')
  for (let i = 0; i < 90; i++) {
    const tracks = (await plex(`/library/sections/${fixture.libraryKey}/all?type=10`)).Metadata || []
    if (tracks.length === 1) break
    if (i === 89) throw new Error('Seed media not indexed')
    await delay(2000)
  }
  const password = randomBytes(24).toString('hex')
  const login = await api('/setup/admin', { password })
  auth = { cookie: login.response.headers.getSetCookie().map(value => value.split(';')[0]).join('; '), csrf: login.data.csrfToken }
  save('auth', auth)
  const defaults = (await api('/setup/config')).data
  defaults.netease = { ...defaults.netease, cookie: cfg.netease.cookie, quality: 'standard' }
  defaults.plex = { ...cfg.plex, server: 'http://127.0.0.1', port: 3010, section: fixture.title }
  defaults.download = { ...defaults.download, dir: '/mnt/acceptance', plexLibraryPathPrefix: fixture.mediaRoot }
  defaults.sync = { ...defaults.sync, enabled: false, songLimit: 2, downloadConcurrency: 1, autoDownloadAlbum: false,
    unverifiedMediaPolicy: 'wait_manual',
    plexScanRetries: 12, plexScanRetryDelaySec: 5 }
  await api('/setup/complete', { config: defaults })
  return { libraryKey: fixture.libraryKey, seedIndexed: true }
}
async function initialize() {
  const before = files()
  const created = (await api('/playlist-sources', { neteasePlaylistId: fixture.playlistId, name: fixture.title, enabled: false })).data
  fixture.sourceId = created.id
  save('fixture', fixture)
  await api(`/playlist-sources/${created.id}`, { name: fixture.title, plexPlaylistName: fixture.title, enabled: false,
    syncLimit: 2, quality: 'standard', initializeMediaOnFirstSync: true, autoCreatePlexPlaylist: true }, 'PUT')
  await api(`/playlist-sources/${created.id}/initialization/start`, {})
  let initialization
  for (let i = 0; i < 180; i++) {
    initialization = (await api(`/playlist-sources/${created.id}/initialization`)).data.initialization
    if (initialization?.status === 'awaiting_review') break
    if (initialization?.status === 'failed') throw new Error('Initialization analysis failed')
    await delay(1000)
  }
  if (initialization?.status !== 'awaiting_review') throw new Error('Initialization analysis timed out')
  if (JSON.stringify(before) !== JSON.stringify(files())) throw new Error('Analysis changed media files')
  const preview = (await api(`/playlist-sources/${created.id}/initialization/quick-preview`, {
    initializationId: initialization.id, revision: initialization.revision, threshold: 85 })).data
  const body = { operationId: preview.operationId, token: preview.token, start: true }
  const first = (await api(`/playlist-sources/${created.id}/initialization/quick-confirm`, body)).data
  const second = (await api(`/playlist-sources/${created.id}/initialization/quick-confirm`, body)).data
  if (!first.requestId || first.requestId !== second.requestId) throw new Error('Repeated confirmation not idempotent')
  for (let i = 0; i < 240; i++) {
    const current = (await api(`/playlist-sources/${created.id}/initialization`)).data.initialization
    const pending = db.prepare("SELECT COUNT(*) n FROM source_sync_queue WHERE status IN ('pending','running')").get().n
    if (current.status === 'completed' && !pending) break
    if (current.quickStatus === 'failed') throw new Error('Quick execution failed')
    if (i === 239) throw new Error('Quick execution timed out')
    await delay(1000)
  }
  const result = await settle((await start()).requestId)
  if (result.items.length !== 2 || new Set(result.items.map(item => item.itemId)).size !== 2) throw new Error('Two-member baseline missing')
  return { preview: preview.counts, idempotentConfirmation: true, analysisFilesUnchanged: true, ...result }
}
async function cleanup() {
  let finalVerification
  if (existsSync(`${control}/observation-baseline.json`)) {
    const baseline = read('observation-baseline'), current = await items()
    const expected = baseline.items.map(item => [item.key, item.file])
    if (JSON.stringify(current.map(item => [item.key, item.file])) !== JSON.stringify(expected)
      || JSON.stringify(files()) !== JSON.stringify(baseline.files) || journal()) {
      throw new Error('Final observation readback differs from its baseline; retain scoped resources for review')
    }
    finalVerification = { members: current.length, orderMatchesBaseline: true, mediaHashesUnchanged: true, pendingWrites: 0 }
  }
  if (source()?.plex_playlist_rating_key) await plex(`/playlists/${await ownPlaylist()}`, 'DELETE')
  const sections = ((await plex('/library/sections')).Directory || []).filter(section => section.key === fixture.libraryKey)
  if (sections.length) {
    if (sections[0].title !== fixture.title || sections[0].Location?.[0]?.path !== fixture.mediaRoot) throw new Error('Cleanup library scope mismatch')
    await plex(`/library/sections/${fixture.libraryKey}`, 'DELETE')
  }
  return { removedOwnPlaylistAndLibrary: true, ...(finalVerification ? { finalVerification } : {}) }
}
async function deferredChoice() {
  const before = { items: await items(), files: files() }
  const bindings = db.prepare("SELECT b.netease_song_id,b.plex_rating_key,b.updated_at,a.ownership FROM song_identity_bindings b JOIN local_media_assets a ON a.netease_song_id=b.netease_song_id WHERE b.status='active' ORDER BY b.netease_song_id").all()
  if (bindings.length !== 2) throw new Error('Deferred-choice fixture needs two active identities')
  const deferred = bindings.find(binding => binding.ownership === 'external')
  const other = bindings.find(binding => binding.ownership === 'managed')
  if (!deferred || !other) throw new Error('Deferred-choice fixture needs adopted external and managed media')
  const key = await ownPlaylist(), removed = before.items.find(item => item.key === other.plex_rating_key)
  if (!removed) throw new Error('Other fixture song is absent before deferred test')
  save('deferred-proof', { ...deferred, ...before })
  await api(`/match-management/bindings/${deferred.netease_song_id}/unbind`, {
    mode: 'exclude_current', sourceId: fixture.sourceId, expectedBindingUpdatedAt: deferred.updated_at })
  await plex(`/playlists/${key}/items/${removed.itemId}`, 'DELETE')
  const request = await start(), outcome = await settle(request.requestId, 'any')
  const row = db.prepare('SELECT run_id FROM source_sync_queue WHERE id=?').get(request.requestId)
  const run = (await api(`/runs/${row.run_id}`)).data
  const current = db.prepare('SELECT status FROM song_identity_bindings WHERE netease_song_id=?').get(deferred.netease_song_id)
  if (current?.status !== 'unbound' || run.status !== 'partial' || run.failedSongs !== 0
    || run.issueCounts?.manual !== 1 || !outcome.items.some(item => item.key === other.plex_rating_key)
    || JSON.stringify(files()) !== JSON.stringify(before.files) || journal()) {
    throw new Error('Deferred choice blocked another identity or changed media')
  }
  return { runId: row.run_id, runStatus: run.status, manual: run.issueCounts.manual,
    otherSongRestored: true, deferredChoicePreserved: true, filesUnchanged: true }
}
async function restoreDeferred() {
  const proof = read('deferred-proof')
  const current = db.prepare('SELECT updated_at FROM song_identity_bindings WHERE netease_song_id=?').get(proof.netease_song_id)
  await api(`/match-management/bindings/${proof.netease_song_id}/rebind`, {
    sourceId: fixture.sourceId, ratingKey: proof.plex_rating_key, expectedBindingUpdatedAt: current.updated_at })
  const outcome = await settle((await start()).requestId)
  const identity = list => list.map(item => [item.key, item.file])
  if (JSON.stringify(identity(outcome.items)) !== JSON.stringify(identity(proof.items))
    || JSON.stringify(files()) !== JSON.stringify(proof.files) || journal()) throw new Error('Deferred fixture did not restore its baseline')
  return { restored: true, members: outcome.items.length, orderMatchesBaseline: true, filesUnchanged: true }
}
const [command, ...args] = process.argv.slice(2)
let result
try {
  switch (command) {
    case 'setup': result = await setup(); break
    case 'initialize': result = await initialize(); break
    case 'state': result = state(); break
    case 'snapshot': result = { ...state(), items: await items(), files: files() }; break
    case 'start': result = await start(args[0]); break
    case 'settle': result = await settle(args[0], args[1]); break
    case 'sync': result = await settle((await start(args[0])).requestId, args[1]); break
    case 'deferred-choice': result = await deferredChoice(); break
    case 'restore-deferred': result = await restoreDeferred(); break
    case 'remove-one': {
      const key = await ownPlaylist(), list = await items()
      if (list.length !== 2) throw new Error('Expected exactly two members before fault')
      await plex(`/playlists/${key}/items/${list[0].itemId}`, 'DELETE')
      result = { playlistKey: key, items: await items() }; break
    }
    case 'confirm-target': result = (await api(`/playlist-sources/${fixture.sourceId}/plex-target`, { ratingKey: await ownPlaylist() })).data; break
    case 'save-settings': await api(`/playlist-sources/${fixture.sourceId}`, { name: fixture.title }, 'PUT'); result = { journal: journal() }; break
    case 'retry': result = (await api('/tasks/failures/batch-retry', { ids: args })).data; break
    case 'sample': {
      const stream = await fetch(`${base}/api/sync/events`, { headers: { Cookie: auth.cookie }, signal: AbortSignal.timeout(5000) })
      if (!stream.ok) throw new Error('SSE open failed')
      await stream.body?.cancel()
      await delay(150)
      result = (await api('/system/runtime')).data
      break
    }
    case 'cleanup': result = await cleanup(); break
    default: throw new Error('Unknown acceptance command')
  }
  process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`)
} catch (error) {
  // Do not emit upstream exception objects, connection data or cookies.
  process.stdout.write(`${JSON.stringify({ ok: false, error: error.message.replace(/https?:\/\/\S+/g, '[url]') })}\n`)
  process.exitCode = 1
} finally { db.close() }
