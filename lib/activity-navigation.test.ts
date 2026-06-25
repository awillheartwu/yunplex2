import { describe, expect, it } from 'vitest'
import { ACTIVITY_LOGS_ROUTE, resolveLegacyActivityRedirect } from './activity-navigation'

describe('legacy activity redirects', () => {
  it('redirects old log routes to the activity logs tab', () => {
    expect(resolveLegacyActivityRedirect('/logs')).toBe(ACTIVITY_LOGS_ROUTE)
    expect(resolveLegacyActivityRedirect('/system', { tab: 'logs' })).toBe(ACTIVITY_LOGS_ROUTE)
  })

  it('leaves non-log system routes untouched', () => {
    expect(resolveLegacyActivityRedirect('/system')).toBeNull()
    expect(resolveLegacyActivityRedirect('/system', { tab: 'maintenance' })).toBeNull()
  })
})
