import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_CONFIG } from '~~/server/lib/config/defaults'
import {
  diagnoseStorageVisibility,
  extractPlexMusicSection,
  testDownloadPathConfig,
} from '~~/server/lib/config/connection-test'

const tempDirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'reyunplex-storage-visibility-'))
  tempDirs.push(dir)
  return dir
}

describe('Plex storage visibility diagnostics', () => {
  afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('builds a reversible local-to-Plex sample without claiming that mapping copies files', () => {
    const downloadDir = tempDir()
    const config = {
      ...DEFAULT_CONFIG,
      download: {
        ...DEFAULT_CONFIG.download,
        dir: downloadDir,
        plexLibraryPathPrefix: '/volume1/music',
      },
      plex: { ...DEFAULT_CONFIG.plex, server: '192.0.2.50', section: '音乐' },
    }

    const diagnostic = diagnoseStorageVisibility(config, {
      section: { key: '12', title: '音乐', locations: ['/volume1/music'] },
      localAddresses: ['127.0.0.1', '192.168.2.10'],
    })

    expect(diagnostic.sample).toEqual({
      relativePath: '路径诊断/示例专辑/01 - 示例歌曲.flac',
      localPath: join(downloadDir, '路径诊断/示例专辑/01 - 示例歌曲.flac'),
      plexPath: '/volume1/music/路径诊断/示例专辑/01 - 示例歌曲.flac',
      roundTripLocalPath: join(downloadDir, '路径诊断/示例专辑/01 - 示例歌曲.flac'),
      roundTripMatches: true,
    })
    expect(diagnostic.mappingValid).toBe(true)
    expect(diagnostic.publicationVerified).toBe(false)
    expect(diagnostic.status).toBe('warning')
    expect(diagnostic.code).toBe('remote_storage_unverified')
    expect(diagnostic.summary).toContain('只完成了路径换算')
    expect(diagnostic.action).toContain('挂载')
  })

  it('recognises an identical same-host shared library path as verified', () => {
    const sharedDir = tempDir()
    const config = {
      ...DEFAULT_CONFIG,
      download: {
        ...DEFAULT_CONFIG.download,
        dir: sharedDir,
        plexLibraryPathPrefix: sharedDir,
      },
      plex: { ...DEFAULT_CONFIG.plex, server: '127.0.0.1', section: 'Music' },
    }

    const diagnostic = diagnoseStorageVisibility(config, {
      section: { key: '7', title: 'Music', locations: [sharedDir] },
      localAddresses: ['127.0.0.1'],
    })

    expect(diagnostic.status).toBe('verified')
    expect(diagnostic.code).toBe('shared_storage_verified')
    expect(diagnostic.serverScope).toBe('local')
    expect(diagnostic.publicationVerified).toBe(true)
    expect(diagnostic.prefixMatchesSection).toBe(true)
  })

  it('warns when the configured Plex prefix does not overlap the selected section location', () => {
    const downloadDir = tempDir()
    const diagnostic = diagnoseStorageVisibility({
      ...DEFAULT_CONFIG,
      download: { ...DEFAULT_CONFIG.download, dir: downloadDir, plexLibraryPathPrefix: '/wrong/music' },
      plex: { ...DEFAULT_CONFIG.plex, server: 'plex.lan', section: 'Music' },
    }, {
      section: { key: '7', title: 'Music', locations: ['/srv/plex/music'] },
      localAddresses: ['127.0.0.1'],
    })

    expect(diagnostic.status).toBe('warning')
    expect(diagnostic.code).toBe('section_prefix_mismatch')
    expect(diagnostic.prefixMatchesSection).toBe(false)
    expect(diagnostic.action).toContain('/srv/plex/music')
  })

  it('does not accept a Plex prefix that is only a parent of the selected section', () => {
    const downloadDir = tempDir()
    const diagnostic = diagnoseStorageVisibility({
      ...DEFAULT_CONFIG,
      download: { ...DEFAULT_CONFIG.download, dir: downloadDir, plexLibraryPathPrefix: '/srv/plex' },
      plex: { ...DEFAULT_CONFIG.plex, server: 'plex.lan', section: 'Music' },
    }, {
      section: { key: '7', title: 'Music', locations: ['/srv/plex/music'] },
      localAddresses: ['127.0.0.1'],
    })

    expect(diagnostic.code).toBe('section_prefix_mismatch')
    expect(diagnostic.prefixMatchesSection).toBe(false)
    expect(diagnostic.sample.plexPath).toBe('/srv/plex/路径诊断/示例专辑/01 - 示例歌曲.flac')
  })

  it('warns instead of failing when Plex inspection is unavailable', () => {
    const downloadDir = tempDir()
    const result = testDownloadPathConfig({
      ...DEFAULT_CONFIG,
      download: { ...DEFAULT_CONFIG.download, dir: downloadDir, plexLibraryPathPrefix: '/music' },
      plex: { ...DEFAULT_CONFIG.plex, server: 'plex.lan', token: 'token', section: 'Music' },
    }, {
      plexInspectionError: 'Plex 请求超时',
      localAddresses: ['127.0.0.1'],
    })

    expect(result.success).toBe(true)
    expect(result.writable).toBe(true)
    expect(result.storageVisibility).toMatchObject({
      status: 'warning',
      code: 'plex_inspection_unavailable',
      publicationVerified: false,
      inspectionError: 'Plex 请求超时',
    })
  })

  it('redacts transport credentials from every storage inspection warning', () => {
    const diagnostic = diagnoseStorageVisibility({
      ...DEFAULT_CONFIG,
      download: { ...DEFAULT_CONFIG.download, dir: tempDir() },
      plex: { ...DEFAULT_CONFIG.plex, server: 'plex.example' },
    }, {
      plexInspectionError: 'Plex timeout /library/sections?X-Plex-Token=fixture-plex; Authorization: Bearer fixture-bearer; Cookie: MUSIC_U=fixture-music; session=fixture-session',
      localAddresses: ['127.0.0.1'],
    })

    expect(diagnostic.code).toBe('plex_inspection_unavailable')
    expect(diagnostic.inspectionError).toContain('Plex timeout')
    expect(diagnostic.checks.find(check => check.key === 'section')?.detail).toBe(diagnostic.inspectionError)
    const result = JSON.stringify(diagnostic)
    for (const secret of ['fixture-plex', 'fixture-bearer', 'fixture-music', 'fixture-session']) expect(result).not.toContain(secret)
  })

  it('extracts all locations from the configured music section', () => {
    const section = extractPlexMusicSection({
      MediaContainer: {
        Directory: [
          { key: '1', type: 'movie', title: 'Movies', Location: [{ path: '/video' }] },
          {
            key: '12',
            type: 'artist',
            title: '音乐',
            Location: [{ path: '/volume1/music' }, { path: '/volume2/archive' }],
          },
        ],
      },
    }, '音乐')

    expect(section).toEqual({
      key: '12',
      title: '音乐',
      locations: ['/volume1/music', '/volume2/archive'],
    })
  })
})
