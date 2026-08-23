import { describe, expect, it } from 'vitest'
import { buildSystemDataTableRows } from './system-data-catalog'

describe('system data catalog', () => {
  it('describes the simplified media links and target occurrences', () => {
    const rows = buildSystemDataTableRows({
      song_identity_bindings: 147,
      local_media_assets: 151,
      playlist_source_track_occurrences: 210,
    })

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'playlist_source_track_occurrences',
        count: 210,
        desc: '歌单目标成员与对齐状态',
        href: '/sync-sources',
      }),
      expect.objectContaining({
        name: 'song_identity_bindings',
        count: 147,
        desc: '媒体关联',
        group: 'matching',
        href: '/match-reviews',
      }),
    ]))
  })

  it('does not silently hide a future database table', () => {
    const rows = buildSystemDataTableRows({ future_identity_evidence: 3 })

    expect(rows).toEqual([{
      name: 'future_identity_evidence',
      count: 3,
      desc: '未分类数据表',
      group: 'other',
      groupLabel: '其他数据',
    }])
  })

  it('uses a stable domain-oriented order instead of SQLite discovery order', () => {
    const rows = buildSystemDataTableRows({
      config: 1,
      failure_records: 2,
      song_identity_bindings: 3,
      playlist_sources: 4,
    })

    expect(rows.map(row => row.name)).toEqual([
      'song_identity_bindings',
      'playlist_sources',
      'failure_records',
      'config',
    ])
  })

  it('routes operational download data to the task center', () => {
    const rows = buildSystemDataTableRows({ download_tasks: 4, downloads: 2 })

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'download_tasks', href: '/task-center' }),
      expect.objectContaining({ name: 'downloads', href: '/task-center' }),
    ]))
  })
})
