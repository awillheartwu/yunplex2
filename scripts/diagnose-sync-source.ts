import { createHash } from 'node:crypto'
import { closeDb, initDb } from '../server/lib/db'
import { readConfig, setDataDir } from '../server/lib/config/store'
import { getSource } from '../server/lib/playlist/store'
import { getPlaylistTracks, initPlexClient } from '../server/lib/plex-client'
import { getRun, listRuns } from '../server/lib/run/store'
import { getSyncService } from '../server/lib/sync/service'

interface CliOptions {
  sourceId: string
  runs: number
  apply: boolean
  forceFull: boolean
  rebuildMatch: boolean
  dataDir: string
  verbose: boolean
}

type PlaylistSnapshot = Awaited<ReturnType<typeof snapshotPlaylist>>
type RunSummary = ReturnType<typeof summarizeLatestRun>
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

  return {
    sourceId,
    runs,
    apply: args.includes('--apply'),
    forceFull: args.includes('--force-full'),
    rebuildMatch: args.includes('--rebuild-match'),
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
  }))

  return {
    count: items.length,
    identityFingerprint: sha256(items.map(item => item.ratingKey)),
    occurrenceFingerprint: sha256(items.flatMap(item => [item.ratingKey, item.playlistItemId])),
    items,
  }
}

function summarizeLatestRun(sourceId: string) {
  const latest = listRuns({ type: 'sync', sourceId, limit: 1 }).items[0]
  if (!latest) throw new Error('同步完成后未找到对应运行记录')
  const run = getRun(latest.id)
  if (!run) throw new Error(`无法读取运行记录 ${latest.id}`)

  const statusCounts = Object.fromEntries(
    [...new Set(run.songs.map(song => song.status))]
      .sort()
      .map(status => [status, run.songs.filter(song => song.status === status).length]),
  )
  const attention = run.songs
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
    totalSongs: run.totalSongs,
    successSongs: run.successSongs,
    failedSongs: run.failedSongs,
    removedSongs: run.removedSongs,
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
  const service = getSyncService(options.dataDir, readConfig)
  const observations: Observation[] = [
    { phase: 'before', playlist: await snapshotPlaylist(source.plexPlaylistRatingKey) },
  ]

  for (let index = 1; index <= options.runs; index++) {
    await service.runSyncForSource(source.id, {
      dryRun: !options.apply,
      forceFull: options.forceFull,
      rebuildMatch: options.rebuildMatch,
      trigger: 'user',
    })
    observations.push({
      phase: `after-${index}`,
      playlist: await snapshotPlaylist(source.plexPlaylistRatingKey),
      run: summarizeLatestRun(source.id),
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
