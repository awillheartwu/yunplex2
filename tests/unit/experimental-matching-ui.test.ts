import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_INITIALIZATION_MATCHING, MATCHING_PRESET_EXCLUDED_FIELDS, MATCHING_PRESET_FIELDS, matchingPreset, matchingPresetSelection } from '../../shared/initialization-matching'

const root = resolve(__dirname, '../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('experimental initialization matching UI', () => {
  const component = read('components/config/InitializationMatchingSettings.vue')

  it('marks the enhancement as experimental at the top of the settings', () => {
    const bannerIndex = component.indexOf('data-testid="experimental-matching-notice"')
    expect(bannerIndex).toBeGreaterThan(-1)
    expect(bannerIndex).toBeLessThan(component.indexOf('<ConfigSection'))
    expect(bannerIndex).toBeLessThan(component.indexOf('启用增强初始化匹配'))

    const banner = component.slice(bannerIndex, bannerIndex + 500)
    expect(banner).toContain('实验功能：增强初始化匹配')
    expect(banner).toContain('默认关闭')
    expect(banner).toContain('标准首次接管流程仍然可用')
    expect(banner).toContain('保存后仅对新发起的接管分析生效')
    expect(banner).toContain('experimental-matching-notice')
    // The preview failure alert must stay the only alert region on the page.
    expect(component).not.toContain('role="alert"')
  })

  it('keeps the feature disabled by default so standard takeover still runs', () => {
    const engine = read('server/lib/source-initialization/candidate-engine.ts')

    expect(DEFAULT_INITIALIZATION_MATCHING.enabled).toBe(false)
    expect(engine).toContain('if (!input.matching?.enabled) {')
    expect(engine).toContain('plans.map((plan,index)=>({...plan,evidence:')
    expect(component).toContain('hint="默认关闭；启用后首次接管会使用这里的候选规则"')
    // Opening the settings page must not flip or persist the flag on its own.
    expect(component).not.toContain('onMounted')
  })

  it('renders the panel regardless of the flag and keeps the existing config wiring', () => {
    const page = read('pages/config.vue')

    expect(component).not.toMatch(/v-if="[^"]*\.enabled/)
    expect(page).toContain('v-model="matchingConfig"')
    expect(page).toContain(':saved-config="savedMatchingConfig"')
  })

  it('derives the preset identity fields from the defaults instead of listing them in the component', () => {
    expect(MATCHING_PRESET_FIELDS).toContain('enabled')
    expect(MATCHING_PRESET_FIELDS).toContain('artistPolicy')
    for (const field of MATCHING_PRESET_EXCLUDED_FIELDS) expect(MATCHING_PRESET_FIELDS).not.toContain(field)
    expect(MATCHING_PRESET_FIELDS).toHaveLength(Object.keys(DEFAULT_INITIALIZATION_MATCHING).length - MATCHING_PRESET_EXCLUDED_FIELDS.length)
    expect(component).toContain('matchingPresetSelection')
    expect(component).not.toContain("'recommendDurationMs', 'reviewDurationMs'")
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
    // Selecting the custom card never applies or resets values.
    expect(component).toContain("value: 'custom'")
    expect(component).toContain("if (preset === 'custom') return")
  })
})
