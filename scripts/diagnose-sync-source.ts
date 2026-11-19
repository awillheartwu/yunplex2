import { createHash } from 'node:crypto'
import { closeDb, initDb } from '../server/lib/db'
import { readConfig, setDataDir } from '../server/lib/config/store'
import { getSource } from '../server/lib/playlist/store'
import { getPlaylistTracks, initPlexClient } from '../server/lib/plex-client'
import { RunBuilder } from '../server/lib/run/builder'
import { getSyncService } from '../server/lib/sync/service'
import type { SyncMode } from '../server/lib/sync/service-state'
import type { SyncJob } from '../server/lib/job/types'

interface CliOptions {
  sourceId: string
  runs: number
  apply: boolean
  mode: SyncMode
  dataDir: string
  verbose: boolean
}

type PlaylistSnapshot = Awaited<ReturnType<typeof snapshotPlaylist>>
type RunSummary = ReturnType<typeof summarizeRun>
interface Observation { phase: string; playlist: PlaylistSnapshot; run?: RunSummary }

function readOption(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`
  const inline = args.find(arg => arg.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : undefined
}

function parseOptions(args: string[]): CliOptions {
  const sourceId = readOption(args, 'source')?.trim()
  if (!sourceId) throw new Error('缺少 --source <歌单源 ID>')

  const runs = Number(readOption(args, 'runs') ?? '1')
  if (!Number.isInteger(runs) || runs < 1 || runs > 5) {
    throw new Error('--runs 必须是 1–5 的整数')
  }

  const apply = args.includes('--apply')
  const requestedMode = readOption(args, 'mode')
  const mode: SyncMode = !apply
    ? 'preview'
    : requestedMode === 'rebuild_matching'
      ? 'rebuild_matching'
      : requestedMode === 'full'
        ? 'full'
        : 'normal'

  return {
    sourceId,
    runs,
    apply,
    mode,
    dataDir: readOption(args, 'data-dir')?.trim() || './data',
    verbose: args.includes('--verbose'),
  }
}

function sha256(parts: Array<string | number | null | undefined>): string {
  return createHash('sha256').update(parts.map(value => String(value ?? '')).join('\n')).digest('hex')
}

async function snapshotPlaylist(playlistRatingKey: string) {
  const tracks = await getPlaylistTracks(playlistRatingKey, 99_999)
  const items = tracks.map((track, index) => ({
    index,
    ratingKey: track.ratingKey,
    playlistItemId: track.playlistItemID,
    title: track.title,
    artist: track.grandparentTitle,
    album: track.parentTitle,
    guid: track.guid,
    filePaths: (track.Media ?? []).flatMap(media =>
      media.Part?.flatMap(part => part.file ? [part.file] : []) ?? [],
    ),
  }))
  const duplicateRatingKeys = duplicates(items.map(item => item.ratingKey))
  const duplicatePlaylistItemIds = duplicates(
    items.flatMap(item => item.playlistItemId === undefined ? [] : [String(item.playlistItemId)]),
  )

  return {
    count: items.length,
    identityFingerprint: sha256(items.map(item => item.ratingKey)),
    occurrenceFingerprint: sha256(items.flatMap(item => [item.ratingKey, item.playlistItemId])),
    duplicateRatingKeys,
    duplicatePlaylistItemIds,
    items,
  }
}

function duplicates(values: string[]): string[] {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([value]) => value)
    .sort()
}

function summarizeRun(run: SyncJob, sourceId: string) {
  const sourceSongs = run.songs.filter(song => song.sourceId === sourceId)
  const statusCounts = Object.fromEntries(
    [...new Set(sourceSongs.map(song => song.status))]
      .sort()
      .map(status => [status, sourceSongs.filter(song => song.status === status).length]),
  )
  const attention = sourceSongs
    .filter(song => !['success', 'skipped_existing', 'removed'].includes(song.status))
    .map(song => ({
      songId: song.neteaseSongId,
      title: song.songName,
      artist: song.artist,
      status: song.status,
      error: song.error?.message,
      cause: song.error?.context?.cause,
      deletionProtectionReason: song.metadata?.matchTrace?.deletionProtectionReason,
    }))

  return {
    id: run.id,
    status: run.status,
    summary: run.summary,
    totalSongs: sourceSongs.length,
    successSongs: sourceSongs.filter(song => ['success', 'skipped_existing'].includes(song.status)).length,
    failedSongs: sourceSongs.filter(song => song.status.startsWith('failed_')).length,
    removedSongs: sourceSongs.filter(song => song.status === 'removed').length,
    warnings: run.warnings,
    statusCounts,
    attention,
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2))
  setDataDir(options.dataDir)
  initDb(options.dataDir)

  const config = readConfig()
  const source = getSource(options.sourceId)
  if (!source) throw new Error(`歌单源不存在：${options.sourceId}`)
  if (!source.plexPlaylistRatingKey) throw new Error('歌单源尚未关联 Plex 歌单')

  await initPlexClient(config.plex)
  const service = getSyncService(readConfig)
  const observations: Observation[] = [
    { phase: 'before', playlist: await snapshotPlaylist(source.plexPlaylistRatingKey) },
  ]

  for (let index = 1; index <= options.runs; index++) {
    const run = new RunBuilder(options.mode === 'preview')
    await service.runSync({
      mode: options.mode,
      sourceIds: [source.id],
      trigger: 'user',
    }, run)
    observations.push({
      phase: `after-${index}`,
      playlist: await snapshotPlaylist(source.plexPlaylistRatingKey),
      run: summarizeRun(run.getRun(), source.id),
    })
  }

  const outputObservations = observations.map((observation, index) => {
    const previous = observations[index - 1]?.playlist
    const unchangedFromPrevious = previous
      ? previous.identityFingerprint === observation.playlist.identityFingerprint
        && previous.occurrenceFingerprint === observation.playlist.occurrenceFingerprint
      : null
    return {
      phase: observation.phase,
      playlist: options.verbose
        ? { ...observation.playlist, unchangedFromPrevious }
        : {
            count: observation.playlist.count,
            identityFingerprint: observation.playlist.identityFingerprint,
            occurrenceFingerprint: observation.playlist.occurrenceFingerprint,
            unchangedFromPrevious,
          },
      ...(observation.run ? { run: observation.run } : {}),
    }
  })

  console.log(JSON.stringify({
    mode: options.apply ? 'apply' : 'dry-run',
    source: { id: source.id, name: source.name, plexPlaylistRatingKey: source.plexPlaylistRatingKey },
    observations: outputObservations,
  }, null, 2))
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error))
    process.exitCode = 1
  })
  .finally(() => closeDb())
