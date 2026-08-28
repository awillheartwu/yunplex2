import { upsertVerifiedSongIdentityBinding } from './identity-store'

export function bindResolvedIdentity(
  songId: number,
  sectionKey: string,
  sectionRoot: string,
  ratingKey: string,
  plexPath: string,
  evidence: Record<string, unknown>,
): void {
  upsertVerifiedSongIdentityBinding({
    neteaseSongId: songId,
    plexSectionKey: sectionKey,
    plexSectionRoot: sectionRoot,
    plexFilePath: plexPath,
    plexRatingKey: ratingKey,
    bindingMethod: 'path',
    status: 'active',
    evidence,
  })
}
