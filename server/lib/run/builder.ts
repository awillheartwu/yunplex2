import type { SyncJob, JobStep, SongTask, StepStatus, SongStatus, StepError, JobStepContext } from '../job/types'
import { isDistinctWarningSongStatus } from '../../../lib/media-status-projection'
import { randomUUID } from 'node:crypto'

function uid(): string {
  return randomUUID().slice(0, 12)
}

export class RunBuilder {
  private job: SyncJob
  private activeSteps: Map<string, JobStep> = new Map()
  private songMap: Map<string, SongTask> = new Map()
  private sourceSongMap: Map<string, string[]> = new Map()
  private sourceSongIndexMap: Map<string, string> = new Map()
  private sourceRemovedSongMap: Map<string, string> = new Map()
  private sourceRemovedItemMap: Map<string, string> = new Map()
  private flatSteps: JobStep[] = []
  private stepGroups: Map<string, JobStep[]> = new Map()

  constructor(dryRun: boolean) {
    const id = uid()
    this.job = {
      id,
      type: 'sync',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      status: 'running',
      durationMs: 0,
      summary: '',
      source: '网易云音乐',
      target: 'Plex',
      totalSongs: 0,
      successSongs: 0,
      failedSongs: 0,
      skippedSongs: 0,
      removedSongs: 0,
      warnings: 0,
      dryRun,
      steps: [],
      songs: [],
      config: {},
    }
  }

  getId(): string { return this.job.id }

  setConfig(c: Partial<SyncJob['config']>): void {
    Object.assign(this.job.config, c)
  }

  setSourceIds(sourceIds: string[]): void {
    this.job.sourceIds = [...new Set(sourceIds.filter(Boolean))]
  }

  addSongs(sourceId: string, songs: { songName: string; artist: string; album: string; status: SongStatus; neteaseSongId?: number; neteaseIndex?: number }[]): string[] {
    const ids: string[] = []
    this.job.totalSongs += songs.length
    for (const s of songs) {
      const st: SongTask = {
        id: uid(),
        sourceId,
        neteaseSongId: s.neteaseSongId,
        neteaseIndex: s.neteaseIndex,
        songName: s.songName,
        artist: s.artist,
        album: s.album,
        status: s.status,
        phase: s.status === 'skipped_existing' ? 'done' : 'download',
      }
      this.songMap.set(st.id, st)
      ids.push(st.id)
      if (typeof st.neteaseSongId === 'number') {
        const key = this.makeSourceSongKey(sourceId, st.neteaseSongId)
        const occurrences = this.sourceSongMap.get(key) ?? []
        occurrences.push(st.id)
        this.sourceSongMap.set(key, occurrences)
        if (typeof st.neteaseIndex === 'number') {
          this.sourceSongIndexMap.set(this.makeSourceSongIndexKey(sourceId, st.neteaseIndex), st.id)
        }
      } else if (st.status === 'removed' || st.status === 'extra_skipped') {
        this.sourceRemovedSongMap.set(this.makeRemovedSongKey(sourceId, st.songName, st.artist, st.album), st.id)
      }
      this.job.songs.push(st)
    }
    return ids
  }

  /**
   * Register one concrete extra Plex playlist occurrence. Unlike the legacy
   * title/artist/album lookup this remains unambiguous for duplicate tracks.
   */
  addExtraSong(sourceId: string, song: {
    songName: string
    artist: string
    album: string
    playlistItemId: number
    ratingKey: string
    status?: Extract<SongStatus, 'removed' | 'extra_skipped'>
  }): string {
    const id = uid()
    const task: SongTask = {
      id,
      sourceId,
      songName: song.songName,
      artist: song.artist,
      album: song.album,
      status: song.status ?? 'extra_skipped',
      phase: 'done',
      metadata: {
        plexRatingKey: song.ratingKey,
        plexPlaylistItemId: song.playlistItemId,
      },
    }
    this.songMap.set(id, task)
    this.sourceRemovedItemMap.set(this.makeRemovedItemKey(sourceId, song.playlistItemId), id)
    this.sourceRemovedSongMap.set(this.makeRemovedSongKey(sourceId, song.songName, song.artist, song.album), id)
    this.job.songs.push(task)
    return id
  }

  // Step lifecycle
  startStep(
    type: string,
    title: string,
    options?: string | { parentId?: string; context?: JobStepContext },
  ): string {
    const parentId = typeof options === 'string' ? options : options?.parentId
    const context = typeof options === 'string' ? undefined : options?.context
    const id = uid()
    const step: JobStep = {
      id,
      type,
      title,
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      durationMs: 0,
      message: '',
      ...(context ? { context } : {}),
      children: [],
    }
    this.activeSteps.set(id, step)
    this.flatSteps.push(step)

    if (parentId) {
      const parent = this.flatSteps.find((s) => s.id === parentId)
      if (parent) parent.children.push(step)
    } else {
      this.job.steps.push(step)
    }

    return id
  }

  finishStep(id: string, status: StepStatus, message: string, error?: StepError): void {
    const step = this.activeSteps.get(id)
    if (!step) return

    step.status = status
    step.finishedAt = new Date().toISOString()
    step.durationMs = step.startedAt
      ? Date.now() - new Date(step.startedAt).getTime()
      : 0
    step.message = message
    if (error) step.error = error

    this.activeSteps.delete(id)
  }

  failStep(id: string, message: string, error: StepError): void {
    this.finishStep(id, 'failed', message, error)
    // Also mark any active child steps as cancelled
    for (const [cid, cstep] of this.activeSteps) {
      const flat = this.flatSteps.find((s) => s.id === cid)
      const isChild = flat && this.isDescendantOf(flat, id)
      if (isChild) {
        cstep.status = 'cancelled'
        cstep.finishedAt = new Date().toISOString()
        this.activeSteps.delete(cid)
      }
    }
  }

  // Song lifecycle
  updateSong(songId: string, update: Partial<Pick<SongTask, 'status' | 'phase' | 'filePath' | 'fileType' | 'metadata' | 'error' | 'ops'>>): void {
    const song = this.songMap.get(songId)
    if (!song) return

    if (update.status !== undefined) song.status = update.status
    if (update.phase !== undefined) song.phase = update.phase
    if (update.filePath !== undefined) song.filePath = update.filePath
    if (update.fileType !== undefined) song.fileType = update.fileType
    if (update.error !== undefined) song.error = update.error
    if (update.metadata !== undefined) song.metadata = { ...song.metadata, ...update.metadata }
    if (update.ops !== undefined) song.ops = update.ops

    const idx = this.job.songs.findIndex((s) => s.id === songId)
    if (idx >= 0) this.job.songs[idx] = { ...this.job.songs[idx]!, ...update } as SongTask
  }

  findSongId(sourceId: string, neteaseSongId: number): string | undefined {
    return this.findSongIds(sourceId, neteaseSongId)[0]
  }

  findSongIds(sourceId: string, neteaseSongId: number): string[] {
    return [...(this.sourceSongMap.get(this.makeSourceSongKey(sourceId, neteaseSongId)) ?? [])]
  }

  findSongIdByIndex(sourceId: string, neteaseIndex: number): string | undefined {
    return this.sourceSongIndexMap.get(this.makeSourceSongIndexKey(sourceId, neteaseIndex))
  }

  getSong(sourceId: string, neteaseSongId: number): SongTask | undefined {
    const id = this.findSongId(sourceId, neteaseSongId)
    return id ? this.songMap.get(id) : undefined
  }

  getSongByIndex(sourceId: string, neteaseIndex: number): SongTask | undefined {
    const id = this.findSongIdByIndex(sourceId, neteaseIndex)
    return id ? this.songMap.get(id) : undefined
  }

  findRemovedSongId(sourceId: string, songName: string, artist: string, album: string): string | undefined {
    return this.sourceRemovedSongMap.get(this.makeRemovedSongKey(sourceId, songName, artist, album))
  }

  findRemovedSongIdByPlaylistItemId(sourceId: string, playlistItemId: number): string | undefined {
    return this.sourceRemovedItemMap.get(this.makeRemovedItemKey(sourceId, playlistItemId))
  }

  // Finalize
  finish(status: 'success' | 'partial' | 'failed' | 'cancelled', summary: string): SyncJob {
    // Cancel any remaining active steps
    for (const [, step] of this.activeSteps) {
      step.status = 'cancelled'
      step.finishedAt = new Date().toISOString()
    }

    this.job.status = status
    this.job.finishedAt = new Date().toISOString()
    this.job.durationMs = Date.now() - new Date(this.job.startedAt).getTime()
    this.job.summary = summary

    // Compute stats
    this.job.successSongs = this.job.songs.filter((s) => s.status === 'success').length
    this.job.failedSongs = this.job.songs.filter((s) =>
      ['failed_download', 'failed_tags', 'failed_plex_match', 'failed_plex_insert'].includes(s.status),
    ).length
    this.job.skippedSongs = this.job.songs.filter((s) => s.status === 'skipped_existing').length
    this.job.removedSongs = this.job.songs.filter((s) => s.status === 'removed').length
    this.job.warnings = countDistinctWarningIssues(this.job.songs)

    return this.job
  }

  getRun(): SyncJob {
    return this.job
  }

  private isDescendantOf(step: JobStep, ancestorId: string): boolean {
    for (const s of this.flatSteps) {
      if (s.children.some((c) => c.id === step.id)) {
        if (s.id === ancestorId) return true
        return this.isDescendantOf(s, ancestorId)
      }
    }
    return false
  }

  private makeSourceSongKey(sourceId: string, neteaseSongId: number): string {
    return `${sourceId}:${neteaseSongId}`
  }

  private makeSourceSongIndexKey(sourceId: string, neteaseIndex: number): string {
    return `${sourceId}:target-index:${neteaseIndex}`
  }

  private makeRemovedSongKey(sourceId: string, songName: string, artist: string, album: string): string {
    return `${sourceId}:${songName}:${artist}:${album}`
  }


  private makeRemovedItemKey(sourceId: string, playlistItemId: number): string {
    return `${sourceId}:plex-item:${playlistItemId}`
  }
}

function countDistinctWarningIssues(songs: readonly SongTask[]): number {
  const keys = new Set<string>()
  for (const song of songs) {
    if (!isDistinctWarningSongStatus(song.status)) continue
    const trace = song.metadata?.matchTrace
    const relatedNeteaseSongId = typeof trace?.relatedNeteaseSongId === 'number'
      ? trace.relatedNeteaseSongId
      : undefined
    if (relatedNeteaseSongId !== undefined) {
      keys.add(`target:${song.sourceId ?? ''}:${relatedNeteaseSongId}`)
    } else if (typeof song.neteaseSongId === 'number') {
      keys.add(`target:${song.sourceId ?? ''}:${song.neteaseSongId}`)
    } else if (typeof song.metadata?.plexPlaylistItemId === 'number') {
      keys.add(`plex-item:${song.sourceId ?? ''}:${song.metadata.plexPlaylistItemId}`)
    } else {
      keys.add(`task:${song.id}`)
    }
  }
  return keys.size
}
