# ADR 0002: Separate run identity from result semantics

## Status

Accepted.

## Context

Task Center presents several kinds of work: playlist synchronization, manual downloads,
and repair runs. A run also has operational outcomes such as success, existing content,
ignored content, warnings, failures, and active work.

Using the same color channel for both run type and run outcome made cards harder to scan.
Repeating every source-fetch step in the timeline also hid the result explanation users
usually need first.

## Decision

Run type has a stable visual identity independent of its current status:

| Run type | Color | Icon |
| --- | --- | --- |
| Sync | Teal/green | Refresh |
| Manual download | Blue | Download |
| Repair | Purple | Database |

Operational results use one shared semantic palette across run lists, run details,
source details, exception handling, and download-related surfaces:

| Meaning | Color |
| --- | --- |
| Success | Green |
| Already exists | Gray |
| Ignored / copyright restricted | Yellow |
| Warning / destructive reconciliation | Orange |
| Failure | Red |
| Running | Blue |

Color is never the only signal. Labels and Lucide icons accompany semantic colors.

Run Detail derives a process-summary timeline from the existing `TaskRun` payload:

- source-fetch steps are aggregated into one expandable event;
- meaningful operational steps remain individually visible;
- song outcomes are grouped by semantic result and can be expanded;
- start and finish events keep the run understandable without opening the song table.

The detailed source steps and song records remain available, preserving traceability.
No database migration or duplicate event store is introduced.

## Consequences

- New run types must define a `RunTypeIdentity` in `lib/run-presentation.ts`.
- New song statuses must define a semantic presentation in `lib/task-status.ts`.
- Task surfaces should use shared tokens instead of hard-coded status colors.
- Timeline changes should remain a presentation concern unless the backend gains events
  that cannot be inferred faithfully from `TaskRun`.
