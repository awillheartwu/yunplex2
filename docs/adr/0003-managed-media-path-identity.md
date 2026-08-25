# ADR 0003: Managed Media Path Identity

**Date:** 2026-07-24
**Status:** Accepted; media ownership and continuity remain current, while identity evidence was amended by [ADR 0004](0004-durable-identity-convergence.md) and then replaced by [ADR 0005](0005-safe-media-reuse.md)

## Context

Plex metadata is presentation data produced by a scraper. It can legitimately differ from
Netease metadata because of aliases, transliteration, compilation artists, different album
editions, or a user correction. Treating those fields as the identity of a file downloaded
by YunPlex caused stable files to be reviewed, removed, and re-added after Plex metadata
changed.

At the same time, a path predicted from the current naming template is not proof that
YunPlex created the file. Existing user-managed libraries can contain an unrelated recording
at the same computed path.

## Decision

### Persist media ownership

`local_media_assets` records whether each Netease song's local file is:

- `managed`: YunPlex wrote the audio bytes.
- `external`: YunPlex discovered or reused a pre-existing file.

Queue completion records the real file operation. A skipped download that adopted an
existing file is external; a repair that reuses a previously managed asset keeps its managed
ownership. Historical download-task records are migrated to managed unless their evidence
explicitly says they adopted an existing file. Computed naming-policy paths are external.

### Use managed exact paths as strong identity

The automatic identity order at the time of this decision was:

1. Valid explicit human binding.
2. Unique exact Plex path for an active managed asset.
3. Existing verified automatic binding.
4. Typed provider identity, MusicBrainz recording, or configured high-confidence metadata.
5. Review candidate.

A managed exact-path match ignores Plex title, artist, album, and scraper GUID changes.
This makes a user correction in Plex presentation metadata stable across subsequent syncs.

External exact paths do not establish identity by themselves. They only add path evidence
to the ordinary provider/MB/metadata/review pipeline.

### Require path uniqueness and file continuity

A path is strong only if one Plex `ratingKey` owns it. Multiple Plex identities for the same
path are ambiguous and require review.

Managed assets store size and modification time after YunPlex writes them. If either changes
outside a subsequent managed write, the asset becomes `replaced`; exact-path trust is
withdrawn until YunPlex writes it again or a user binds it explicitly.

### Keep deletion separately protected

Identity resolution does not by itself authorize deletion. Playlist mutation still requires
successful Plex readback, current target snapshots, unchanged binding versions, and the
existing extra-track deletion gates.

## Consequences

- Plex scraper metadata can be edited without breaking YunPlex identity.
- YunPlex-created files normally bypass MusicBrainz and metadata review.
- Existing user libraries remain conservative and may still require strong external evidence
  or manual review.
- Replaced files and duplicate Plex path ownership are visible in Match Management and never
  cause automatic deletion.
- Durable identity and local media provenance remain separate from rebuildable performance data. ADR 0004 later retired `song_lookup` and weak automatic metadata identity entirely.
