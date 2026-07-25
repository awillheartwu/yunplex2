import { describe, expect, it } from 'vitest'
import type { TaskRun } from '~~/server/lib/job/types'
import { buildRunTimeline } from './run-timeline'

function makeRun(overrides: Partial<TaskRun> = {}): TaskRun {
  return {
    id: 'run-1',
    type: 'sync',
    trigger: 'user',
    startedAt: '2026-06-23T08:35:01.000Z',
    finishedAt: '2026-06-23T08:35:22.000Z',
    status: 'success',
    durationMs: 21_000,
    summary: '10 个源，成功 1 首，1 首已忽略',
    source: '网易云音乐',
    sourceIds: ['source-1', 'source-2'],
    target: 'Plex',
    totalSongs: 4,
    successSongs: 1,
    failedSongs: 0,
    skippedSongs: 1,
    removedSongs: 1,
    warnings: 1,
    dryRun: false,
    steps: [
      {
        id: 'fetch-1',
        type: 'playlist_fetch',
        title: '获取歌单: 来源 A',
        status: 'success',
        startedAt: '2026-06-23T08:35:03.000Z',
        finishedAt: '2026-06-23T08:35:04.000Z',
        durationMs: 1_000,
        message: '歌单获取完成，共 10 首',
        children: [],
      },
      {
        id: 'fetch-2',
        type: 'playlist_fetch',
        title: '获取歌单: 来源 B',
        status: 'success',
        startedAt: '2026-06-23T08:35:04.000Z',
        finishedAt: '2026-06-23T08:35:05.000Z',
        durationMs: 1_000,
        message: '歌单获取完成，共 12 首',
        children: [],
      },
      {
        id: 'compare',
        type: 'plex_compare',
        title: '对比 Plex 歌单',
        status: 'success',
        startedAt: '2026-06-23T08:35:06.000Z',
        finishedAt: '2026-06-23T08:35:08.000Z',
        durationMs: 2_000,
        message: '待下载 1 首，已存在 1 首，1 首待清理',
        children: [],
      },
    ],
    songs: [
      { id: 'song-success', sourceId: 'source-1', songName: '成功歌曲', artist: '艺人 A', album: '专辑 A', status: 'success', phase: 'done' },
      { id: 'song-existing', sourceId: 'source-1', songName: '已有歌曲', artist: '艺人 B', album: '专辑 B', status: 'skipped_existing', phase: 'done' },
      { id: 'song-ignored', sourceId: 'source-2', songName: '受限歌曲', artist: '艺人 C', album: '专辑 C', status: 'copyright_restricted', phase: 'download' },
      { id: 'song-removed', sourceId: 'source-2', songName: '移除歌曲', artist: '艺人 D', album: '专辑 D', status: 'removed', phase: 'done' },
    ],
    config: {},
    ...overrides,
  }
}

describe('run timeline', () => {
  it('turns repetitive source logs into one expandable process summary', () => {
    const timeline = buildRunTimeline(makeRun())
    const sourceSummary = timeline.find(item => item.id === 'run-1:sources')

    expect(sourceSummary).toMatchObject({
      title: '解析 2 个同步源',
      tone: 'success',
      statusLabel: '完成',
    })
    expect(sourceSummary?.details).toHaveLength(2)
    expect(timeline.some(item => item.id === 'fetch-1')).toBe(false)
    expect(timeline.some(item => item.id === 'compare')).toBe(true)
  })

  it('adds grouped outcome events with expandable song details', () => {
    const timeline = buildRunTimeline(makeRun())

    expect(timeline.find(item => item.id === 'run-1:existing')).toMatchObject({
      title: '发现 1 首歌曲已存在',
      tone: 'existing',
    })
    expect(timeline.find(item => item.id === 'run-1:ignored')).toMatchObject({
      title: '跳过 1 首需要关注的歌曲',
      description: '包含版权受限，或达到连续失败阈值后已暂停自动重试的歌曲',
      tone: 'ignored',
    })
    expect(timeline.find(item => item.id === 'run-1:success')?.details[0]?.title).toBe('成功歌曲')
    expect(timeline.find(item => item.id === 'run-1:removed')?.tone).toBe('warning')
  })

  it('shows the playlist name on Plex operation steps when step context is available', () => {
    const timeline = buildRunTimeline(makeRun({
      steps: [
        {
          id: 'compare',
          type: 'compare',
          title: '对比 Plex 歌单',
          status: 'success',
          startedAt: '2026-06-23T08:35:06.000Z',
          finishedAt: '2026-06-23T08:35:08.000Z',
          durationMs: 2_000,
          message: '待下载 1 首，已存在 1 首',
          context: {
            sourceId: 'source-1',
            sourceName: '华语摇滚精选',
            playlistName: '华语摇滚精选',
            plexPlaylistName: 'Plex 华语摇滚精选',
          },
          children: [],
        },
      ],
    }))

    expect(timeline.find(item => item.id === 'compare')).toMatchObject({
      title: '对比 Plex 歌单',
      subjectLabel: 'Plex 华语摇滚精选',
    })
  })

  it('infers playlist names for legacy Plex steps from the preceding source step', () => {
    const timeline = buildRunTimeline(makeRun({
      steps: [
        {
          id: 'fetch-1',
          type: 'playlist_fetch',
          title: '获取歌单: 来源 A',
          status: 'success',
          startedAt: '2026-06-23T08:35:03.000Z',
          finishedAt: '2026-06-23T08:35:04.000Z',
          durationMs: 1_000,
          message: '歌单获取完成，共 10 首',
          children: [],
        },
        {
          id: 'compare-1',
          type: 'compare',
          title: '对比 Plex 歌单',
          status: 'success',
          startedAt: '2026-06-23T08:35:06.000Z',
          finishedAt: '2026-06-23T08:35:08.000Z',
          durationMs: 2_000,
          message: '待下载 1 首，已存在 1 首',
          children: [],
        },
        {
          id: 'fetch-2',
          type: 'playlist_fetch',
          title: '获取歌单: 来源 B',
          status: 'success',
          startedAt: '2026-06-23T08:35:09.000Z',
          finishedAt: '2026-06-23T08:35:10.000Z',
          durationMs: 1_000,
          message: '歌单获取完成，共 12 首',
          children: [],
        },
        {
          id: 'reorder-2',
          type: 'reorder',
          title: '重排 Plex 歌单',
          status: 'success',
          startedAt: '2026-06-23T08:35:12.000Z',
          finishedAt: '2026-06-23T08:35:13.000Z',
          durationMs: 1_000,
          message: 'Plex 歌单重排完成',
          children: [],
        },
      ],
    }))

    expect(timeline.find(item => item.id === 'compare-1')?.subjectLabel).toBe('来源 A')
    expect(timeline.find(item => item.id === 'reorder-2')?.subjectLabel).toBe('来源 B')
  })

  it('includes source names in grouped song details when a run spans multiple sources', () => {
    const timeline = buildRunTimeline(makeRun({
      steps: [
        {
          id: 'fetch-1',
          type: 'playlist_fetch',
          title: '获取歌单: 来源 A',
          status: 'success',
          startedAt: '2026-06-23T08:35:03.000Z',
          finishedAt: '2026-06-23T08:35:04.000Z',
          durationMs: 1_000,
          message: '歌单获取完成，共 10 首',
          context: { sourceId: 'source-1', sourceName: '来源 A' },
          children: [],
        },
        {
          id: 'fetch-2',
          type: 'playlist_fetch',
          title: '获取歌单: 来源 B',
          status: 'success',
          startedAt: '2026-06-23T08:35:04.000Z',
          finishedAt: '2026-06-23T08:35:05.000Z',
          durationMs: 1_000,
          message: '歌单获取完成，共 12 首',
          context: { sourceId: 'source-2', sourceName: '来源 B' },
          children: [],
        },
      ],
    }))

    expect(timeline.find(item => item.id === 'run-1:ignored')?.details[0]).toMatchObject({
      subjectLabel: '来源 B',
      description: '来源：来源 B · 艺人 C · 专辑 C',
    })
  })

  it('represents an active run without claiming that it finished', () => {
    const timeline = buildRunTimeline(makeRun({
      status: 'running',
      finishedAt: null,
      summary: '正在同步',
    }))
    expect(timeline.at(-1)).toMatchObject({
      title: '同步任务仍在运行',
      tone: 'running',
      statusLabel: '运行中',
    })
  })
})
