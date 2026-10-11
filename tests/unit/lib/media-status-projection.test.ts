import { describe, expect, it } from 'vitest'
import {
  isAttentionSongStatusProjection,
  isDistinctWarningSongStatus,
  projectMatchOverviewState,
  projectStaticResolutionStatus,
} from '~~/lib/media-status-projection'

describe('media status projection', () => {
  it('projects waiting as a completed attention state across run and overview models', () => {
    expect(projectStaticResolutionStatus('awaiting_manual')).toEqual({
      status: 'awaiting_manual_match',
      phase: 'done',
    })
    expect(projectMatchOverviewState('awaiting_manual_match')).toBe('awaiting_manual')
    expect(isAttentionSongStatusProjection('awaiting_manual_match')).toBe(true)
    expect(isDistinctWarningSongStatus('awaiting_manual_match')).toBe(true)
  })

  it('does not project resolutions whose outcome needs runtime context', () => {
    expect(projectStaticResolutionStatus('needs_download')).toBeNull()
    expect(projectStaticResolutionStatus('unavailable')).toBeNull()
    expect(projectMatchOverviewState('failed_download')).toBeNull()
  })
})
