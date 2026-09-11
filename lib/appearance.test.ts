import { afterEach, expect, it, vi } from 'vitest'
import { applyAppearance, initializeAppearance } from './appearance'

afterEach(() => vi.unstubAllGlobals())

it('falls back safely when storage is unavailable or values are invalid', () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked') } })
  expect(initializeAppearance()).toEqual({ theme: 'dark', scale: 1 })
  vi.stubGlobal('localStorage', { getItem: () => 'Infinity' })
  expect(initializeAppearance()).toEqual({ theme: 'dark', scale: 1 })
  vi.stubGlobal('localStorage', { getItem: (key: string) => key.endsWith('theme') ? 'light' : '1.5' })
  expect(initializeAppearance()).toEqual({ theme: 'light', scale: 1.5 })
})

it('applies accessible defaults even if persistence fails', () => {
  const toggle = vi.fn(), setProperty = vi.fn()
  vi.stubGlobal('document', { documentElement: { classList: { toggle }, style: { setProperty } } })
  vi.stubGlobal('localStorage', { setItem: () => { throw new Error('blocked') } })
  expect(applyAppearance({ theme: 'light', scale: NaN })).toEqual({ theme: 'light', scale: 1 })
  expect(toggle).toHaveBeenCalledWith('dark', false)
  expect(setProperty).toHaveBeenCalledWith('--font-scale', '1')
})
