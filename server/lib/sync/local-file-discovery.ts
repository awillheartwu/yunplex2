import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import dayjs from 'dayjs'
import type { AppConfig } from '../config/types'
import type { NeteaseSong } from '../netease'
import { buildDownloadPath } from '../tag-writer'
import { createSplitArtists } from './artist-utils'

const LOSSLESS_FIRST_QUALITIES = new Set(['lossless', 'hires', 'jymaster', 'jyeffect'])
const AUDIO_EXTENSION_FALLBACKS = ['flac', 'mp3', 'm4a', 'aac', 'ogg', 'wav']

function getAudioExtensionCandidates(quality: AppConfig['netease']['quality']): string[] {
  const preferred = LOSSLESS_FIRST_QUALITIES.has(quality)
    ? ['flac', 'mp3', 'm4a']
    : ['mp3', 'm4a', 'flac']
  return [...new Set([...preferred, ...AUDIO_EXTENSION_FALLBACKS])]
}

function buildPathVars(song: NeteaseSong, cfg: AppConfig) {
  const splitArtists = createSplitArtists(cfg.other?.multiArtistFormat ?? 'ampersand')
  const [albumArtist] = splitArtists(song.artists)

  return {
    artist: albumArtist,
    album: song.album.name,
    title: song.name,
    year: song.album.publishTime > 0 ? dayjs(song.album.publishTime).format('YYYY') : '',
    track: String(song.no),
    'track:02d': String(song.no).padStart(2, '0'),
  }
}

export function findExistingLocalSongPath(song: NeteaseSong, cfg: AppConfig): string | null {
  const vars = buildPathVars(song, cfg)

  for (const ext of getAudioExtensionCandidates(cfg.netease.quality)) {
    const relativePath = buildDownloadPath(cfg.other?.pathFormat ?? '{artist}/{album} ({year})/{title}', vars, ext)
    const absolutePath = join(cfg.download.dir, relativePath)
    if (existsSync(absolutePath)) return absolutePath
  }

  // Fallback: if the exact extension changed, scan the computed album directory.
  const sampleRelativePath = buildDownloadPath(
    cfg.other?.pathFormat ?? '{artist}/{album} ({year})/{title}',
    vars,
    'flac',
  )
  const albumDir = join(cfg.download.dir, dirname(sampleRelativePath))
  if (!existsSync(albumDir)) return null

  const stem = sampleRelativePath.replace(/\.\w+$/, '')
  const absoluteStem = join(cfg.download.dir, stem)
  for (const ext of AUDIO_EXTENSION_FALLBACKS) {
    const candidate = `${absoluteStem}.${ext}`
    if (existsSync(candidate)) return candidate
  }

  return null
}
