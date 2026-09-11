import { describe, expect, it } from 'vitest'
import {
  runBadgeStatus,
  runSummaryLabel,
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
    expect(runTypeIdentity('source_initialization')).toMatchObject({
      label: '首次媒体接管',
      icon: 'search',
      tone: 'initialization',
    })
  })

  it('keeps run status labels and badge tones aligned', () => {
    expect(runStatusLabel('success')).toBe('成功')
    expect(runBadgeStatus('success')).toBe('ok')
    expect(runStatusLabel('partial')).toBe('部分成功')
    expect(runBadgeStatus('partial')).toBe('warning')
    expect(runBadgeStatus('running')).toBe('running')
    expect(runStatusLabel('awaiting_action')).toBe('等待确认')
    expect(runBadgeStatus('awaiting_action')).toBe('warning')
    expect(runBadgeStatus('failed')).toBe('error')
    expect(runBadgeStatus('cancelled')).toBe('idle')
  })

  it('presents immutable legacy summaries with current failure-cache semantics', () => {
    expect(runSummaryLabel('10 个源，失败 3 首，266 首已忽略')).toBe('10 个源，失败 3 首，266 首需关注')
    expect(runSummaryLabel('', '同步任务')).toBe('同步任务')
  })
})
