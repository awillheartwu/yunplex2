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

**Media Repair Command**: One persisted Playlist Source operation that repairs tags and ancillary files on existing local audio, resumes after restart, commits its Local Media Asset through the shared download queue, and may request a Plex library refresh without mutating a Plex playlist.
_Avoid_: Fire-and-forget repair loop, second Source Convergence

**Explicit Adoption**: A user's one-time selection of an external Plex item. This is the only way external media becomes reusable.
_Avoid_: Automatic match, review approval

**Playlist Occurrence**: One concrete `playlistItemID` and position inside a Plex playlist snapshot.
_Avoid_: Song identity, track identity

**Reconciliation Plan**: Ordered Plex target plus occurrence-specific mutation authorization after Track Resolution.
_Avoid_: Diff, removal list

**Source Convergence**: One attempt to bring a Playlist Source, Local Media Assets, Media Links, and Plex playlist to the current NetEase snapshot.
_Avoid_: Source job, sync step

**Source Schedule**: The persisted next due time and latest scheduling outcome for one Playlist Source. A null source interval inherits the global interval.
_Avoid_: Global scan timer, cron flag

**Source Request**: One persisted request for the single source consumer to analyze first media adoption or run Source Convergence. It records mode, trigger, optional batch and initialization links. Manual requests are rejected while work is busy; an accepted mixed batch is serialized with ready sources first.
_Avoid_: In-memory analysis queue, background callback

**Source Convergence Request**: The convergence kind of a Source Request, created by manual acceptance, a schedule window or an initialization follow-up.
_Avoid_: Source job, background callback

**File Task Association**: A caller's durable link to an actual download task. Several runs may reuse the same task without transferring its original ownership. Waiting and cancellation belong to each caller; file execution remains global.

**First Media Adoption Draft**: A versioned, read-only analysis snapshot until explicit user decisions are committed. Verified bindings are preserved items; actionable items expose allowed decisions. Incompatible rule versions remain readable but require reanalysis before submission.

## Invariants

- Plex title, artist, album, GUID and scraper-provided MusicBrainz data are presentation, never automatic identity.
- A managed file is reused only when exactly one Plex item exposes its exact path.
- External media is reused only after Explicit Adoption, then verified by ratingKey and exact path.
- Unverified identity follows the configured policy: create a new managed download or await an explicit user choice. Ambiguity never chooses the first result.
- A completed audio operation commits its Local Media Asset exactly once; file execution itself does not persist identity.
- Reconciliation removes only concrete Plex Playlist Occurrences, never media files.
