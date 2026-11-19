import type { SourceRequestResult, SourceRequestSnapshot } from '~~/server/lib/sync/source-requests'

export function sourceRequestReceipt(result: SourceRequestResult) {
  const base = `/sync-sources/${encodeURIComponent(result.sourceId)}`
  if (result.status === 'awaiting_review') return { label: '等待确认', tone: 'warning', action: '确认媒体接管', href: `${base}?tab=initialization` }
  if (result.status === 'busy') return { label: '暂未提交', tone: 'warning', action: '查看进行中的任务', href: '/task-center' }
  if (result.status === 'failed') return { label: '提交失败', tone: 'danger', action: '检查来源', href: base }
  const query = new URLSearchParams()
  if (result.kind === 'analysis') query.set('tab', 'initialization')
  if (result.requestId) query.set('request', result.requestId)
  return { label: '已提交', tone: 'muted', action: result.kind === 'analysis' ? '查看分析进度' : '查看同步进度', href: `${base}${query.size ? `?${query}` : ''}` }
}

export function sourceRequestProgress(request: SourceRequestSnapshot) {
  const analysis = request.kind === 'analysis'
  if (request.status === 'pending') return { label: '排队中', detail: analysis ? '正在排队检查已有音乐，完成后请确认使用哪些文件。' : '等待执行同步，可离开页面，任务会在后台继续。', tone: 'muted' }
  if (request.status === 'running') return { label: analysis ? '正在分析' : '正在同步', detail: '任务正在后台执行，进度会自动更新。', tone: 'accent' }
  if (request.status === 'completed') return { label: analysis ? '分析完成' : '处理结束', detail: analysis ? '查看推荐的歌曲文件，确认后再开始同步。' : '请查看运行记录确认歌曲结果与 Plex 同步情况。', tone: 'muted' }
  if (request.status === 'cancelled') return { label: '已取消', detail: '本次任务已停止，可回到收藏重新开始。', tone: 'muted' }
  return { label: '处理失败', detail: request.error || '请查看运行记录中的失败原因，再决定是否重试。', tone: 'danger' }
}
