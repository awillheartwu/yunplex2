# ADR 0004: Durable Identity Convergence

**Date:** 2026-08-09
**Status:** Accepted

## Context

Earlier reconciliation used `song_lookup` as a verified routing cache and allowed sufficiently similar metadata to participate in automatic identity. In practice, cache state and presentation metadata could drift independently from the local file and the Plex playlist occurrence. That made it difficult to explain which evidence established identity and which evidence authorized deletion.

The system now has durable stores for global song identity, local media provenance, human review, identity history and source-specific occurrences. Keeping the older cache and weak automatic metadata binding would create a second, less auditable source of truth.

## Decision

### Use two formal identity facts

- `song_identity_bindings` records the durable NetEase-to-Plex identity and its evidence.
- `local_media_assets` records the local file, provenance, ownership and continuity state.

`song_lookup` is dropped from current databases. Historical migrations may create it only so later migrations can upgrade old installations safely.

### Retire weak metadata identity

Title, artists, album, track number and duration may rank or explain candidates, but cannot create an automatic Identity Binding. Existing active metadata bindings become stale and affected Playlist Sources require reconciliation.

Automatic identity requires one of:

1. an explicit human decision;
2. a unique, continuous YunPlex-managed exact path;
3. an exact typed provider identity;
4. the same uniquely resolved MusicBrainz recording on both sides.

Ambiguous or weaker candidates become Match Reviews.

### Separate identity from mutation authorization

An Identity Binding does not authorize removal by itself. The Reconciliation Plan authorizes changes per Plex Playlist Occurrence only after target completeness, review state, binding versions and Plex read-back checks pass.

## Consequences

- Pure reorder validates active Identity Bindings and current Plex paths instead of consulting `song_lookup`.
- Rebuild matching preserves manual decisions, stales automatic bindings in scope and records identity events.
- Cached MusicBrainz responses remain performance data, not identity facts.
- Historical schema migrations remain append-only for upgrade compatibility even when they mention retired tables.
- ADR 0001 is superseded. ADR 0003 remains valid for media ownership and continuity, with its evidence order amended by this decision.
