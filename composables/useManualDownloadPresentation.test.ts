import { describe, expect, it } from 'vitest'
import {
  buildManualQueueTabs,
  canDeleteManualDownloadTask,
  formatManualDuration,
  formatManualRelativeTime,
  formatManualTotalDuration,
  manualDownloadStatusLabel,
  manualDownloadStatusTone,
  manualQualityLabel,
  manualResourceTypeLabel,
} from './useManualDownloadPresentation'

describe('manual download presentation helpers', () => {
  it('formats resource type quality and status labels', () => {
    expect(manualResourceTypeLabel('playlist')).toBe('歌单')
    expect(manualResourceTypeLabel('album')).toBe('专辑')
    expect(manualResourceTypeLabel('songs')).toBe('单曲')
    expect(manualResourceTypeLabel(null)).toBe('未识别')
    expect(manualQualityLabel('jymaster')).toBe('臻品母带')
    expect(manualQualityLabel('lossless')).toBe('无损')
    expect(manualDownloadStatusLabel('tagging')).toBe('写入标签')
    expect(manualDownloadStatusLabel('failed')).toBe('失败')
  })

  it('maps download status tones', () => {
    expect(manualDownloadStatusTone('pending')).toBe('idle')
    expect(manualDownloadStatusTone('downloading')).toBe('running')
    expect(manualDownloadStatusTone('tagging')).toBe('running')
    expect(manualDownloadStatusTone('done')).toBe('success')
    expect(manualDownloadStatusTone('failed')).toBe('danger')
  })

  it('formats track durations and relative times', () => {
    const now = new Date('2026-06-16T12:00:00.000Z')
    expect(formatManualDuration(272000)).toBe('4:32')
    expect(formatManualDuration(0)).toBe('-')
    expect(formatManualTotalDuration(0)).toBe('0 分钟')
    expect(formatManualTotalDuration(45 * 60000)).toBe('45 分钟')
    expect(formatManualTotalDuration(125 * 60000)).toBe('2 小时 5 分钟')
    expect(formatManualRelativeTime('2026-06-16T11:59:30.000Z', now)).toBe('刚刚')
    expect(formatManualRelativeTime('2026-06-16T11:20:00.000Z', now)).toBe('40 分钟前')
    expect(formatManualRelativeTime('2026-06-16T09:00:00.000Z', now)).toBe('3 小时前')
  })

  it('builds queue tabs from status counts', () => {
    expect(buildManualQueueTabs({
      pending: 2,
      downloading: 1,
      tagging: 1,
      done: 5,
      failed: 3,
      total: 12,
    })).toEqual([
      { key: 'running', label: '下载中', count: 2 },
      { key: 'pending', label: '等待中', count: 2 },
      { key: 'failed', label: '失败', count: 3 },
    ])
  })

  it('does not allow deleting running tasks', () => {
    expect(canDeleteManualDownloadTask({ status: 'pending' })).toBe(true)
    expect(canDeleteManualDownloadTask({ status: 'done' })).toBe(true)
    expect(canDeleteManualDownloadTask({ status: 'failed' })).toBe(true)
    expect(canDeleteManualDownloadTask({ status: 'downloading' })).toBe(false)
    expect(canDeleteManualDownloadTask({ status: 'tagging' })).toBe(false)
  })
})
