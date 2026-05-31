import type { Ref } from 'vue'

export interface StageItem {
  key: string
  label: string
}

const STAGE_ORDER = [
  'idle',
  'fetching_playlist',
  'comparing',
  'downloading',
  'processing_tags',
  'refreshing_plex',
  'updating_plex_playlist',
] as const

export const ACTIVE_STAGES: StageItem[] = [
  { key: 'fetching_playlist', label: '获取歌单' },
  { key: 'comparing', label: '对比 Plex' },
  { key: 'downloading', label: '下载' },
  { key: 'processing_tags', label: '写入标签' },
  { key: 'refreshing_plex', label: '刷新 Plex' },
  { key: 'updating_plex_playlist', label: '更新歌单' },
]

const STAGE_LABELS: Record<string, string> = {
  idle: '空闲',
  fetching_playlist: '获取源曲目',
  comparing: '对比歌曲',
  downloading: '下载歌曲',
  processing_tags: '写入元数据',
  refreshing_plex: '刷新 Plex 库',
  updating_plex_playlist: '更新 Plex 歌单',
  reorder: '重排歌单',
  cancelled: '已取消',
  error: '同步错误',
  repair: '补全辅助数据',
}

export function useSyncStages(currentStageRef: Ref<string | null | undefined>) {
  function stageLabel(key: string): string {
    return STAGE_LABELS[key] || key
  }

  function stageIndexOf(key: string): number {
    return STAGE_ORDER.indexOf(key as (typeof STAGE_ORDER)[number])
  }

  function stageDotClass(key: string): string {
    const current = currentStageRef.value
    if (!current || current === 'idle') return 'bg-[var(--border-secondary)]'
    if (current === 'error') {
      const ki = stageIndexOf(key)
      const doneIdx = stageIndexOf('updating_plex_playlist')
      if (ki <= doneIdx) return ki < doneIdx ? 'bg-success' : 'bg-danger'
    }
    const ci = stageIndexOf(current)
    const ki = stageIndexOf(key)
    if (ki < ci) return 'bg-success'
    if (ki === ci) return 'bg-accent animate-pulse'
    return 'bg-[var(--border-secondary)]'
  }

  function stageColor(key: string): string {
    const current = currentStageRef.value
    if (!current || current === 'idle') return 'var(--text-tertiary)'
    if (current === 'error') {
      const ki = stageIndexOf(key)
      return ki < stageIndexOf('updating_plex_playlist')
        ? 'var(--text-secondary)'
        : 'var(--text-primary)'
    }
    const ci = stageIndexOf(current)
    const ki = stageIndexOf(key)
    if (ki < ci) return 'var(--text-secondary)'
    if (ki === ci) return 'var(--accent)'
    return 'var(--text-tertiary)'
  }

  function isStageDone(key: string): boolean {
    const current = currentStageRef.value
    if (!current || current === 'idle') return false
    return stageIndexOf(key) < stageIndexOf(current)
  }

  return { stageLabel, stageDotClass, stageColor, isStageDone }
}
