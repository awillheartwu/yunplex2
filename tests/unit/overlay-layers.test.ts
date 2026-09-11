import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OVERLAY_LAYERS } from '../../lib/overlay-layers'

const tokens = readFileSync(resolve(__dirname, '../../assets/css/tokens.css'), 'utf8')
function layer(reference: string) {
  const token = reference.match(/var\((--[\w-]+)\)/)?.[1]
  const value = token && tokens.match(new RegExp(`${token}:\\s*(\\d+)`))?.[1]
  expect(value, `Missing numeric layer for ${reference}`).toBeTruthy()
  return Number(value)
}

describe('overlay layers', () => {
  it('keeps nested pickers above dialogs and feedback above all overlays', () => {
    const layers = [
      'var(--z-dock)', 'var(--z-drawer)', OVERLAY_LAYERS.filterScrim,
      OVERLAY_LAYERS.filterPopover, OVERLAY_LAYERS.filterSheet, 'var(--z-modal)',
      OVERLAY_LAYERS.nestedBackdrop, OVERLAY_LAYERS.nestedPopover, OVERLAY_LAYERS.toast,
    ].map(layer)
    for (let index = 1; index < layers.length; index++) expect(layers[index]).toBeGreaterThan(layers[index - 1]!)
  })
})
