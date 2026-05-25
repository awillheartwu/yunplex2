import { existsSync } from 'node:fs'
import { join } from 'node:path'
import dayjs from 'dayjs'
import type { AppConfig } from '../config/types'
import type { SyncState } from '../log/types'
import { appendLog } from '../log/store'
import { checkCookie, fetchPlaylistSongs, getSongUrl, fetchLyric, fetchAlbumDetail, clearAlbumCache } from '../netease'
import { downloadSong, buildDownloadPath } from '../tag-writer'
import {
  initPlexClient,
  findPlaylist,
  getPlaylistTracks,
  refreshLibrary,
  searchTrack,
  insertTrackIntoPlaylist,
  getPlaylistItemId,
  movePlaylistItemToTop,
  movePlaylistItemAfter,
  getSectionKey,
} from '../plex-client'
import { JobBuilder } from '../job/builder'
import { saveJob, cleanupOldJobs } from '../job/store'
import type { SongTask, SongStatus } from '../job/types'
import { formatTrackArtist } from '../config/types'

export const STAGE_LABELS: Record<string, string> = {
  idle: '空闲',
  fetching_playlist: '获取歌单',
  comparing: '对比歌曲',
  downloading: '下载歌曲',
  processing_tags: '写入元数据',
  refreshing_plex: '刷新 Plex 库',
  updating_plex_playlist: '更新 Plex 歌单',
  cancelled: '已取消',
  error: '同步错误',
}

function createInitialState(): SyncState {
  return {
    isRunning: false, currentStage: 'idle', startedAt: null,
    lastSyncAt: null, lastSyncResult: null, syncCount: 0,
    successCount: 0, failureCount: 0, currentSong: null,
    progress: null, failures: [], dryRun: false,
  }
}

export function getSyncService(dataDir: string, getConfig: () => AppConfig) {
  let state = createInitialState()
  let cancelRequested = false

  function getState(): SyncState { return { ...state } }

  function log(level: 'info' | 'warn' | 'error', message: string, detail?: string) {
    const cfg = getConfig()
    appendLog(dataDir, { level, message, detail, stage: state.currentStage }, cfg.sync.logRetentionDays ?? 30)
  }

  async function runSync(options?: { dryRun?: boolean }): Promise<SyncState> {
    if (state.isRunning) throw new Error('同步任务已在运行中，请等待当前任务完成')

    clearAlbumCache()

    const dryRun = options?.dryRun ?? false
    cancelRequested = false
    state = { ...createInitialState(), isRunning: true, startedAt: new Date().toISOString(), dryRun }

    const job = new JobBuilder(dryRun)

    try {
      const cfg = getConfig()
      cleanupOldJobs(cfg.sync.jobRetentionSuccessDays ?? 7, cfg.sync.jobRetentionFailedDays ?? 90)
      const multiFormat = cfg.other?.multiArtistFormat ?? 'ampersand'

      // Returns [albumArtist, trackArtist]
      // albumArtist: always first artist only (for Plex library organization)
      // trackArtist: empty for single artist, formatted for collabs (e.g. "A, B & C")
      const splitArtists = (artists: { name: string }[]): [string, string] => {
        if (artists.length === 0) return ['', '']
        const albumArtist = artists[0].name
        if (artists.length === 1) return [albumArtist, '']
        const trackArtist = formatTrackArtist(artists.map((a) => a.name), multiFormat)
        return [albumArtist, trackArtist]
      }

      const joinArtist = (artists: { name: string }[]) => {
        // Legacy: still used for display/log messages
        return splitArtists(artists)[0]
      }
      job.setConfig({
        playlistId: cfg.netease.playlistIds[0],
        quality: cfg.netease.quality,
        server: cfg.plex.server,
        section: cfg.plex.section,
      })

      // ── Validate ──
      if (!cfg.netease.cookie) throw new Error('未配置网易云 Cookie')
      if (cfg.netease.playlistIds.length === 0) throw new Error('未配置歌单 ID')
      if (!cfg.plex.server || !cfg.plex.token) throw new Error('未配置 Plex 服务器地址或 Token')

      // ── Step 1: Fetch playlist ──
      const s1 = job.startStep('fetch_playlist', '获取网易云歌单')
      setStage('fetching_playlist')
      log('info', '验证网易云 Cookie...')

      const cookieCheck = await checkCookie(cfg.netease.cookie)
      if (!cookieCheck.valid) {
        const err = { title: 'Cookie 验证失败', message: '网易云 Cookie 已失效，请重新获取并更新配置', stage: 'fetch_playlist' }
        job.failStep(s1, 'Cookie 验证失败', err)
        throw new Error(err.message)
      }

      const playlistId = cfg.netease.playlistIds[0]
      const yunSongs = await fetchPlaylistSongs(playlistId, cfg.sync.songLimit, cfg.netease.cookie)
      job.finishStep(s1, 'success', `歌单获取完成，共 ${yunSongs.length} 首歌曲`)

      if (yunSongs.length === 0) {
        const j = job.finish('success', '歌单为空，无需同步')
        saveJob(j)
        finishState('success')
        return { ...state }
      }

      // Register all songs
      const allSongs = yunSongs.map((s) => ({
        songName: s.name,
        artist: joinArtist(s.artists),
        album: s.album.name,
        status: 'pending' as SongStatus,
      }))
      job.addSongs(allSongs)

      // ── Step 2: Compare ──
      const s2 = job.startStep('compare', '对比 Plex 歌单')
      setStage('comparing')
      log('info', '连接 Plex...')

      await initPlexClient(cfg.plex)
      const playlistName = (await fetchPlaylistName(playlistId)) || `网易云歌单 #${playlistId}`
      const plexPlaylist = await findPlaylist(playlistName)
      if (!plexPlaylist) {
        const err = { title: '未找到 Plex 歌单', message: `Plex 中未找到同名歌单 "${playlistName}"，请在 Plex 中创建`, stage: 'compare' }
        job.failStep(s2, '歌单不存在', err)
        throw new Error(err.message)
      }

      const plexTracks = await getPlaylistTracks(plexPlaylist.ratingKey, cfg.sync.songLimit)

      for (let i = 0; i < yunSongs.length; i++) {
        const yunName = yunSongs[i].name
        const [albumArtist] = splitArtists(yunSongs[i].artists)

        const exists = plexTracks.some((pt) => {
          const yunCore = normalizeTitle(yunName)
          const plexCore = normalizeTitle(pt.title)
          const titleMatch =
            (yunCore && plexCore && yunCore === plexCore) ||
            (yunCore && plexCore && stripPunct(yunCore) === stripPunct(plexCore))
          if (!titleMatch) return false

          // Artist: lenient includes
          const artistMatch = !albumArtist || !pt.grandparentTitle ||
            albumArtist.toLowerCase() === pt.grandparentTitle.toLowerCase() ||
            albumArtist.toLowerCase().includes(pt.grandparentTitle.toLowerCase()) ||
            pt.grandparentTitle.toLowerCase().includes(albumArtist.toLowerCase())

          // Album: lenient stripped (disambiguate same-title on different albums)
          const yunAlbum = normalizeTitle(yunSongs[i].album.name)
          const plexAlbum = normalizeTitle(pt.parentTitle || '')
          const albumMatch = !yunAlbum || !plexAlbum ||
            yunAlbum === plexAlbum ||
            stripPunct(yunAlbum) === stripPunct(plexAlbum) ||
            stripPunct(yunAlbum).includes(stripPunct(plexAlbum)) ||
            stripPunct(plexAlbum).includes(stripPunct(yunAlbum))

          return artistMatch && albumMatch
        })

        if (exists) {
          const songId = job.getJob().songs[i]?.id
          if (songId) {
            job.updateSong(songId, { status: 'skipped_existing', phase: 'done' })
            yunSongs[i].sync = true
          }
        }
      }

      const newCount = yunSongs.filter((s) => !s.sync).length
      job.finishStep(s2, 'success', `发现 ${newCount} 首新歌曲，${yunSongs.length - newCount} 首已存在`)
      const newSongs = yunSongs.filter((s) => !s.sync)

      // ── Step 3 & 4: Download + Tags ──
      const sectionKey = await getSectionKey(cfg.plex.section)
      let needRefresh = false

      if (newSongs.length > 0) {
        const s3 = job.startStep('download', '下载歌曲')
        const totalNew = newSongs.length

        for (let i = 0; i < newSongs.length; i++) {
          if (cancelRequested) {
            for (let j = i; j < totalNew; j++) {
              const id = job.getJob().songs.find(
                (st) => st.songName === newSongs[j].name && st.status === 'pending',
              )?.id
              if (id) job.updateSong(id, { status: 'pending' })
            }
            const j = job.finish('cancelled', '用户取消')
            saveJob(j)
            finishState('success')
            return { ...state }
          }

          const song = newSongs[i]
          const [albumArtist, trackArtist] = splitArtists(song.artists)
          const displayArtist = trackArtist || albumArtist
          const songId = job.getJob().songs.find(
            (s) => s.songName === song.name && s.status === 'pending',
          )?.id
          if (!songId) continue

          const childId = job.startStep('download_single', `${song.name} - ${displayArtist}`, s3)

          try {
            if (dryRun) {
              log('info', `[预览] 将下载: ${song.name}`)
              job.updateSong(songId, { status: 'success', phase: 'done' })
              job.finishStep(childId, 'success', '[预览] 跳过下载')
            } else {
              log('info', `下载: ${song.name}`)
              const { url, type: fileType } = await getSongUrl(song.id, cfg.netease.quality, cfg.netease.cookie)

              const pathVars = {
                artist: albumArtist,
                album: song.album.name,
                title: song.name,
                year: song.album.publishTime > 0 ? dayjs(song.album.publishTime).format('YYYY') : '',
                track: String(song.no),
                'track:02d': String(song.no).padStart(2, '0'),
              }
              const relativePath = buildDownloadPath(cfg.other?.pathFormat ?? '{artist}/{album} ({year})/{title}', pathVars, fileType)
              const targetPath = join(cfg.download.dir, relativePath)

              if (existsSync(targetPath)) {
                // Check if Plex already has this track indexed
                let plexReady = false
                if (sectionKey && !dryRun) {
                  const existing = await searchTrack(sectionKey, song.name, albumArtist, song.album.name)
                  plexReady = !!existing
                }
                job.updateSong(songId, {
                  status: 'success', phase: 'done',
                  filePath: targetPath, fileType,
                  metadata: {
                    trackNumber: song.no, quality: cfg.netease.quality,
                    duration: song.dt, disc: song.disc || '1',
                  },
                  ops: { download: 'skipped', lyric: 'skipped', tags: 'skipped', cover: 'skipped' },
                })
                if (!plexReady) needRefresh = true
                job.finishStep(childId, 'success', plexReady
                  ? `已在 Plex 库中，跳过下载 (${fileType.toUpperCase()})`
                  : `文件已存在，跳过下载 (${fileType.toUpperCase()})`)
              } else {
                needRefresh = true
                const lyricData = cfg.download.downloadLyrics
                  ? await fetchLyric(
                      song.id,
                      cfg.netease.cookie,
                      cfg.other?.lyricOrder ?? 'original_first',
                      cfg.other?.downloadTranslatedLyric ?? true,
                    )
                  : undefined

                const albumDetail = await fetchAlbumDetail(song.album.id, cfg.netease.cookie)

                const songMeta = {
                  title: song.name,
                  albumArtist,
                  trackArtist,
                  album: song.album.name,
                  trackNumber: song.no,
                  // v3 / old API first, album detail as fallback (common for singles)
                  publishTime: song.album.publishTime || albumDetail?.publishTime || 0,
                  picUrl: song.album.picUrl,
                  duration: song.dt,
                  discNumber: song.disc || '1',
                  totalDiscs: albumDetail?.totalDiscs ?? 1,
                  totalTracks: albumDetail?.size ?? 0,
                  genre: albumDetail?.genre ?? '',
                  releaseDate: (song.album.publishTime || albumDetail?.publishTime || 0) > 0
                    ? dayjs(song.album.publishTime || albumDetail?.publishTime).format('YYYY-MM-DD')
                    : '',
                  albumDescription: albumDetail?.description ?? '',
                  recordLabel: albumDetail?.company ?? '',
                  releaseType: albumDetail?.type ?? '',
                  artistImgUrl: albumDetail?.artistImgUrl ?? '',
                }

                const result = await downloadSong(url, songMeta, fileType, cfg.download.dir, {
                  writeLyrics: cfg.download.downloadLyrics,
                  embedMetadata: cfg.download.embedMetadata,
                  embedCover: cfg.download.embedCover,
                  saveAlbumCover: cfg.download.saveAlbumCover ?? false,
                  saveArtistImage: cfg.download.saveArtistImage ?? false,
                  lyrics: lyricData?.merged,
                  translatedLyric: lyricData?.translated,
                  separateLyricFiles: lyricData?.separateFiles,
                }, relativePath)

                job.updateSong(songId, {
                  status: 'success', phase: 'done',
                  filePath: result.filePath, fileType,
                  metadata: {
                    trackNumber: song.no,
                    quality: cfg.netease.quality,
                    duration: song.dt,
                    disc: song.disc || '1',
                    genre: albumDetail?.genre ?? '',
                    label: albumDetail?.company ?? '',
                    releaseDate: songMeta.releaseDate,
                  },
                  ops: result.ops,
                })
                const opsSummary = opsSummaryText(result.ops)
                job.finishStep(childId, 'success', `下载完成 (${fileType.toUpperCase()})${opsSummary}`)
              }

              updateProgress(i + 1, totalNew, song.name)
            }
          } catch (err) {
            const errorMsg = err instanceof Error ? err.message : '下载失败'
            log('error', `下载失败: ${song.name}`, errorMsg)
            job.updateSong(songId, {
              status: 'failed_download', phase: 'download',
              error: { title: '歌曲下载失败', message: errorMsg, stage: 'download', songName: song.name, artist },
            })
            job.failStep(childId, '下载失败', {
              title: '歌曲下载失败', message: errorMsg, stage: 'download',
              songName: song.name, artist,
              context: { songId: song.id, quality: cfg.netease.quality },
            })
            addFailure(song.name, errorMsg)
          }
        }

        const failCount = job.getJob().songs.filter((s) => ['failed_download', 'failed_tags'].includes(s.status)).length
        const okCount = newSongs.length - failCount
        job.finishStep(s3, failCount > 0 ? 'partial' : 'success', `${okCount} 首成功，${failCount} 首失败`)
      }

      // ── Steps 5 & 6: Plex refresh + update ──
      const successfulNew = job.getJob().songs.filter((s) => s.status === 'success').length
      if (!dryRun && successfulNew > 0) {
        if (needRefresh && sectionKey) {
          const s5 = job.startStep('refresh_plex', '刷新 Plex 音乐库')
          setStage('refreshing_plex')

          await refreshLibrary(sectionKey)

          // Wait for Plex to scan new files — poll for the first track, then
        // give remaining tracks a per-file cooldown. Max 30s total.
          const allNew = job.getJob().songs.filter((s) => s.status === 'success')
          const probe = allNew[0]
          const probeTimeout = Date.now() + 30000
          let probeFound = false

          if (probe) {
            log('info', `等待 Plex 扫描 (${allNew.length} 首，探针: ${probe.songName})...`)
            while (!probeFound && Date.now() < probeTimeout) {
              if (cancelRequested) break
              await new Promise((r) => setTimeout(r, 3000))
              const found = await searchTrack(sectionKey, probe.songName, probe.artist, probe.album)
              if (found) probeFound = true
            }
          } else {
            probeFound = true
          }

          if (probeFound && allNew.length > 1) {
            // Per-file cooldown: 2s per remaining track
            const wait = Math.min(allNew.length * 2, 10) * 1000
            await new Promise((r) => setTimeout(r, wait))
          }

          log('info', probeFound ? 'Plex 扫描完成' : 'Plex 扫描超时 (30s)')
          job.finishStep(s5, 'success', probeFound ? 'Plex 库刷新完成' : 'Plex 扫描超时 (30s)')
        }

        // ── Step 6: Update Plex playlist ──
        const s6 = job.startStep('update_plex_playlist', '更新 Plex 歌单')
        setStage('updating_plex_playlist')

        const doneSongs = job.getJob().songs.filter((s) => s.status === 'success')
        let afterItemId: number | null = null
        let isFirst = true
        for (const songTask of doneSongs) {
          if (cancelRequested) break
          const childId = job.startStep('plex_insert', `${songTask.songName} - ${songTask.artist}`, s6)

          try {
            const track = await searchTrack(sectionKey!, songTask.songName, songTask.artist, songTask.album)
            if (track) {
              await insertTrackIntoPlaylist(plexPlaylist!.ratingKey, track.ratingKey)
              const itemId = await getPlaylistItemId(plexPlaylist!.ratingKey, songTask.songName, songTask.album)
              if (itemId) {
                if (isFirst) {
                  await movePlaylistItemToTop(plexPlaylist!.ratingKey, itemId)
                  isFirst = false
                } else if (afterItemId) {
                  await movePlaylistItemAfter(plexPlaylist!.ratingKey, itemId, afterItemId)
                }
                afterItemId = itemId
              }
              job.finishStep(childId, 'success', '已添加到歌单')
            } else {
              job.updateSong(songTask.id, {
                status: 'failed_plex_match',
                error: { title: 'Plex 匹配失败', message: 'Plex 中搜索不到该歌曲', stage: 'plex_match', songName: songTask.songName, artist: songTask.artist },
              })
              job.failStep(childId, 'Plex 匹配失败', {
                title: 'Plex 匹配失败', message: 'Plex 中搜索不到该歌曲', stage: 'plex_match',
                songName: songTask.songName, artist: songTask.artist,
              })
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : '插入失败'
            job.updateSong(songTask.id, {
              status: 'failed_plex_insert',
              error: { title: 'Plex 插入失败', message: msg, stage: 'plex_insert', songName: songTask.songName, artist: songTask.artist },
            })
            job.failStep(childId, 'Plex 插入失败', {
              title: 'Plex 插入失败', message: msg, stage: 'plex_insert',
              songName: songTask.songName, artist: songTask.artist,
            })
          }
        }

        job.finishStep(s6, 'success', 'Plex 歌单更新完成')
      }

      // ── Finalize ──
      const succCount = job.getJob().songs.filter((s) => s.status === 'success').length
      const failCount = job.getJob().songs.filter((s) =>
        ['failed_download', 'failed_tags', 'failed_plex_match', 'failed_plex_insert'].includes(s.status),
      ).length

      let jobStatus: 'success' | 'partial' | 'failed' = 'success'
      if (failCount > 0 && succCount > 0) jobStatus = 'partial'
      else if (failCount > 0 && succCount === 0) jobStatus = 'failed'

      const summary = dryRun
        ? `[预览] 发现 ${newSongs.length} 首新歌曲`
        : failCount > 0
          ? `成功 ${succCount} 首，失败 ${failCount} 首`
          : `新增 ${succCount} 首歌曲`

      const finishedJob = job.finish(jobStatus, summary)
      saveJob(finishedJob)

      log('info', summary)
      finishState(finishedJob.status === 'success' ? 'success' : 'failure')
      return { ...state }
    } catch (err) {
      if (err instanceof CancellationError) {
        const j = job.finish('cancelled', '用户取消')
        saveJob(j)
        finishState('success')
        return { ...state }
      }

      const message = err instanceof Error ? err.message : '未知错误'
      log('error', `同步失败: ${message}`)

      const j = job.finish('failed', message)
      saveJob(j)
      finishState('failure')
      return { ...state }
    } finally {
      state.isRunning = false
    }
  }

  function cancelSync(): boolean {
    if (!state.isRunning) return false
    cancelRequested = true
    return true
  }

  function setStage(stage: SyncState['currentStage']) { state.currentStage = stage }
  function updateProgress(current: number, total: number, songName?: string) {
    state.progress = { current, total }
    if (songName) state.currentSong = songName
  }
  function addFailure(songName: string, reason: string) {
    state.failures.push({ songName, reason, timestamp: new Date().toISOString() })
  }
  function finishState(result: 'success' | 'failure') {
    state.lastSyncAt = new Date().toISOString()
    state.lastSyncResult = result
    state.syncCount++
    if (result === 'success') state.successCount++
    else state.failureCount++
    state.progress = null
    state.currentSong = null
  }

  return { getState, runSync, cancelSync }
}

function opsSummaryText(ops: NonNullable<SongTask['ops']>): string {
  const parts: string[] = []
  parts.push(ops.download === 'ok' ? '✓文件' : '✗文件')
  if (ops.lyric === 'ok') parts.push('✓歌词')
  else if (ops.lyric === 'failed') parts.push('✗歌词')
  if (ops.tags === 'ok') parts.push('✓标签')
  else if (ops.tags === 'failed') parts.push('✗标签')
  if (ops.cover === 'ok') parts.push('✓封面')
  else if (ops.cover === 'failed') parts.push('✗封面')
  return '  ' + parts.join(' ')
}

class CancellationError extends Error { constructor() { super('Cancelled') } }

function normalizeTitle(title: string): string {
  return title
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s*\[[^\]]*\]\s*/g, ' ')
    .trim()
}

function stripPunct(s: string): string {
  return s.toLowerCase().replace(/[/\\:*?"'<>|&\s'""]+/g, '')
}

async function fetchPlaylistName(playlistId: number): Promise<string | null> {
  try {
    const res = await fetch(`https://music.163.com/api/v1/playlist/detail?id=${playlistId}`)
    const body = (await res.json()) as { playlist?: { name?: string } }
    return body.playlist?.name ?? null
  } catch { return null }
}

