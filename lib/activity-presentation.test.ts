import { describe, expect, it } from 'vitest'
import { DASHBOARD_ACTIVITY_PREVIEW_ROUTE, dashboardActivityPreviewLink } from './activity-presentation'

describe('dashboard activity preview links', () => {
  it('routes dashboard activity previews to the dedicated activity page', () => {
    expect(DASHBOARD_ACTIVITY_PREVIEW_ROUTE).toBe('/activity')
    expect(dashboardActivityPreviewLink('event:1')).toBe('/activity?event=event%3A1')
  })
})
