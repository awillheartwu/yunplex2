import { describe, expect, it } from 'vitest'
import {
  parseFailureRecordFilters,
  parseOptionalBoolean,
  parsePlaylistSourceFilters,
  parseRunFilters,
} from '../../server/lib/api-filter-params'

describe('api filter parameter parsing', () => {
  it('parses optional booleans without treating garbage as false', () => {
    expect(parseOptionalBoolean('true')).toBe(true)
    expect(parseOptionalBoolean('1')).toBe(true)
    expect(parseOptionalBoolean(true)).toBe(true)
    expect(parseOptionalBoolean('false')).toBe(false)
    expect(parseOptionalBoolean('0')).toBe(false)
    expect(parseOptionalBoolean(false)).toBe(false)
    expect(parseOptionalBoolean('')).toBeUndefined()
    expect(parseOptionalBoolean('maybe')).toBeUndefined()
  })

  it('parses playlist source filters and drops invalid enums', () => {
    expect(parsePlaylistSourceFilters({
      search: '  mellow  ',
      type: 'playlist',
      enabled: '1',
      subscribed: 'false',
      lastStatus: 'partial',
      hasFailures: 'true',
      hasCopyright: '0',
    })).toEqual({
      search: 'mellow',
      type: 'playlist',
      enabled: true,
      subscribed: false,
      lastStatus: 'partial',
      hasFailures: true,
      hasCopyright: false,
    })

    expect(parsePlaylistSourceFilters({ type: 'artist', lastStatus: 'unknown' })).toMatchObject({
      type: undefined,
      lastStatus: undefined,
    })
  })

  it('parses run filters with safe pagination defaults', () => {
    expect(parseRunFilters({
      type: 'sync',
      status: 'failed',
      search: '  song id  ',
      sourceId: ' source-1 ',
      from: '2026-01-01',
      to: '2026-01-31',
      limit: '25',
      offset: '-10',
    })).toEqual({
      type: 'sync',
      status: 'failed',
      search: 'song id',
      sourceId: 'source-1',
      from: '2026-01-01',
      to: '2026-01-31',
      limit: 25,
      offset: 0,
    })

    expect(parseRunFilters({ type: 'manual', status: 'done', limit: '0', offset: 'NaN' })).toMatchObject({
      type: undefined,
      status: undefined,
      limit: 1,
      offset: 0,
    })
  })

  it('validates unified run and failure record filters, including dates and time zones', () => {
    expect(parseRunFilters({
      type: 'manual_download',
      status: 'cancelled',
      from: '2026-06-22',
      to: '2026-06-30',
      timeZone: 'Asia/Shanghai',
    })).toMatchObject({
      type: 'manual_download',
      status: 'cancelled',
      from: '2026-06-22',
      to: '2026-06-30',
      timeZone: 'Asia/Shanghai',
    })

    expect(parseRunFilters({
      type: 'garbage',
      status: 'done',
      from: '2026-02-31',
      to: 'not-a-date',
      timeZone: 'Moon/Base',
    })).toMatchObject({
      type: undefined,
      status: undefined,
      from: undefined,
      to: undefined,
      timeZone: undefined,
    })

    expect(parseFailureRecordFilters({
      status: 'ignored',
      type: 'repair',
      failureKind: 'rate_limited',
      limit: '500',
    })).toMatchObject({
      status: 'ignored',
      type: 'repair',
      failureKind: 'rate_limited',
      limit: 100,
    })

    expect(parseFailureRecordFilters({
      status: 'unknown',
      type: 'manual',
      failureKind: 'metadata_failed',
    })).toMatchObject({
      status: 'open',
      type: undefined,
      failureKind: undefined,
    })
  })
})
