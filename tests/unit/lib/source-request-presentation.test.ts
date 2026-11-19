import { expect, it } from 'vitest'
import { sourceRequestProgress, sourceRequestReceipt } from '~~/lib/source-request-presentation'

it('routes acceptance, manual review and busy rejection to different next actions', () => {
  expect(sourceRequestReceipt({ sourceId: 's', status: 'accepted', kind: 'convergence', requestId: 'q', message: '' }).href).toBe('/sync-sources/s?request=q')
  expect(sourceRequestReceipt({ sourceId: 's', status: 'accepted', kind: 'analysis', requestId: 'q', message: '' }).href).toBe('/sync-sources/s?tab=initialization&request=q')
  expect(sourceRequestReceipt({ sourceId: 's', status: 'awaiting_review', message: '' }).href).toBe('/sync-sources/s?tab=initialization')
  expect(sourceRequestReceipt({ sourceId: 's', status: 'busy', message: '' }).href).toBe('/task-center')
})

it('does not equate a completed request with successful Plex convergence', () => {
  const snapshot = { id: 'q', sourceId: 's', status: 'completed' as const, kind: 'convergence' as const, runId: 'r', error: null }
  expect(sourceRequestProgress(snapshot).detail).toContain('确认歌曲结果与 Plex')
  expect(sourceRequestProgress({ ...snapshot, kind: 'analysis' }).detail).toContain('确认后再开始同步')
  expect(sourceRequestProgress({ ...snapshot, status: 'failed', error: '具体原因' }).detail).toBe('具体原因')
})
