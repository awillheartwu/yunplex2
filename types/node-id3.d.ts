declare module 'node-id3' {
  interface Tags {
    title?: string
    artist?: string
    albumArtist?: string
    album?: string
    trackNumber?: string
    date?: string
    year?: string
    genre?: string
    comment?: string
    composer?: string
    [key: string]: string | undefined
  }
  function write(tags: Tags, file: string): boolean
  function read(file: string): Tags
  function update(tags: Tags, file: string): boolean
}
