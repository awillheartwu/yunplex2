import type { AppConfig } from '../config/types'
import type { SingleSongConfig } from './single-song'

export type SingleSongConfigOverrides = Partial<
  Pick<
    SingleSongConfig,
    | 'quality'
    | 'downloadMode'
    | 'target'
    | 'downloadLyrics'
    | 'embedMetadata'
    | 'embedCover'
  >
>

/**
 * Resolve every download default in one place.
 *
 * Callers provide only the operation-specific differences. This keeps retries,
 * repairs and Source Convergence aligned when configuration defaults evolve.
 */
export function resolveSingleSongConfig(
  config: AppConfig,
  overrides: SingleSongConfigOverrides = {},
): SingleSongConfig {
  return {
    quality: overrides.quality ?? config.netease.quality,
    cookie: config.netease.cookie,
    downloadDir: config.download.dir,
    pathFormat: config.other?.pathFormat ?? '{artist}/{album} ({year})/{title}',
    multiArtistFormat: config.other?.multiArtistFormat ?? 'ampersand',
    downloadLyrics: overrides.downloadLyrics ?? config.download.downloadLyrics,
    embedMetadata: overrides.embedMetadata ?? config.download.embedMetadata,
    embedCover: overrides.embedCover ?? config.download.embedCover,
    saveAlbumCover: config.download.saveAlbumCover ?? false,
    saveArtistImage: config.download.saveArtistImage ?? false,
    lyricOrder: config.other?.lyricOrder ?? 'original_first',
    downloadTranslatedLyric: config.other?.downloadTranslatedLyric ?? true,
    downloadRomajiLyric: config.other?.downloadRomajiLyric ?? false,
    ...(overrides.downloadMode ? { downloadMode: overrides.downloadMode } : {}),
    ...(overrides.target ? { target: overrides.target } : {}),
  }
}
