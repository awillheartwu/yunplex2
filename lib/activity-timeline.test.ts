import { describe, expect, it } from 'vitest'
import type { ActivityEvent } from '~~/server/lib/activity/types'
import type { DashboardActivityItem } from '~~/types/dashboard'
import { buildActivityTimelineItems, dashboardActivityItemToTimelineItem } from './activity-timeline'

function event(overrides: Partial<ActivityEvent> & Pick<ActivityEvent, 'id' | 'type'>): ActivityEvent {
  return {
    id: overrides.id,
    domain: overrides.domain ?? 'sync',
    type: overrides.type,
    severity: overrides.severity ?? 'info',
    occurredAt: overrides.occurredAt ?? '2026-06-25T08:00:00.000Z',
    actor: overrides.actor ?? 'system',
    title: overrides.title ?? overrides.type,
    summary: overrides.summary ?? '',
    context: overrides.context ?? {},
    link: overrides.link ?? '/task-center?tab=runs',
    groupKey: overrides.groupKey ?? null,
  }
}

describe('activity timeline presentation', () => {
  it('aggregates consecutive unchanged source skips into one expandable item', () => {
    const items = buildActivityTimelineItems([
      event({ id: 'skip-1', type: 'source_sync_skipped_unchanged', title: '跳过 Manta', context: { sourceName: 'Manta' } }),
      event({ id: 'skip-2', type: 'source_sync_skipped_unchanged', title: '跳过 repeat', context: { sourceName: 'repeat' } }),
      event({ id: 'skip-3', type: 'source_sync_skipped_unchanged', title: '跳过 Loica', context: { sourceName: 'Loica' } }),
    ], { highlightedId: 'skip-2' })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      title: '跳过 3 个同步源',
      tone: 'existing',
      icon: 'existing',
      statusLabel: '3 项',
      highlighted: true,
    })
    expect(items[0]?.details.map(detail => detail.subjectLabel)).toEqual(['Manta', 'repeat', 'Loica'])
  })

  it('keeps primary activity actions ahead of weak status metadata', () => {
    const items = buildActivityTimelineItems([
      event({ id: 'run', type: 'sync_run_completed', severity: 'success', title: '同步完成', occurredAt: '2026-06-25T08:00:00', link: '/task-center/runs/1' }),
    ])

    expect(items[0]?.timeLabel).toBe('2026-06-25 08:00:00')
    expect(items[0]?.action).toMatchObject({
      label: '查看运行',
      icon: 'activity',
      to: '/task-center/runs/1',
    })
    expect(items[0]?.statusLabel).toBe('完成')
  })

  it('maps dashboard previews to compact activity timeline items', () => {
    const item: DashboardActivityItem = {
      id: 'dashboard-event',
      type: 'download_completed',
      domain: 'download',
      severity: 'success',
      title: '下载完成',
      subtitle: '歌曲已加入 Plex',
      timestamp: '2026-06-25T08:00:00.000Z',
      icon: 'download',
      tone: 'accent',
      link: '/manual-download?view=history',
      groupKey: null,
      statusLabel: '完成',
    }

    expect(dashboardActivityItemToTimelineItem(item)).toMatchObject({
      id: 'dashboard-event',
      title: '下载完成',
      icon: 'download',
      action: {
        label: '查看',
        to: '/activity?event=dashboard-event',
      },
    })
  })
})
