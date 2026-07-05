import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '../..')

describe('auth settings integration', () => {
  it('exposes password change and reinitialize actions from settings', () => {
    const source = readFileSync(resolve(root, 'pages/config.vue'), 'utf-8')

    expect(source).toContain('title="安全"')
    expect(source).toContain('handleChangePassword')
    expect(source).toContain('handleReinitialize')
    expect(source).toContain('触发重新初始化')
  })

  it('keeps download output options in the download tab and reinitialization at the end of other strategies', () => {
    const source = readFileSync(resolve(root, 'pages/config.vue'), 'utf-8')

    const downloadTab = source.indexOf("activeTab === 'download'")
    const syncTab = source.indexOf("activeTab === 'sync'")
    const preferencesTab = source.indexOf("activeTab === 'preferences'")
    const advancedTab = source.indexOf("activeTab === 'advanced'")
    const pathFormat = source.indexOf('存储路径格式')
    const translatedLyric = source.indexOf('下载翻译歌词')
    const otherStrategies = source.indexOf('title="其他策略"')
    const artistAliases = source.indexOf('艺人名替换映射')
    const reinitialize = source.indexOf('触发重新初始化')

    expect(downloadTab).toBeGreaterThan(-1)
    expect(preferencesTab).toBeGreaterThan(-1)
    expect(pathFormat).toBeGreaterThan(downloadTab)
    expect(pathFormat).toBeLessThan(syncTab)
    expect(translatedLyric).toBeGreaterThan(downloadTab)
    expect(translatedLyric).toBeLessThan(syncTab)
    expect(otherStrategies).toBeGreaterThan(preferencesTab)
    expect(otherStrategies).toBeLessThan(advancedTab)
    expect(reinitialize).toBeGreaterThan(artistAliases)
    expect(reinitialize).toBeLessThan(advancedTab)
  })

  it('keeps frontend auth helpers for password change and setup reinitialization', () => {
    const source = readFileSync(resolve(root, 'composables/useAuth.ts'), 'utf-8')

    expect(source).toContain("'/auth/password'")
    expect(source).toContain("'/setup/reinitialize'")
    expect(source).toContain('changePassword')
    expect(source).toContain('reinitializeSetup')
  })

  it('keeps protected backend endpoints for password change and reinitialization', () => {
    const passwordEndpoint = readFileSync(resolve(root, 'server/api/auth/password.post.ts'), 'utf-8')
    const reinitializeEndpoint = readFileSync(resolve(root, 'server/api/setup/reinitialize.post.ts'), 'utf-8')

    expect(passwordEndpoint).toContain('verifyAdminPassword')
    expect(passwordEndpoint).toContain('revokeAllSessions')
    expect(reinitializeEndpoint).toContain('markSetupRequired')
  })
})
