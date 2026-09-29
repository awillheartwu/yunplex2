import { expect, it, vi } from 'vitest'
import { closeEventClients, getEventClientCount, subscribe } from '../../server/lib/sync/events'
it('releases normal subscriptions and closes live clients during shutdown', () => {
  const close = vi.fn(), cancel = subscribe(() => {}, close)
  expect(getEventClientCount()).toBe(1)
  cancel(); expect(getEventClientCount()).toBe(0)
  subscribe(() => {}, close); closeEventClients()
  expect(close).toHaveBeenCalledOnce()
  expect(getEventClientCount()).toBe(0)
})
