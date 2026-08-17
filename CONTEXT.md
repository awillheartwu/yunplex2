# reYunPlex Domain Context

reYunPlex mirrors NetEase playlist intent into local managed media and Plex playlists while preserving explicit identity evidence and safe reconciliation.

## Language

**Playlist Source**:
A persisted NetEase playlist or album whose ordered songs define one synchronization scope and its effective policy overrides.
_Avoid_: Job, feed

**Target Song**:
One NetEase song occurrence in the current Playlist Source snapshot, including its source order and metadata.
_Avoid_: Item, row

**Track Resolution**:
The current outcome of resolving a Target Song to an existing Plex track, a local file, a required download, or an unavailable state.
_Avoid_: Match result, lookup result

**Identity Binding**:
The durable association between one NetEase song and its strongest known Plex identity evidence. A binding may be active, stale, or explicitly unbound.
_Avoid_: Cache entry, metadata match

**Local Media Asset**:
The recorded local audio file associated with a NetEase song, including whether reYunPlex manages it and whether file continuity remains valid.
_Avoid_: Download cache, local track

**Match Review**:
A durable request for human judgment when automatic evidence cannot safely establish an Identity Binding.
_Avoid_: Warning, candidate popup

**Playlist Occurrence**:
One concrete position of a Target Song or Plex track inside a particular Playlist Source or Plex playlist snapshot.
_Avoid_: Song identity, track identity

**Reconciliation Plan**:
The ordered Plex target plus occurrence-specific mutation authorization derived after Track Resolution. Identity evidence alone never authorizes deletion.
_Avoid_: Diff, removal list

**Source Convergence**:
One complete attempt to bring a Playlist Source, its Local Media Assets, Identity Bindings, and Plex playlist into the state described by the current NetEase snapshot.
_Avoid_: Source job, sync step

## Flagged ambiguities

- “Match” can mean metadata similarity, an Identity Binding, or a Track Resolution. Use the precise term.
- “Track” can mean a NetEase Target Song, a Plex library record, or a Playlist Occurrence. Name the system and role.
- “Delete” must distinguish removing a Plex Playlist Occurrence from deleting a Local Media Asset; reconciliation only performs the former.

## Example dialogue

> Developer: This Playlist Source contains 80 Target Songs. Two Track Resolutions require Match Review, so can the Reconciliation Plan remove the old Plex entries?
>
> Domain expert: No. Pending Match Reviews make the target incomplete. Preserve those Playlist Occurrences until strong Identity Bindings exist and Source Convergence can validate the Plex readback.
