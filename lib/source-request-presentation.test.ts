import { expect, it } from 'vitest'
import { sourceRequestProgress, sourceRequestReceipt } from './source-request-presentation'

it('routes acceptance, manual review and busy rejection to different next actions', () => {
  expect(sourceRequestReceipt({ sourceId: 's', status: 'accepted', kind: 'convergence', requestId: 'q', message: '' })).toMatchObject({ label: '已受理', action: '查看同步进度', href: '/sync-sources/s?request=q' })
  expect(sourceRequestReceipt({ sourceId: 's', status: 'accepted', kind: 'analysis', requestId: 'q', message: '' }).href).toBe('/sync-sources/s?tab=initialization&request=q')
  expect(sourceRequestReceipt({ sourceId: 's', status: 'awaiting_review', message: '' })).toMatchObject({ label: '等待确认', action: '确认媒体接管' })
  expect(sourceRequestReceipt({ sourceId: 's', status: 'busy', message: '' })).toMatchObject({ label: '未受理', href: '/task-center' })
})

it('does not equate a completed request with successful Plex convergence', () => {
  const snapshot = { id: 'q', sourceId: 's', status: 'completed' as const, kind: 'convergence' as const, runId: 'r', error: null }
  expect(sourceRequestProgress(snapshot)).toMatchObject({ label: '请求已结束', detail: expect.stringContaining('确认歌曲结果与 Plex') })
  expect(sourceRequestProgress({ ...snapshot, kind: 'analysis' }).detail).toContain('仍需要你的决定')
  expect(sourceRequestProgress({ ...snapshot, status: 'failed', error: '具体原因' })).toMatchObject({ label: '执行失败', detail: '具体原因' })
})
