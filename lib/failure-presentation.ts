import type { FailureHandlingState } from '../shared/failure-handling'

export function failureStatePresentation(state: FailureHandlingState) {
  if (state.status === 'resolved') return { label: '已解决', badge: 'ok' as const, tone: 'success' as const, description: '' }
  if (state.status === 'open' && state.notApplicable === true) return { label: '不再适用', badge: 'warning' as const, tone: 'warning' as const, description: '歌曲已不属于当前来源，或没有可重试的文件任务；需要时按当前内容重新发起操作' }
  if (state.status === 'open' && state.recovery?.action === 'retry' && state.automaticRecoveryEnabled === false) {
    return { label: '等待手动重试', badge: 'warning' as const, tone: 'warning' as const, description: '来源或全局自动同步未开启，可手动重试或启用自动同步' }
  }
  if (state.status === 'open' && state.attemptCount === 0) return { label: '已请求重试', badge: 'running' as const, tone: 'running' as const, description: '已按原意图排队，等待执行与核对' }
  if (state.status === 'open') return {
    label: state.recovery?.action === 'retry' ? '等待自动重试'
      : state.recovery?.action === 'paused' ? '已暂停' : '等待人工处理',
    badge: 'warning' as const, tone: 'warning' as const,
    description: state.recovery?.action === 'retry'
      ? `连续失败 ${state.attemptCount} 次${state.recovery.nextRetryAt ? `，下次尝试 ${new Date(state.recovery.nextRetryAt).toLocaleString('zh-CN')}` : ''}`
      : state.recovery?.action === 'paused'
        ? state.errorCode === 'authentication_failed' ? '更新 Cookie 并验证成功后恢复'
          : state.errorCode === 'plex_authentication_failed' ? '修复 Plex Token 或音乐库权限并验证成功后恢复'
          : '修复原任务的目录、挂载或空间后继续队列'
        : '当前问题不会频繁重试，修复外部条件或完成媒体选择后可手动重试',
  }
  return {
    label: state.ignoreReason === 'automatic' ? '历史暂停' : '已忽略',
    badge: 'warning' as const, tone: 'warning' as const,
    description: state.ignoreReason === 'automatic' ? '旧策略停止的记录保持暂停；显式重试后采用新恢复规则' : '用户已选择忽略，停止自动处理，可手动重试',
  }
}
