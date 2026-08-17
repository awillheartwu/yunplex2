export type SystemDataGroup = 'matching' | 'sync' | 'operations' | 'system' | 'other'

export interface SystemDataTableRow {
  name: string
  count: number
  desc: string
  group: SystemDataGroup
  groupLabel: string
  href?: string
}

interface CatalogEntry {
  desc: string
  group: Exclude<SystemDataGroup, 'other'>
  href?: string
}

const GROUP_LABELS: Record<SystemDataGroup, string> = {
  matching: '匹配与身份',
  sync: '同步与歌单',
  operations: '下载与异常',
  system: '系统与权限',
  other: '其他数据',
}

/**
 * Ordered by product domain rather than migration/discovery order. This list
 * supplies human descriptions; unknown future tables are still shown.
 */
const TABLE_CATALOG: Record<string, CatalogEntry> = {
  song_identity_bindings: { desc: '全局歌曲身份绑定', group: 'matching' },
  song_identity_events: { desc: '不可变身份决策历史', group: 'matching', href: '/match-reviews?tab=history' },
  song_match_reviews: { desc: '匹配审核与决策', group: 'matching', href: '/match-reviews' },
  song_match_review_occurrences: { desc: '审核候选出现记录', group: 'matching', href: '/match-reviews' },
  local_media_assets: { desc: '本地媒体身份资产', group: 'matching' },
  playlist_extra_observations: { desc: 'Plex 多余曲目观察', group: 'matching' },
  artist_resolution_cache: { desc: '艺人别名解析缓存', group: 'matching' },
  musicbrainz_recording_cache: { desc: 'MusicBrainz 录音解析缓存', group: 'matching' },
  musicbrainz_id_mapping_cache: { desc: 'MusicBrainz ID 映射缓存', group: 'matching' },

  playlist_sources: { desc: '歌单同步源', group: 'sync', href: '/sync-sources' },
  playlist_source_track_occurrences: { desc: '歌单目标成员与对齐状态', group: 'sync', href: '/match-reviews?tab=overview' },
  task_runs: { desc: '统一运行记录', group: 'sync', href: '/system?tab=runs' },
  task_run_sources: { desc: '运行与歌单源关联', group: 'sync', href: '/system?tab=runs' },
  sync_state: { desc: '同步运行时状态', group: 'sync' },
  logs: { desc: '同步日志', group: 'sync', href: '/system?tab=logs' },

  download_tasks: { desc: '下载任务队列', group: 'operations', href: '/manual-download?view=queue' },
  downloads: { desc: '历史下载记录', group: 'operations', href: '/manual-download' },
  failure_records: { desc: '异常生命周期', group: 'operations', href: '/task-center?tab=failures' },
  failure_occurrences: { desc: '异常出现记录', group: 'operations', href: '/task-center?tab=failures' },

  config: { desc: '系统配置', group: 'system' },
  app_state: { desc: '应用持久状态', group: 'system' },
  auth_admin: { desc: '管理员账户', group: 'system' },
  auth_sessions: { desc: '登录会话', group: 'system' },
}

const GROUP_ORDER: Record<SystemDataGroup, number> = {
  matching: 0,
  sync: 1,
  operations: 2,
  system: 3,
  other: 4,
}

const TABLE_ORDER = new Map(Object.keys(TABLE_CATALOG).map((name, index) => [name, index]))

export function buildSystemDataTableRows(dbStats: Record<string, number>): SystemDataTableRow[] {
  return Object.entries(dbStats)
    .map(([name, count]): SystemDataTableRow => {
      const entry = TABLE_CATALOG[name]
      const group: SystemDataGroup = entry?.group ?? 'other'
      return {
        name,
        count,
        desc: entry?.desc ?? '未分类数据表',
        group,
        groupLabel: GROUP_LABELS[group],
        ...(entry?.href ? { href: entry.href } : {}),
      }
    })
    .sort((left, right) => {
      const groupDifference = GROUP_ORDER[left.group] - GROUP_ORDER[right.group]
      if (groupDifference !== 0) return groupDifference
      const leftOrder = TABLE_ORDER.get(left.name) ?? Number.MAX_SAFE_INTEGER
      const rightOrder = TABLE_ORDER.get(right.name) ?? Number.MAX_SAFE_INTEGER
      return leftOrder - rightOrder || left.name.localeCompare(right.name)
    })
}
