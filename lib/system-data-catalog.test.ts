import { describe, expect, it } from 'vitest'
import { buildSystemDataTableRows } from './system-data-catalog'

describe('system data catalog', () => {
  it('includes durable identity and review tables with meaningful categories', () => {
    const rows = buildSystemDataTableRows({
      song_identity_bindings: 147,
      song_identity_events: 151,
      song_match_reviews: 10,
      song_match_review_occurrences: 41,
      playlist_source_track_occurrences: 210,
    })

    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'song_identity_events',
        count: 151,
        desc: '不可变身份决策历史',
        href: '/match-reviews?tab=history',
      }),
      expect.objectContaining({
        name: 'playlist_source_track_occurrences',
        count: 210,
        desc: '歌单目标成员与对齐状态',
        href: '/match-reviews?tab=overview',
      }),
      expect.objectContaining({
        name: 'song_identity_bindings',
        count: 147,
        desc: '全局歌曲身份绑定',
        group: 'matching',
      }),
      expect.objectContaining({
        name: 'song_match_reviews',
        count: 10,
        desc: '匹配审核与决策',
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
      song_match_reviews: 3,
      playlist_sources: 4,
    })

    expect(rows.map(row => row.name)).toEqual([
      'song_match_reviews',
      'playlist_sources',
      'failure_records',
      'config',
    ])
  })
})
