import type { FailureHandlingState } from '../shared/failure-handling'
import { getDomainErrorDefinition } from '../shared/domain-errors'

export function failureStatePresentation(state: FailureHandlingState) {
  if (state.status === 'resolved') return { label: '已解决', badge: 'ok' as const, tone: 'success' as const, description: '' }
  if (state.status === 'open') return {
    label: '待处理', badge: 'error' as const, tone: 'failure' as const,
    description: `失败 ${state.attemptCount}/${state.attemptLimit} 次，尚可重试`,
  }
  return {
    label: state.ignoreReason === 'automatic' ? '已自动忽略' : state.ignoreReason === 'manual' ? '已手动忽略' : '已忽略',
    badge: 'warning' as const, tone: 'warning' as const,
    description: state.ignoreReason !== 'automatic' ? '已停止自动处理，可手动重试'
      : getDomainErrorDefinition(state.errorCode).retryable
        ? `失败 ${state.attemptCount}/${state.attemptLimit} 次，已达到上限，可手动重试`
        : '此类问题不自动重试，可手动重试',
  }
}
