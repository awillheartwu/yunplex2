# reYunPlex Domain Context

reYunPlex mirrors NetEase playlist intent into local managed media and Plex playlists. Media identity must remain independent from Plex scraper metadata.

## Language

**Playlist Source**: A persisted NetEase playlist or album whose ordered songs define one synchronization scope.
_Avoid_: Job, feed

**Target Song**: One NetEase song occurrence in the current Playlist Source snapshot.
_Avoid_: Item, row

**Track Resolution**: The current outcome: verified Plex media, local managed file, required download, awaiting manual choice, or unavailable.
_Avoid_: Metadata match, lookup result

**Media Link**: The durable association between one NetEase song and Plex. It is either a managed exact-path link (`path`) or explicit adoption (`manual`).
_Avoid_: Metadata match, candidate, cache entry

**Local Media Asset**: A recorded local audio file, including managed/external ownership and continuity state.
_Avoid_: Download cache, local track

**Managed Media Command**: One source-aware intent to create or reuse a YunPlex-managed copy, commit its Local Media Asset exactly once, and require affected Playlist Sources to realign.
_Avoid_: Manual download shortcut, second Source Convergence

**Explicit Adoption**: A user's one-time selection of an external Plex item. This is the only way external media becomes reusable.
_Avoid_: Automatic match, review approval

**Playlist Occurrence**: One concrete `playlistItemID` and position inside a Plex playlist snapshot.
_Avoid_: Song identity, track identity

**Reconciliation Plan**: Ordered Plex target plus occurrence-specific mutation authorization after Track Resolution.
_Avoid_: Diff, removal list

**Source Convergence**: One attempt to bring a Playlist Source, Local Media Assets, Media Links, and Plex playlist to the current NetEase snapshot.
_Avoid_: Source job, sync step

## Invariants

- Plex title, artist, album, GUID and scraper-provided MusicBrainz data are presentation, never automatic identity.
- A managed file is reused only when exactly one Plex item exposes its exact path.
- External media is reused only after Explicit Adoption, then verified by ratingKey and exact path.
- Unverified identity follows the configured policy: create a new managed download or await an explicit user choice. Ambiguity never chooses the first result.
- A completed audio operation commits its Local Media Asset exactly once; file execution itself does not persist identity.
- Reconciliation removes only concrete Plex Playlist Occurrences, never media files.
