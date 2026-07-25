import { describe, expect, it } from 'vitest'
import {
  buildQueueMetrics,
  buildSongFlowStages,
  sortLiveTasks,
  taskProgressSummary,
  taskStatusLabel,
} from './task-center-download-presentation'

describe('task center download presentation', () => {
  it('labels done sync tasks as downstream processing', () => {
    expect(taskStatusLabel({
      id: '1',
      sourceId: 'source-a',
      songId: 1,
      songName: 'Song A',
      artist: 'Artist',
      album: 'Album',
      status: 'done',
      progress: 100,
      retryCount: 0,
      createdAt: '2026-07-25T10:00:00.000Z',
      updatedAt: '2026-07-25T10:01:00.000Z',
    }, 'sync')).toBe('后续处理中')
  })

  it('marks completed sync downloads as waiting in Plex stage', () => {
    const stages = buildSongFlowStages({
      runType: 'sync',
      currentStage: 'refreshing_plex',
      task: {
        id: '2',
        sourceId: 'source-a',
        songId: 2,
        songName: 'Song B',
        artist: 'Artist',
        album: 'Album',
        status: 'done',
        progress: 100,
        retryCount: 0,
        createdAt: '2026-07-25T10:00:00.000Z',
        updatedAt: '2026-07-25T10:02:00.000Z',
      },
    })

    expect(stages.map(stage => stage.state)).toEqual(['complete', 'complete', 'current', 'upcoming'])
  })

  it('describes downstream sync progress with Plex-specific copy', () => {
    expect(taskProgressSummary({
      runType: 'sync',
      currentStage: 'updating_plex_playlist',
      task: {
        id: '3',
        sourceId: 'source-a',
        songId: 3,
        songName: 'Song C',
        artist: 'Artist',
        album: 'Album',
        status: 'done',
        progress: 100,
        retryCount: 0,
        createdAt: '2026-07-25T10:00:00.000Z',
        updatedAt: '2026-07-25T10:03:00.000Z',
      },
    })).toContain('正在更新歌单')
  })

  it('surfaces downstream metrics for sync runs', () => {
    const metrics = buildQueueMetrics({
      pending: 4,
      downloading: 2,
      tagging: 1,
      done: 5,
      failed: 0,
      total: 12,
    }, 'sync')

    expect(metrics.map(metric => metric.label)).toEqual(['下载中', '写标签', '后续处理中', '等待下载'])
  })

  it('sorts running work ahead of downstream and pending items', () => {
    const tasks = sortLiveTasks([
      {
        id: 'pending',
        sourceId: null,
        songId: 3,
        songName: 'Pending',
        artist: 'Artist',
        album: 'Album',
        status: 'pending',
        progress: 0,
        retryCount: 0,
        createdAt: '2026-07-25T10:02:00.000Z',
        updatedAt: '2026-07-25T10:02:00.000Z',
      },
      {
        id: 'done',
        sourceId: null,
        songId: 2,
        songName: 'Done',
        artist: 'Artist',
        album: 'Album',
        status: 'done',
        progress: 100,
        retryCount: 0,
        createdAt: '2026-07-25T10:01:00.000Z',
        updatedAt: '2026-07-25T10:04:00.000Z',
      },
      {
        id: 'downloading',
        sourceId: null,
        songId: 1,
        songName: 'Downloading',
        artist: 'Artist',
        album: 'Album',
        status: 'downloading',
        progress: 35,
        retryCount: 0,
        createdAt: '2026-07-25T10:00:00.000Z',
        updatedAt: '2026-07-25T10:00:00.000Z',
      },
    ])

    expect(tasks.map(task => task.id)).toEqual(['downloading', 'done', 'pending'])
  })
})
