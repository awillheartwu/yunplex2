import type { AppConfig } from '../config/types'
import type { SingleSongConfig } from './single-song'

export type SingleSongConfigOverrides = Partial<
  Pick<
    SingleSongConfig,
    | 'quality'
    | 'downloadDir'
    | 'pathFormat'
    | 'multiArtistFormat'
    | 'artistAliases'
    | 'applyAliasToAlbum'
    | 'lyricOrder'
    | 'downloadTranslatedLyric'
    | 'downloadRomajiLyric'
    | 'downloadMode'
    | 'target'
    | 'downloadLyrics'
    | 'embedMetadata'
    | 'embedCover'
    | 'saveAlbumCover'
    | 'saveArtistImage'
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
    downloadDir: overrides.downloadDir ?? config.download.dir,
    pathFormat: overrides.pathFormat ?? config.other?.pathFormat ?? '{artist}/{album} ({year})/{title}',
    multiArtistFormat: overrides.multiArtistFormat ?? config.other?.multiArtistFormat ?? 'ampersand',
    artistAliases: overrides.artistAliases ?? config.other?.artistAliases ?? {},
    applyAliasToAlbum: overrides.applyAliasToAlbum ?? config.other?.applyAliasToAlbum ?? false,
    downloadLyrics: overrides.downloadLyrics ?? config.download.downloadLyrics,
    embedMetadata: overrides.embedMetadata ?? config.download.embedMetadata,
    embedCover: overrides.embedCover ?? config.download.embedCover,
    saveAlbumCover: overrides.saveAlbumCover ?? config.download.saveAlbumCover ?? false,
    saveArtistImage: overrides.saveArtistImage ?? config.download.saveArtistImage ?? false,
    lyricOrder: overrides.lyricOrder ?? config.other?.lyricOrder ?? 'original_first',
    downloadTranslatedLyric: overrides.downloadTranslatedLyric ?? config.other?.downloadTranslatedLyric ?? true,
    downloadRomajiLyric: overrides.downloadRomajiLyric ?? config.other?.downloadRomajiLyric ?? false,
    ...(overrides.downloadMode ? { downloadMode: overrides.downloadMode } : {}),
    ...(overrides.target ? { target: overrides.target } : {}),
  }
}
