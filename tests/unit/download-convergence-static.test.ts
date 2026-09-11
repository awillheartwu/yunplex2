import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '../..')

function filesBelow(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name)
    return statSync(path).isDirectory() ? filesBelow(path) : [path]
  })
}

describe('download convergence architecture', () => {
  it('keeps direct download execution out of production HTTP handlers', () => {
    const handlers = filesBelow(resolve(ROOT, 'server/api'))
      .filter(path => path.endsWith('.ts') && !path.endsWith('.test.ts'))
    for (const path of handlers) {
      const source = readFileSync(path, 'utf8')
      expect(source, path).not.toMatch(/\bdownloadSingleSong\s*\(/)
      expect(source, path).not.toMatch(/\bprocessAll\s*\(/)
    }
  })

  it('gives the unique worker sole production ownership of queue draining', () => {
    const productionFiles = filesBelow(resolve(ROOT, 'server/lib'))
      .filter(path => path.endsWith('.ts') && !path.endsWith('.test.ts'))
      .filter(path => !path.endsWith('/download/queue.ts'))
    const owners = productionFiles.filter(path => /\bprocessAll\s*\(/.test(readFileSync(path, 'utf8')))
    expect(owners.map(path => path.replace(`${ROOT}/`, ''))).toEqual(['server/lib/download/worker.ts'])
  })

  it('routes every manual resource shape through Resource Selection', () => {
    const batch = readFileSync(resolve(ROOT, 'server/lib/download/download-batch.ts'), 'utf8')
    expect(batch).toContain('selectDownloadResource')
    expect(batch).not.toContain('fetchPlaylistSongs')
    expect(batch).not.toContain('fetchAlbumSongs')
    expect(batch).not.toContain('fetchSongDetail')
  })
})
