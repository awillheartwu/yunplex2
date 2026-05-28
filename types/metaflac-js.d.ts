declare module 'metaflac-js' {
  interface Tags {
    title?: string
    artist?: string
    album?: string
    albumArtist?: string
    tracknumber?: string
    date?: string
    genre?: string
    comment?: string
    [key: string]: string | undefined
  }
  class Metaflac {
    constructor(filePath: string)
    getTag(tag: string): string
    setTag(tag: string): void
    removeTag(tag: string): void
    getVorbisComment(): string[]
    build(): Uint8Array
    getAllTags(): Tags
    importPictureFromBuffer(buffer: ArrayBuffer | Uint8Array): void
    importPicture(buffer: ArrayBuffer | Uint8Array): void
    save(): Promise<void>
  }
  export default Metaflac
}
