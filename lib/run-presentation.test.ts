import { describe, expect, it } from 'vitest'
import {
  runBadgeStatus,
  runStatusLabel,
  runTypeIdentity,
} from './run-presentation'

describe('run presentation', () => {
  it('gives each run type a stable visual identity', () => {
    expect(runTypeIdentity('sync')).toMatchObject({
      label: '同步任务',
      icon: 'sync',
      tone: 'sync',
    })
    expect(runTypeIdentity('manual_download')).toMatchObject({
      label: '手动下载',
      icon: 'download',
      tone: 'download',
    })
    expect(runTypeIdentity('repair')).toMatchObject({
      label: '补全任务',
      icon: 'database',
      tone: 'repair',
    })
  })

  it('keeps run status labels and badge tones aligned', () => {
    expect(runStatusLabel('success')).toBe('成功')
    expect(runBadgeStatus('success')).toBe('ok')
    expect(runStatusLabel('partial')).toBe('部分成功')
    expect(runBadgeStatus('partial')).toBe('warning')
    expect(runBadgeStatus('running')).toBe('running')
    expect(runBadgeStatus('failed')).toBe('error')
    expect(runBadgeStatus('cancelled')).toBe('idle')
  })
})
