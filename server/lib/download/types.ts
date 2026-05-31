/**
 * Controls which aspects of a song download to execute.
 *
 * 'full'    - Download audio if missing on disk. Always write all configured
 *             ancillary files (lyrics, covers, metadata tags) regardless of
 *             whether they already exist. Default for normal sync and retry.
 *
 * 'missing' - Only execute download/write operations for files that do not
 *             already exist on disk. Each output file is checked individually.
 *             Used for repair operations and future download-only mode.
 */
export type DownloadMode = 'full' | 'missing'
