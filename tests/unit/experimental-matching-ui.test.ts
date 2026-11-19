import { describe, expect, it } from 'vitest'
import { DEFAULT_INITIALIZATION_MATCHING, MATCHING_PRESET_EXCLUDED_FIELDS, MATCHING_PRESET_FIELDS, matchingPreset, matchingPresetSelection } from '../../shared/initialization-matching'

describe('initialization matching presets', () => {
  it('derives the preset identity fields from the defaults instead of listing them in the component', () => {
    expect(MATCHING_PRESET_FIELDS).toContain('enabled')
    expect(MATCHING_PRESET_FIELDS).toContain('artistPolicy')
    for (const field of MATCHING_PRESET_EXCLUDED_FIELDS) expect(MATCHING_PRESET_FIELDS).not.toContain(field)
    expect(MATCHING_PRESET_FIELDS).toHaveLength(Object.keys(DEFAULT_INITIALIZATION_MATCHING).length - MATCHING_PRESET_EXCLUDED_FIELDS.length)
  })

  it('shows a custom preset selection without resetting preserved fields', () => {
    expect(matchingPresetSelection(matchingPreset('conservative'))).toBe('conservative')
    expect(matchingPresetSelection(matchingPreset('balanced'))).toBe('balanced')
    expect(matchingPresetSelection(matchingPreset('discovery'))).toBe('discovery')
    expect(matchingPresetSelection({ ...DEFAULT_INITIALIZATION_MATCHING })).toBe('custom')
    expect(matchingPresetSelection({ ...matchingPreset('balanced'), fuzzyTitles: true })).toBe('custom')
    expect(matchingPresetSelection({
      ...matchingPreset('balanced'),
      artistAliases: [{ name: '陈粒', aliases: ['Chen Li'], enabled: true }],
      titleAliases: [{ name: '小半', aliases: ['A Little Half'], enabled: true }],
      preferredDirectory: '/music',
      quickMatchThreshold: 60,
    })).toBe('balanced')
  })
})
