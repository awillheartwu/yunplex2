import { describe, expect, it } from 'vitest'
import { OVERLAY_LAYERS } from '../../lib/overlay-layers'

describe('overlay layers', () => {
  it('keeps nested controls above their owning filter panel and below feedback', () => {
    expect(OVERLAY_LAYERS.filterScrim).toBeLessThan(OVERLAY_LAYERS.filterPopover)
    expect(OVERLAY_LAYERS.filterPopover).toBeLessThan(OVERLAY_LAYERS.nestedBackdrop)
    expect(OVERLAY_LAYERS.nestedBackdrop).toBeLessThan(OVERLAY_LAYERS.nestedPopover)
    expect(OVERLAY_LAYERS.nestedPopover).toBeLessThan(OVERLAY_LAYERS.toast)
  })
})
