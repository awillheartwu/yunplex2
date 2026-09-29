import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_INITIALIZATION_MATCHING } from '../../shared/initialization-matching'

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
    expect(banner).toContain('不改变已有配置')
    expect(banner).toContain('experimental-matching-notice')
    // The preview failure alert must stay the only alert region on the page.
    expect(component).not.toContain('role="alert"')
  })

  it('keeps the feature disabled by default so standard takeover still runs', () => {
    const engine = read('server/lib/source-initialization/candidate-engine.ts')

    expect(DEFAULT_INITIALIZATION_MATCHING.enabled).toBe(false)
    expect(engine).toContain('if (!input.matching?.enabled) return plans')
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
})
