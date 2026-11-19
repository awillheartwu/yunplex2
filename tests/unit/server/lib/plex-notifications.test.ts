import { describe, expect, it } from 'vitest'
import { acquirePlexNotifications, type PlexNotification } from '~~/server/lib/plex-notifications'
import {
  plexConfig,
  sendText,
  sseEvent,
  startPlexContractServer,
  startPlexSseResponse,
  waitFor,
  type PlexContractServer,
  type PlexSseConnection,
} from '~~/tests/helpers/plex-contract-server'

function activityNotification(
  id: string,
  event: 'started' | 'updated' | 'ended',
  options: { section?: number; progress?: number; title?: string } = {},
) {
  return {
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
  }
}

describe('Plex notification contract', () => {
  it('parses chunked activity and timeline events while ignoring SSE heartbeats', async () => {
    let server: PlexContractServer | undefined
    let sse: PlexSseConnection | undefined
    const events: PlexNotification[] = []
    let unsubscribe: (() => void) | undefined
    let lease: ReturnType<typeof acquirePlexNotifications> | undefined
    try {
      server = await startPlexContractServer((_request, response, recorded) => {
        if (recorded.url.startsWith('/:/eventsource/notifications?')) {
          sse = startPlexSseResponse(response)
        } else {
          sendText(response, 'not found', 404)
        }
      })
      lease = acquirePlexNotifications(plexConfig(server.port))
      unsubscribe = lease.stream.subscribe(event => events.push(event))
      await lease.stream.ready
      await waitFor(() => Boolean(sse) && lease!.stream.connected, 'notifications stream to connect')
      const connectedRevision = lease.stream.revision
      const activity = sseEvent('activity', activityNotification('scan-1', 'started', {
        section: 12,
        progress: 12.5,
        title: '正在扫描音乐库',
      }), '\r\n')
      const encoded = Buffer.from(`: keep-alive\r\n\r\n${activity}`)
      const titleOffset = encoded.indexOf(Buffer.from('扫'))
      expect(titleOffset).toBeGreaterThan(4)
      const splitAt = [5, titleOffset + 1, titleOffset + 2, encoded.length - 4]
      let offset = 0
      for (const end of splitAt) {
        sse!.write(encoded.subarray(offset, end))
        offset = end
      }
      sse!.write(encoded.subarray(offset))

      await waitFor(() => events.some(event => event.type === 'activity'), 'activity notification')
      const scan = lease.stream.activities.get('scan-1')
      expect(scan).toMatchObject({
        id: 'scan-1',
        sectionKey: '12',
        active: true,
        completed: false,
        progress: 12.5,
        title: '正在扫描音乐库',
      })
      expect(events.find(event => event.type === 'activity')).toMatchObject({ phaseChanged: true })

      sse!.write(sseEvent('timeline', {
        NotificationContainer: { TimelineEntry: { state: 5, type: 15, sectionID: 12 } },
      }, '\r\n'))
      await waitFor(() => events.some(event => event.type === 'library'), 'playlist timeline notification')
      expect(events.find(event => event.type === 'library')).toEqual({
        type: 'library',
        sectionKey: '12',
        playlist: true,
      })
      expect(lease.stream.revision).toBe(connectedRevision + 2)

      const subscription = server.requests.find(request => request.url.startsWith('/:/eventsource/notifications?'))!
      const subscriptionUrl = new URL(subscription.url, 'http://plex.invalid')
      expect(subscriptionUrl.pathname).toBe('/:/eventsource/notifications')
      expect(subscriptionUrl.searchParams.get('filters')).toBe('activity,timeline')
      expect(subscription.headers.accept).toBe('text/event-stream')
      expect(subscription.headers['x-plex-token']).toBe('fixture-token')
    } finally {
      unsubscribe?.()
      await lease?.release()
      await server?.close()
    }
  })

  it('drops connection-scoped activities and reconnects after Plex closes the stream', async () => {
    let server: PlexContractServer | undefined
    const connections: PlexSseConnection[] = []
    const events: PlexNotification[] = []
    let unsubscribe: (() => void) | undefined
    let lease: ReturnType<typeof acquirePlexNotifications> | undefined
    try {
      server = await startPlexContractServer((_request, response, recorded) => {
        if (recorded.url.startsWith('/:/eventsource/notifications?')) connections.push(startPlexSseResponse(response))
        else sendText(response, 'not found', 404)
      })
      lease = acquirePlexNotifications(plexConfig(server.port))
      unsubscribe = lease.stream.subscribe(event => events.push(event))
      await lease.stream.ready
      await waitFor(() => connections.length === 1 && lease!.stream.connected, 'first notifications connection')

      connections[0]!.write(sseEvent('activity', activityNotification('reconnect-scan', 'started', {
        section: 12,
        progress: 30,
      })))
      await waitFor(() => lease!.stream.activities.get('reconnect-scan')?.active === true, 'active scan before disconnect')
      connections[0]!.end()

      await waitFor(() => events.some(event => event.type === 'connection' && !event.connected), 'disconnect notification')
      await waitFor(() => connections.length === 2 && lease!.stream.connected, 'reconnected notifications stream', 5_000)
      expect(lease.stream.activities.has('reconnect-scan')).toBe(false)
      expect(events.filter((event): event is Extract<PlexNotification, { type: 'connection' }> => event.type === 'connection')
        .map(event => event.connected)).toEqual([true, false, true])
      expect(server.requests.filter(request => request.url.startsWith('/:/eventsource/notifications?'))).toHaveLength(2)
    } finally {
      unsubscribe?.()
      await lease?.release()
      await server?.close()
    }
  }, 8_000)
})
