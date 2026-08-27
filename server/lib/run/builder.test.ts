import { describe, expect, it } from 'vitest'
import { RunBuilder } from './builder'

describe('RunBuilder source/song indexing', () => {
  it('persists the full source scope before any song results exist', () => {
    const run = new RunBuilder(false)
    run.setSourceIds(['source-1', 'source-2', 'source-1'])

    expect(run.getRun().sourceIds).toEqual(['source-1', 'source-2'])
    expect(run.getRun().songs).toHaveLength(0)
  })

  it('keeps structured context on run steps', () => {
    const run = new RunBuilder(false)
    const stepId = run.startStep('compare', '对比 Plex 歌单', {
      context: {
        sourceId: 'source-1',
        sourceName: '华语摇滚精选',
        plexPlaylistName: 'Plex 华语摇滚精选',
      },
    })

    run.finishStep(stepId, 'success', '待下载 1 首')

    expect(run.getRun().steps[0]).toMatchObject({
      type: 'compare',
      title: '对比 Plex 歌单',
      context: {
        sourceId: 'source-1',
        sourceName: '华语摇滚精选',
        plexPlaylistName: 'Plex 华语摇滚精选',
      },
    })
  })

  it('keeps songs with the same name distinct by neteaseSongId', () => {
    const run = new RunBuilder(false)
    run.addSongs('source-1', [
      { songName: 'Same Name', artist: 'Artist A', album: 'Album A', status: 'pending', neteaseSongId: 101 },
      { songName: 'Same Name', artist: 'Artist B', album: 'Album B', status: 'pending', neteaseSongId: 202 },
    ])

    const firstId = run.findSongId('source-1', 101)
    const secondId = run.findSongId('source-1', 202)

    expect(firstId).toBeTruthy()
    expect(secondId).toBeTruthy()
    expect(firstId).not.toBe(secondId)

    if (!firstId || !secondId) throw new Error('Expected song IDs to exist')

    run.updateSong(firstId, { status: 'success', phase: 'done' })
    run.updateSong(secondId, { status: 'failed_download', phase: 'download' })

    expect(run.getSong('source-1', 101)?.status).toBe('success')
    expect(run.getSong('source-1', 202)?.status).toBe('failed_download')
  })

  it('counts protected extra Plex tracks as warnings instead of removed songs', () => {
    const run = new RunBuilder(false)
    run.addSongs('source-1', [
      { songName: 'Extra', artist: 'Artist', album: 'Album', status: 'removed' },
      { songName: 'Protected Extra', artist: 'Artist', album: 'Album', status: 'extra_skipped' },
    ])

    const finished = run.finish('partial', 'done')

    expect(finished.removedSongs).toBe(1)
    expect(finished.warnings).toBe(1)
  })

  it('counts songs awaiting manual choice as attention warnings', () => {
    const run = new RunBuilder(false)
    run.addSongs('source-1', [
      { songName: 'Waiting', artist: 'Artist', album: 'Album', status: 'awaiting_manual_match', neteaseSongId: 101 },
    ])

    expect(run.finish('success', 'done').warnings).toBe(1)
  })

  it('keeps duplicate occurrences of the same Netease song independently addressable', () => {
    const run = new RunBuilder(false)
    const ids = run.addSongs('source-1', [
      { songName: 'Duplicate', artist: 'Artist', album: 'Album', status: 'pending', neteaseSongId: 101, neteaseIndex: 0 },
      { songName: 'Duplicate', artist: 'Artist', album: 'Album', status: 'pending', neteaseSongId: 101, neteaseIndex: 1 },
    ])

    expect(run.findSongIds('source-1', 101)).toEqual(ids)
    expect(run.findSongIdByIndex('source-1', 0)).toBe(ids[0])
    expect(run.findSongIdByIndex('source-1', 1)).toBe(ids[1])

    run.updateSong(ids[0]!, { status: 'skipped_existing', phase: 'done' })
    run.updateSong(ids[1]!, { status: 'success', phase: 'done' })
    expect(run.getSongByIndex('source-1', 0)?.status).toBe('skipped_existing')
    expect(run.getSongByIndex('source-1', 1)?.status).toBe('success')
  })

  it('does not double-count a pending target and its protected Plex candidate', () => {
    const run = new RunBuilder(false)
    run.addSongs('source-1', [{
      songName: 'Target',
      artist: 'Artist',
      album: 'Album',
      status: 'match_pending_review',
      neteaseSongId: 101,
      neteaseIndex: 0,
    }])
    const extraId = run.addExtraSong('source-1', {
      songName: 'Candidate',
      artist: 'Plex Artist',
      album: 'Plex Album',
      playlistItemId: 500,
      ratingKey: '900',
    })
    run.updateSong(extraId, {
      metadata: {
        matchTrace: { relatedNeteaseSongId: 101, decision: 'preserved' },
      },
    })

    const finished = run.finish('partial', 'done')
    expect(finished.totalSongs).toBe(1)
    expect(finished.warnings).toBe(1)
  })
})
