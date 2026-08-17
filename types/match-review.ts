export type BindingMethod = 'path' | 'manual'
export type BindingStatus = 'active' | 'stale' | 'unbound'

export interface SongIdentityBinding {
  neteaseSongId: number
  plexSectionKey: string
  /** Last observed Plex path, retained for diagnostics and backward compatibility. */
  plexFilePath: string
  /** Canonical, NFC-normalized path relative to the configured Plex music root. */
  plexRelativePath: string
  plexRatingKey: string | null
  bindingMethod: BindingMethod
  status: BindingStatus
  evidence: Record<string, unknown>
  createdAt: string
  updatedAt: string
  lastVerifiedAt: string | null
}
