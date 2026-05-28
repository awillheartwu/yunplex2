import type { SyncJob, JobStep, SongTask, StepStatus, SongStatus, StepError } from './types'
import { randomUUID } from 'node:crypto'

function uid(): string {
  return randomUUID().slice(0, 12)
}

export class JobBuilder {
  private job: SyncJob
  private activeSteps: Map<string, JobStep> = new Map()
  private songMap: Map<string, SongTask> = new Map()
  private flatSteps: JobStep[] = []
  private stepGroups: Map<string, JobStep[]> = new Map()

  constructor(dryRun: boolean) {
    const id = uid()
    this.job = {
      id,
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

  addSongs(sourceId: string, songs: { songName: string; artist: string; album: string; status: SongStatus }[]): void {
    this.job.totalSongs += songs.length
    for (const s of songs) {
      const st: SongTask = {
        id: uid(),
        sourceId,
        songName: s.songName,
        artist: s.artist,
        album: s.album,
        status: s.status,
        phase: s.status === 'skipped_existing' ? 'done' : 'download',
      }
      this.songMap.set(st.id, st)
      this.job.songs.push(st)
    }
  }

  // Step lifecycle
  startStep(type: string, title: string, parentId?: string): string {
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
    if (idx >= 0) this.job.songs[idx] = { ...this.job.songs[idx], ...update }
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

    return this.job
  }

  getJob(): SyncJob {
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
}
