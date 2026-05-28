# ADR 0001: Playlist Reconciliation

**Date:** 2026-05-27
**Status:** Accepted

## Context

The sync tool mirrors Netease Cloud Music playlists to Plex. The original implementation used a simple dual-pass approach: find songs in Netease not in Plex (download + add), find songs in Plex not in Netease (remove). Existing songs were never reordered.

This left several failure modes:
- Partial playlist reorder (new songs ordered correctly, existing songs frozen)
- No tiered lookup before downloading (Plex → disk → download)
- Cross-source song contamination in multi-source sync jobs
- No cache for Plex track lookups, causing repeated full-library searches

## Decision

### 1. Unified TrackResolution as reconciliation output

Instead of separate `newSongs` / `extraTracks` arrays, the reconciliation phase produces a single `TrackResolution[]` array indexed by Netease playlist position:

```
resolution:
  - matched_plex_playlist    — already in Plex playlist, may need reorder
  - found_in_plex_library    — in Plex library but not this playlist
  - found_on_disk            — file exists locally, needs Plex scan
  - needs_download           — must download from Netease
  - unavailable              — Netease has no download URL, no local copy
```

### 2. song_lookup table as routing cache

A persistent mapping `(netease_song_id → plex_rating_key, file_path, last_verified_at)` avoids repeated Plex full-library searches. Cache entries are verified (not blindly trusted) on each sync: a single cheap metadata lookup confirms the track still exists. Cache misses or invalidations fall through to live search.

### 3. Netease playlist as full source of truth

The entire Netease playlist is fetched every sync (2 API calls). No snapshot diffing — the tool does not track external mutations (user deletes from Plex, deletes local files, un-favorites in Netease), so full freshness is required.

### 4. LCS-based minimal reordering

Plex has no batch reorder API. Each `moveAfter` is one HTTP request. Using longest-common-subsequence between current Plex order and target Netease order minimizes the number of Plex API calls. Tracks already in the correct relative order are left untouched.

### 5. Unavailable tracks preserved as records

Songs that exist in Netease but have no download URL and no local/Plex copy are recorded in the DB with status `unavailable` rather than silently skipped. This lets the user audit missing tracks later.

## Consequences

- New DB table `song_lookup` with migration
- New `TrackResolution` type replaces scattered newSongs/extraTracks
- `plex-reconciler.ts` rewritten: `reconcileSource` → produce `TrackResolution[]`
- `service.ts` simplified: download/insert/reorder phases consume `TrackResolution[]`
- LCS algorithm in a new `reorder.ts` module
- Existing `compareTracks` / `findExtraTracks` / `updatePlaylist` deprecated and removed
