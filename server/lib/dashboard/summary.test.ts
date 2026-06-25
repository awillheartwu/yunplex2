import { describe, expect, it } from 'vitest'
import type { ActivityEvent } from '../activity/types'
import { buildDashboardActivitiesFromEvents } from './summary'

function makeEvent(overrides: Partial<ActivityEvent> & Pick<ActivityEvent, 'id' | 'type' | 'occurredAt'>): ActivityEvent {
  return {
    id: overrides.id,
    domain: overrides.domain ?? 'sync',
    type: overrides.type,
    severity: overrides.severity ?? 'info',
    occurredAt: overrides.occurredAt,
    actor: overrides.actor ?? 'system',
    title: overrides.title ?? overrides.type,
    summary: overrides.summary ?? `${overrides.type} summary`,
    context: overrides.context ?? {},
    link: overrides.link ?? '/task-center',
    groupKey: overrides.groupKey ?? null,
  }
}

describe('buildDashboardActivitiesFromEvents', () => {
  it('prefers source or run summary events over low-level plex steps in the same group', () => {
    const items = buildDashboardActivitiesFromEvents([
      makeEvent({
        id: 'plex-reorder',
        type: 'plex_playlist_reordered',
        domain: 'plex',
        severity: 'success',
        occurredAt: '2026-06-12T08:31:10.000Z',
        title: 'Plex 歌单已重排',
        groupKey: 'job:1:source:a',
      }),
      makeEvent({
        id: 'source-complete',
        type: 'source_sync_completed',
        domain: 'sync',
        severity: 'success',
        occurredAt: '2026-06-12T08:31:12.000Z',
        title: '同步源“repeat”完成',
        groupKey: 'job:1:source:a',
      }),
    ])

    expect(items).toHaveLength(1)
    expect(items[0]?.id).toBe('source-complete')
    expect(items[0]?.title).toBe('同步源“repeat”完成')
  })

  it('keeps dashboard activity ordering truly recent after representative selection', () => {
    const items = buildDashboardActivitiesFromEvents([
      makeEvent({
        id: 'older-warning',
        type: 'source_deleted',
        domain: 'user',
        severity: 'warning',
        occurredAt: '2026-06-12T08:00:00.000Z',
        title: '删除同步源',
      }),
      makeEvent({
        id: 'newer-success',
        type: 'sync_run_completed',
        domain: 'sync',
        severity: 'success',
        occurredAt: '2026-06-12T08:10:00.000Z',
        title: '本轮同步完成',
      }),
    ])

    expect(items.map(item => item.id)).toEqual(['newer-success', 'older-warning'])
  })
})
