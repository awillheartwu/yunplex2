declare module 'plex-api' {
  interface PlexClientOptions {
    hostname: string
    port: number
    token: string
    options?: Record<string, unknown>
  }
  class PlexAPI {
    constructor(options: PlexClientOptions)
    query(url: string): Promise<Record<string, unknown>>
    putQuery(url: string): Promise<Record<string, unknown>>
  }
  export = PlexAPI
}
