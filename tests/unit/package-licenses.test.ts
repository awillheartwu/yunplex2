import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { packageLicenses } from '../../scripts/package-licenses.mjs'

const roots: string[] = []
function fixture(runtime: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'yunplex-license-fixture-'))
  roots.push(root)
  mkdirSync(join(root, '.output/server'), { recursive: true })
  writeFileSync(join(root, '.output/server/package.json'), JSON.stringify({ dependencies: runtime }))
  return root
}
function dependency(root: string, name: string, version: string, notices: Record<string, string>) {
  const directory = join(root, 'node_modules/.pnpm', encodeURIComponent(`${name}@${version}`), 'node_modules', name)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, version, license: 'ISC' }))
  for (const [file, text] of Object.entries(notices)) writeFileSync(join(directory, file), text)
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('distribution license notices', () => {
  it('preserves original terms and attribution for distinct installed versions and drops stale output', () => {
    const root = fixture({ '@fixture/native': '2.0.0' })
    const original = 'Copyright (c) Fixture authors\nOriginal permission and disclaimer.\n'
    dependency(root, '@fixture/native', '1.0.0', { LICENSE: 'Older upstream terms\n' })
    dependency(root, '@fixture/native', '2.0.0', { 'LICENSE.txt': original, NOTICE: 'Original attribution\n' })
    mkdirSync(join(root, '.output/licenses/npm'), { recursive: true })
    writeFileSync(join(root, '.output/licenses/npm/stale'), 'obsolete')

    const result = packageLicenses(root)

    expect(result.missingRuntimeNotices).toEqual([])
    expect(result.packages.filter(pkg => pkg.runtime).map(pkg => pkg.version)).toEqual(['2.0.0'])
    expect(readFileSync(join(root, '.output/licenses/npm', encodeURIComponent('@fixture/native@2.0.0'), 'LICENSE.txt'), 'utf8')).toBe(original)
    expect(readFileSync(join(root, '.output/licenses/npm', encodeURIComponent('@fixture/native@1.0.0'), 'LICENSE'), 'utf8')).toBe('Older upstream terms\n')
    expect(existsSync(join(root, '.output/licenses/npm/stale'))).toBe(false)
  })

  it('reports missing upstream texts without assigning the project MIT license to them', () => {
    const root = fixture({ fixture: '1.0.0', absent: '2.0.0' })
    dependency(root, 'fixture', '1.0.0', {})

    const result = packageLicenses(root)

    expect(result.missingRuntimeNotices).toEqual([{ name: 'fixture', version: '1.0.0' }, { name: 'absent', version: '2.0.0' }])
    expect(result.packages[0]).toMatchObject({ license: 'ISC', notices: [], runtime: true })
    expect(JSON.parse(readFileSync(join(root, '.output/licenses/npm/index.json'), 'utf8'))).toEqual(result)
  })

  it('uses only the verified upstream text for its recorded version and rejects altered content', () => {
    const root = fixture({ fixture: '2.0.0' })
    dependency(root, 'fixture', '1.0.0', {})
    dependency(root, 'fixture', '2.0.0', {})
    const directory = join(root, 'licenses/upstream')
    mkdirSync(directory, { recursive: true })
    const text = 'Original locked-version copyright and permission.\n'
    const license = join(directory, 'fixture-LICENSE.txt')
    writeFileSync(license, text)
    writeFileSync(join(directory, 'sources.json'), JSON.stringify([{ package: 'fixture', version: '2.0.0',
      files: [{ file: 'fixture-LICENSE.txt', source: 'https://example.invalid/immutable/LICENSE',
        sha256: createHash('sha256').update(text).digest('hex') }] }]))
    const result = packageLicenses(root)
    expect(result.missingRuntimeNotices).toEqual([])
    expect(result.packages.find(pkg => pkg.version === '1.0.0')?.notices).toEqual([])
    expect(readFileSync(join(root, '.output/licenses/npm', encodeURIComponent('fixture@2.0.0'), 'fixture-LICENSE.txt'), 'utf8')).toBe(text)
    writeFileSync(license, 'altered')
    expect(() => packageLicenses(root)).toThrow('checksum mismatch')
  })
})
