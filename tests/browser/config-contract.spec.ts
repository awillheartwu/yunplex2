import { expect, test } from './fixtures'
import { login, readConfig, updateConfig } from './helpers/config'

const enums: Record<string, string[]> = {
  'netease.quality': ['standard', 'higher', 'exhigh', 'lossless', 'hires', 'jyeffect', 'jymaster'],
  'other.multiArtistFormat': ['ampersand', 'and', 'comma', 'slash', 'plus', 'feat', 'ft', 'featuring', 'with'],
  'other.lyricOrder': ['original_first', 'translated_first', 'separate'],
  'sync.extraTrackRemovalPolicy': ['strict', 'balanced', 'exact'],
  'sync.unverifiedMediaPolicy': ['download_managed', 'wait_manual'],
  'initializationMatching.artistPolicy': ['complete', 'primary'],
  'initializationMatching.albumPolicy': ['require', 'prefer', 'ignore'],
  'initializationMatching.trackPolicy': ['require', 'prefer', 'ignore'],
  'initializationMatching.duplicatePolicy': ['review', 'highest_quality'],
  'initializationMatching.missingDuration': ['exclude', 'review'],
  'initializationMatching.remasterPolicy': ['strict', 'review', 'allow'],
  'initializationMatching.editionPolicy': ['strict', 'review'],
  'initializationMatching.explicitPolicy': ['strict', 'review'],
  'initializationMatching.unknownVersion': ['exclude', 'review'],
}

test('[CFG matrix] real API boolean and enum persistence, invalid values remain atomic', async ({ page }) => {
  await login(page)
  const original = await readConfig(page)
  expect(original.netease.cookie).toBe('')
  expect(original.plex.token).toBe('')
  expect(original.sync.enabled).toBe(false)
  const sources = await page.evaluate(async () => (await (await fetch('/api/playlist-sources')).json()).data)
  expect(sources).toEqual([])
  const cases: Array<{ section: string; key: string; values: unknown[]; invalid: unknown }> = []
  for (const [section, settings] of Object.entries(original)) {
    for (const [key, value] of Object.entries(settings)) {
      if (typeof value === 'boolean') cases.push({ section, key, values: [!value, value], invalid: 'not-a-boolean' })
    }
  }
  for (const [path, values] of Object.entries(enums)) {
    const [section, key] = path.split('.') as [string, string]
    cases.push({ section, key, values, invalid: '__invalid__' })
  }
  try {
    for (const item of cases) await test.step(`${item.section}.${item.key}`, async () => {
      for (const value of item.values) {
        const response = await updateConfig(page, { [item.section]: { [item.key]: value } })
        expect(response.body.code).toBe(0)
        const loaded = await readConfig(page) as unknown as Record<string, Record<string, unknown>>
        expect(loaded[item.section]?.[item.key]).toEqual(value)
      }
      const before = await readConfig(page)
      expect((await updateConfig(page, { [item.section]: { [item.key]: item.invalid } })).body.code).not.toBe(0)
      expect(await readConfig(page)).toEqual(before)
      expect((await updateConfig(page, original)).body.code).toBe(0)
    })
  } finally { expect((await updateConfig(page, original)).body.code).toBe(0) }
})

test('[CFG numeric] field limits and dependent duration thresholds reject invalid writes', async ({ page }) => {
  await login(page)
  const original = await readConfig(page)
  const fields: Array<[string, string, number, number]> = [
    ['sync', 'intervalMinutes', 1, 1440], ['sync', 'downloadConcurrency', 1, 10],
    ['sync', 'plexScanRetries', 1, 20], ['sync', 'plexScanRetryDelaySec', 5, 60],
    ['sync', 'logRetentionDays', 1, 30], ['sync', 'jobRetentionSuccessDays', 1, 7],
    ['sync', 'jobRetentionFailedDays', 14, 30], ['sync', 'downloadTaskRetentionDays', 1, 30],
    ['initializationMatching', 'musicBrainzMinScore', 90, 100], ['initializationMatching', 'musicBrainzMaxArtists', 1, 200],
  ]
  try {
    for (const [section, key, min, max] of fields) await test.step(`${section}.${key}`, async () => {
      for (const value of [min, max]) {
        expect((await updateConfig(page, { [section]: { [key]: value } })).body.code).toBe(0)
        const loaded = await readConfig(page) as unknown as Record<string, Record<string, unknown>>
        expect(loaded[section]?.[key]).toBe(value)
      }
      const before = await readConfig(page)
      for (const value of [min - 1, max + 1, min + 0.5, 'abc', null]) {
        expect((await updateConfig(page, { [section]: { [key]: value } })).body.code).not.toBe(0)
        expect(await readConfig(page)).toEqual(before)
      }
    })
    expect((await updateConfig(page, { initializationMatching: { recommendDurationMs: 8000, reviewDurationMs: 2000 } })).body.code).not.toBe(0)
  } finally { expect((await updateConfig(page, original)).body.code).toBe(0) }
})
