import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '~~/server/lib/config/defaults'
import { startPlexLibraryMonitor } from '~~/server/lib/plex-library-monitor'
import { openPlexScanEvents, type PlexScanEvents } from '~~/server/lib/plex-scan-events'
import {
  plexConfig,
  sendJson,
  sendText,
  sseEvent,
  startPlexContractServer,
  startPlexSseResponse,
  waitFor,
  type PlexContractServer,
  type PlexSseConnection,
} from '~~/tests/helpers/plex-contract-server'

function activityEvent(
  id: string,
  event: 'started' | 'updated' | 'ended',
  options: { section?: number; progress?: number; title?: string } = {},
) {
  return sseEvent('activity', {
    NotificationContainer: {
      ActivityNotification: [{
        uuid: id,
        event,
        Activity: {
          type: 'library.update.section',
          progress: options.progress,
          title: options.title,
          ...(options.section === undefined ? {} : { Context: { librarySectionID: options.section } }),
        },
      }],
    },
  }, '\r\n')
}

describe('Plex scan events', () => {
  it('associates an activity returned by refresh even when its events omit the library section', async () => {
    let server: PlexContractServer | undefined
    let sse: PlexSseConnection | undefined
    let scan: PlexScanEvents | undefined
    try {
      server = await startPlexContractServer((_request, response, recorded) => {
        if (recorded.url.startsWith('/:/eventsource/notifications?')) sse = startPlexSseResponse(response)
        else sendText(response, 'not found', 404)
      })
      scan = await openPlexScanEvents(plexConfig(server.port), '12')
      await waitFor(() => Boolean(sse) && scan!.getState().connected, 'scan notifications stream')
      const requestedAt = performance.now()
      const initialRevision = scan.getState().revision

      sse!.write(activityEvent('scan-42', 'started', {
        progress: 25,
        title: '正在扫描音乐库',
      }))
      await waitFor(() => scan!.getState().revision === initialRevision + 1, 'activity without section context')
      expect(scan.getState()).toMatchObject({ active: false, completed: false })

      scan.setActivityId('scan-42', requestedAt)
      expect(scan.getState()).toMatchObject({
        connected: true,
        active: true,
        completed: false,
      })

      const beforeEnd = scan.getState()
      const changed = scan.waitForChange(beforeEnd.revision, 3_000)
      sse!.write(activityEvent('scan-42', 'ended'))
      await changed
      await waitFor(() => scan!.getState().completed, 'completed scan state')
      expect(scan.getState()).toMatchObject({ connected: true, active: false, completed: true })
      expect(scan.getState().endRevision).toBe(beforeEnd.endRevision + 1)
    } finally {
      await scan?.close()
      await server?.close()
    }
  })

  it('ignores an activity that ended before the current scan started listening', async () => {
    let server: PlexContractServer | undefined
    let sse: PlexSseConnection | undefined
    let scan: PlexScanEvents | undefined
    try {
      server = await startPlexContractServer((_request, response, recorded) => {
        if (recorded.url.startsWith('/:/eventsource/notifications?')) sse = startPlexSseResponse(response)
        else sendText(response, 'not found', 404)
      })
      scan = await openPlexScanEvents(plexConfig(server.port), '12')
      await waitFor(() => Boolean(sse) && scan!.getState().connected, 'scan notifications stream')
      const initialRevision = scan.getState().revision

      sse!.write(activityEvent('old-scan', 'started', { section: 12, progress: 10 })
        + activityEvent('old-scan', 'ended', { section: 12 }))
      await waitFor(() => scan!.getState().revision >= initialRevision + 2, 'old activity lifecycle')
      scan.setActivityId('old-scan', performance.now())
      expect(scan.getState()).toMatchObject({ active: false, completed: false })

      sse!.write(activityEvent('old-scan', 'started', { progress: 40 }))
      await waitFor(() => scan!.getState().active, 'activity after the scan request boundary')
      expect(scan.getState()).toMatchObject({ connected: true, active: true, completed: false })
    } finally {
      await scan?.close()
      await server?.close()
    }
  })

  it('switches monitor configuration while preserving a scan lease and releases both connections', async () => {
    const firstConnections: PlexSseConnection[] = []
    const secondConnections: PlexSseConnection[] = []
    let first: PlexContractServer | undefined
    let second: PlexContractServer | undefined
    let monitor: ReturnType<typeof startPlexLibraryMonitor> | undefined
    let scan: PlexScanEvents | undefined
    const config = structuredClone(DEFAULT_CONFIG)
    const library = {
      MediaContainer: {
        Directory: [{
          key: '12', title: 'Music', type: 'artist', refreshing: false,
          contentChangedAt: 1_700_000_000, scannedAt: 1_700_000_000,
        }],
      },
    }
    try {
      first = await startPlexContractServer((_request, response, recorded) => {
        if (recorded.url.startsWith('/:/eventsource/notifications?')) firstConnections.push(startPlexSseResponse(response))
        else if (recorded.url === '/library/sections') sendJson(response, library)
        else sendText(response, 'not found', 404)
      })
      second = await startPlexContractServer((_request, response, recorded) => {
        if (recorded.url.startsWith('/:/eventsource/notifications?')) secondConnections.push(startPlexSseResponse(response))
        else if (recorded.url === '/library/sections') sendJson(response, library)
        else sendText(response, 'not found', 404)
      })
      config.plex = plexConfig(first.port, { token: 'first-account' })
      monitor = startPlexLibraryMonitor(() => config, () => true)
      await waitFor(() => firstConnections.length === 1 && monitor!.getSnapshot().connected, 'first monitor connection')
      scan = await openPlexScanEvents(config.plex, '12')
      await waitFor(() => monitor!.getSnapshot().lastCheckedAt !== null, 'first monitor library check')
      expect(firstConnections).toHaveLength(1)
      const firstConnection = firstConnections[0]!

      config.plex = plexConfig(second.port, { token: 'second-account' })
      monitor.update()
      await waitFor(() => secondConnections.length === 1 && monitor!.getSnapshot().connected, 'second monitor connection')
      expect(firstConnection.closed).toBe(false)

      await scan.close()
      scan = undefined
      await waitFor(() => firstConnection.closed, 'old monitor connection release after scan closes')
      expect(firstConnections).toHaveLength(1)
      expect(secondConnections[0]!.closed).toBe(false)

      await monitor.stop()
      monitor = undefined
      await waitFor(() => secondConnections[0]!.closed, 'new monitor connection release on stop')
    } finally {
      await scan?.close()
      await monitor?.stop()
      await Promise.allSettled([first?.close(), second?.close()])
    }
  })
})
