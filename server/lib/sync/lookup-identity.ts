import { upsertVerifiedSongIdentityBinding } from './identity-store'

export function bindResolvedIdentity(
  songId: number,
  sectionKey: string,
  ratingKey: string,
  plexPath: string,
  mbRecordingId: string | undefined,
  method: 'path' | 'mb_recording' | 'provider_guid' | 'migrated',
  evidence: Record<string, unknown>,
): void {
  upsertVerifiedSongIdentityBinding({
    neteaseSongId: songId,
    plexSectionKey: sectionKey,
    plexFilePath: plexPath,
    plexRatingKey: ratingKey,
    mbRecordingId: mbRecordingId ?? null,
    bindingMethod: method,
    status: 'active',
    evidence,
  })
}
