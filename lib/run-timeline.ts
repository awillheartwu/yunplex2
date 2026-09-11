import type { JobStep, JobStepContext, SongTask, TaskRun } from '~~/server/lib/job/types'
import { runStatusLabel, runTriggerLabel, runTypeLabel } from '~~/lib/run-presentation'
import {
  isFailedSongStatus,
  isAttentionSongStatus,
  songStatusPresentation,
  type TaskSemanticTone,
} from '~~/lib/task-status'

export interface RunTimelineDetail {
  id: string
  title: string
  description?: string
  subjectLabel?: string
  tone?: TaskSemanticTone
}

export interface RunTimelineItem {
  id: string
  occurredAt: string | null
  title: string
  description: string
  subjectLabel?: string
  tone: TaskSemanticTone
  icon: string
  statusLabel?: string
  durationMs?: number
  details: RunTimelineDetail[]
}

function stepTone(step: JobStep): TaskSemanticTone {
  if (step.status === 'failed') return 'failure'
  if (step.status === 'partial') return 'warning'
  if (step.status === 'running') return 'running'
  if (step.status === 'skipped' || step.status === 'cancelled') return 'existing'
  if (step.status === 'success') return 'success'
  return 'neutral'
}

function stepIcon(step: JobStep): string {
  const title = `${step.type} ${step.title}`.toLowerCase()
  if (title.includes('plex') || title.includes('歌单')) return title.includes('重排') ? 'list' : 'source'
  if (title.includes('download') || title.includes('下载')) return 'download'
  if (title.includes('repair') || title.includes('补全')) return 'database'
  if (title.includes('refresh') || title.includes('刷新')) return 'refresh'
  return step.status === 'failed' ? 'failure' : 'checkCircle'
}

interface TimelineSourceContext {
  sourceId?: string
  label: string
  plexLabel?: string
  startedAt: string | null
  finishedAt: string | null
}

function cleanLabel(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function extractQuotedLabel(value: string): string {
  const match = value.match(/[“"「](.+?)[”"」]/)
  return cleanLabel(match?.[1])
}

function stripSourceTitlePrefix(title: string): string {
  return title
    .replace(/^获取(?:歌单|专辑)[:：]?\s*/, '')
    .replace(/^同步源[:：]?\s*/, '')
    .trim()
}

function contextPlaylistLabel(context?: JobStepContext): string {
  const plexLabel = cleanLabel(context?.plexPlaylistName)
  const playlistLabel = cleanLabel(context?.playlistName)
  const sourceLabel = cleanLabel(context?.sourceName)
  return plexLabel || playlistLabel || sourceLabel
}

function contextSourceLabel(context?: JobStepContext): string {
  const sourceLabel = cleanLabel(context?.sourceName)
  const playlistLabel = cleanLabel(context?.playlistName)
  const plexLabel = cleanLabel(context?.plexPlaylistName)
  return sourceLabel || playlistLabel || plexLabel
}

function stepSourceContext(step: JobStep): TimelineSourceContext | null {
  const fromContext = contextSourceLabel(step.context)
  const fromTitle = stripSourceTitlePrefix(step.title)
  const fromMessage = extractQuotedLabel(step.message)
  const label = fromContext || fromTitle || fromMessage
  if (!label) return null
  return {
    sourceId: cleanLabel(step.context?.sourceId) || undefined,
    label,
    plexLabel: contextPlaylistLabel(step.context) || undefined,
    startedAt: step.startedAt,
    finishedAt: step.finishedAt,
  }
}

function operationSubjectLabel(step: JobStep, sourceContexts: TimelineSourceContext[]): string {
  const fromContext = contextPlaylistLabel(step.context)
  if (fromContext) return fromContext

  const titleLabel = extractQuotedLabel(step.title)
  if (titleLabel) return titleLabel

  const stepTime = step.startedAt ? new Date(step.startedAt).getTime() : Number.NaN
  if (!Number.isFinite(stepTime)) return ''

  const previous = sourceContexts
    .filter(source => source.startedAt && new Date(source.startedAt).getTime() <= stepTime)
    .sort((left, right) => new Date(right.startedAt!).getTime() - new Date(left.startedAt!).getTime())[0]

  return previous?.plexLabel || previous?.label || ''
}

function isContextualOperationStep(step: JobStep): boolean {
  const value = `${step.type} ${step.title}`.toLowerCase()
  return value.includes('plex')
    || value.includes('歌单')
    || value.includes('专辑曲目')
    || value.includes('download')
    || value.includes('下载')
    || Boolean(step.context?.sourceId || step.context?.sourceName || step.context?.playlistName || step.context?.plexPlaylistName)
}

function isSourceDiscoveryStep(step: JobStep): boolean {
  const value = `${step.type} ${step.title}`.toLowerCase()
  return value.includes('获取歌单')
    || value.includes('获取专辑')
    || value.includes('fetch_playlist')
    || value.includes('playlist_fetch')
    || value.includes('fetch playlist')
}

function compareIso(a: string | null, b: string | null): number {
  if (!a && !b) return 0
  if (!a) return 1
  if (!b) return -1
  return new Date(a).getTime() - new Date(b).getTime()
}

function lastKnownTime(run: TaskRun): string {
  const candidates = [
    run.finishedAt,
    ...run.steps.flatMap(step => [step.finishedAt, step.startedAt]),
    run.startedAt,
  ].filter((value): value is string => Boolean(value))
  return candidates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || run.startedAt
}

function songDetail(song: SongTask, sourceNameById: Map<string, string>, shouldShowSource: boolean): RunTimelineDetail {
  const presentation = songStatusPresentation(song.status)
  const sourceName = song.sourceId ? sourceNameById.get(song.sourceId) : ''
  const songDescription = [song.artist, song.album].filter(Boolean).join(' · ')
  return {
    id: song.id,
    title: song.songName,
    description: [
      shouldShowSource && sourceName ? `来源：${sourceName}` : '',
      songDescription,
    ].filter(Boolean).join(' · '),
    subjectLabel: shouldShowSource ? sourceName : undefined,
    tone: presentation.tone,
  }
}

function resultItem(
  id: string,
  title: string,
  description: string,
  tone: TaskSemanticTone,
  icon: string,
  occurredAt: string,
  songs: SongTask[],
  sourceNameById: Map<string, string>,
  shouldShowSource: boolean,
): RunTimelineItem {
  return {
    id,
    occurredAt,
    title,
    description,
    tone,
    icon,
    details: songs.map(song => songDetail(song, sourceNameById, shouldShowSource)),
  }
}

export function buildRunTimeline(run: TaskRun): RunTimelineItem[] {
  const sourceSteps = run.steps.filter(isSourceDiscoveryStep)
  const operationSteps = run.steps.filter(step => !isSourceDiscoveryStep(step))
  const sourceContexts = sourceSteps
    .map(stepSourceContext)
    .filter((context): context is TimelineSourceContext => Boolean(context))
  const sourceNameById = new Map<string, string>()
  for (const source of sourceContexts) {
    if (source.sourceId) sourceNameById.set(source.sourceId, source.label)
  }
  for (const step of run.steps) {
    const sourceId = cleanLabel(step.context?.sourceId)
    const label = contextSourceLabel(step.context)
    if (sourceId && label) sourceNameById.set(sourceId, label)
  }
  const sourceIdsInSongs = new Set(run.songs.map(song => song.sourceId).filter((id): id is string => Boolean(id)))
  const shouldShowSongSource = sourceIdsInSongs.size > 1

  const items: RunTimelineItem[] = [{
    id: `${run.id}:started`,
    occurredAt: run.startedAt,
    title: `开始${runTypeLabel(run.type)}`,
    description: `${runTriggerLabel(run.trigger)} · ${run.source} → ${run.target}`,
    tone: 'running',
    icon: run.type === 'manual_download' ? 'download' : run.type === 'repair' ? 'database' : run.type === 'source_initialization' ? 'search' : 'sync',
    statusLabel: '开始',
    details: [],
  }]

  if (sourceSteps.length > 0) {
    const successful = sourceSteps.filter(step => step.status === 'success').length
    const failed = sourceSteps.filter(step => step.status === 'failed').length
    const running = sourceSteps.filter(step => step.status === 'running').length
    const tone: TaskSemanticTone = failed > 0 ? 'failure' : running > 0 ? 'running' : 'success'
    const description = failed > 0
      ? `已读取 ${successful} 个来源，${failed} 个来源失败`
      : running > 0
        ? `正在读取 ${sourceSteps.length} 个同步源`
        : `已读取 ${sourceSteps.length} 个同步源的最新内容`

    items.push({
      id: `${run.id}:sources`,
      occurredAt: sourceSteps.map(step => step.startedAt).sort(compareIso)[0] || run.startedAt,
      title: `解析 ${sourceSteps.length} 个同步源`,
      description,
      tone,
      icon: 'source',
      statusLabel: running > 0 ? '进行中' : failed > 0 ? '有失败' : '完成',
      durationMs: sourceSteps.reduce((sum, step) => sum + step.durationMs, 0),
      details: sourceSteps.map(step => ({
        id: step.id,
        title: stepSourceContext(step)?.label || stripSourceTitlePrefix(step.title),
        description: [
          step.context?.neteasePlaylistId ? `网易云 ID ${step.context.neteasePlaylistId}` : '',
          step.message || '',
        ].filter(Boolean).join(' · ') || undefined,
        subjectLabel: contextPlaylistLabel(step.context) || undefined,
        tone: stepTone(step),
      })),
    })
  }

  for (const step of operationSteps) {
    const subjectLabel = isContextualOperationStep(step)
      ? operationSubjectLabel(step, sourceContexts)
      : ''
    items.push({
      id: step.id,
      occurredAt: step.startedAt,
      title: step.title,
      description: step.message || '该步骤未提供额外说明',
      subjectLabel: subjectLabel || undefined,
      tone: stepTone(step),
      icon: stepIcon(step),
      statusLabel: step.status === 'running'
        ? '进行中'
        : step.status === 'failed'
          ? '失败'
          : step.status === 'partial'
            ? '部分完成'
            : step.status === 'cancelled'
              ? '已取消'
              : step.status === 'skipped'
                ? '已跳过'
                : step.status === 'success'
                  ? '完成'
                  : '等待',
      durationMs: step.durationMs,
      details: step.children.map(child => ({
        id: child.id,
        title: child.title,
        description: child.message || undefined,
        subjectLabel: operationSubjectLabel(child, sourceContexts) || subjectLabel || undefined,
        tone: stepTone(child),
      })),
    })
  }

  const outcomeTime = lastKnownTime(run)
  const existingSongs = run.songs.filter(song => song.status === 'skipped_existing')
  const attentionSongs = run.songs.filter(song => isAttentionSongStatus(song.status))
  const failedSongs = run.songs.filter(song => isFailedSongStatus(song.status))
  const successSongs = run.songs.filter(song => song.status === 'success')
  const removedSongs = run.songs.filter(song => song.status === 'removed')

  if (run.skippedSongs > 0) {
    items.push(resultItem(
      `${run.id}:existing`,
      `发现 ${run.skippedSongs} 首歌曲已存在`,
      '这些歌曲已在 Plex 音乐库中，本次无需重复下载',
      'existing',
      'existing',
      outcomeTime,
      existingSongs,
      sourceNameById,
      shouldShowSongSource,
    ))
  }
  if (run.warnings > 0) {
    items.push(resultItem(
      `${run.id}:ignored`,
      `跳过 ${run.warnings} 首需要关注的歌曲`,
      '包含版权受限，或达到连续失败阈值后已暂停自动重试的歌曲',
      'ignored',
      'ignored',
      outcomeTime,
      attentionSongs,
      sourceNameById,
      shouldShowSongSource,
    ))
  }
  if (run.failedSongs > 0) {
    items.push(resultItem(
      `${run.id}:failed`,
      `${run.failedSongs} 首歌曲处理失败`,
      '可展开查看失败歌曲，并前往异常处理进行重试',
      'failure',
      'failure',
      outcomeTime,
      failedSongs,
      sourceNameById,
      shouldShowSongSource,
    ))
  }
  if (run.successSongs > 0) {
    items.push(resultItem(
      `${run.id}:success`,
      `${run.successSongs} 首歌曲处理成功`,
      run.type === 'manual_download' ? '歌曲已下载并写入本地音乐库' : '歌曲已下载、写入标签并加入 Plex',
      'success',
      'checkCircle',
      outcomeTime,
      successSongs,
      sourceNameById,
      shouldShowSongSource,
    ))
  }
  if (run.removedSongs > 0) {
    items.push(resultItem(
      `${run.id}:removed`,
      `从 Plex 歌单移除 ${run.removedSongs} 首歌曲`,
      '这些歌曲已不在对应同步源中，歌曲文件本身不会被删除',
      'warning',
      'minusCircle',
      outcomeTime,
      removedSongs,
      sourceNameById,
      shouldShowSongSource,
    ))
  }

  items.push({
    id: `${run.id}:finished`,
    occurredAt: run.finishedAt || lastKnownTime(run),
    title: run.status === 'running'
      ? `${runTypeLabel(run.type)}仍在运行`
      : run.status === 'awaiting_action'
        ? `${runTypeLabel(run.type)}等待确认`
        : `${runTypeLabel(run.type)}已结束`,
    description: run.summary || runStatusLabel(run.status),
    tone: run.status === 'running'
      ? 'running'
      : run.status === 'awaiting_action'
        ? 'warning'
      : run.status === 'failed'
        ? 'failure'
        : run.status === 'partial'
          ? 'warning'
          : run.status === 'cancelled'
            ? 'existing'
            : 'success',
    icon: run.status === 'running' ? 'loader' : run.status === 'awaiting_action' ? 'warning' : run.status === 'failed' ? 'failure' : 'checkCircle',
    statusLabel: runStatusLabel(run.status),
    durationMs: run.durationMs,
    details: [],
  })

  return items
}
