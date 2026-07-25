<template>
  <section class="section-card download-queue-panel" aria-labelledby="download-queue-title">
    <header class="download-queue-panel__header">
      <div class="download-queue-panel__heading">
        <p class="download-queue-panel__eyebrow">流程追踪</p>
        <h3 id="download-queue-title">歌曲处理进度</h3>
        <p>{{ panelDescription }}</p>
      </div>
      <div class="download-queue-panel__actions">
        <NuxtLink v-if="activeRun?.id" :to="`/task-center/runs/${activeRun.id}`" class="btn btn-secondary btn-xs">
          查看运行
        </NuxtLink>
        <button class="btn btn-secondary btn-xs" type="button" :disabled="loading" @click="$emit('refresh')">
          <AppIcon :name="loading ? 'loader' : 'refresh'" :size="14" :class="{ 'animate-spin': loading }" />
          刷新
        </button>
      </div>
    </header>

    <div class="download-queue-panel__overview">
      <div class="download-queue-panel__stage-card">
        <div class="download-queue-panel__stage-copy">
          <span class="download-queue-panel__stage-badge" :class="`is-${stageBadgeTone}`">{{ stageBadge }}</span>
          <strong>{{ stageHeadline }}</strong>
          <p>{{ stageDescription }}</p>
        </div>
        <div v-if="showRunProgress" class="download-queue-panel__stage-progress">
          <strong>{{ runProgressPercent }}%</strong>
          <span>{{ progressLabel }}</span>
        </div>
      </div>

      <ol class="download-queue-flow" aria-label="歌曲处理流程">
        <li v-for="stage in flowStages" :key="stage.key" :class="`is-${stage.state}`">
          <span class="download-queue-flow__dot">
            <AppIcon :name="flowStageIcon(stage.state)" :size="12" />
          </span>
          <span>{{ stage.label }}</span>
        </li>
      </ol>

      <div class="download-queue-metrics" aria-label="歌曲处理统计">
        <article v-for="metric in metrics" :key="metric.key" :class="`is-${metric.tone}`">
          <small>{{ metric.label }}</small>
          <strong>{{ metric.count }}</strong>
          <p>{{ metric.description }}</p>
        </article>
      </div>
    </div>

    <div v-if="error" class="download-queue-panel__error" role="alert">
      <AppIcon name="warn" :size="16" />
      <span>{{ error }}</span>
      <button class="btn btn-ghost btn-xs" type="button" @click="$emit('refresh')">重试加载</button>
    </div>

    <div v-if="loading && visibleTasks.length === 0" class="download-queue-panel__loading" aria-live="polite">
      <AppIcon name="loader" :size="18" class="animate-spin" />
      正在加载歌曲处理进度…
    </div>

    <div v-else-if="visibleTasks.length > 0" class="download-queue-list" aria-live="polite">
      <article v-for="task in visibleTasks" :key="task.id" class="download-queue-row">
        <span class="download-queue-row__leading" :class="`is-${rowTone(task)}`">
          <AppIcon :name="rowIcon(task)" :size="17" />
        </span>

        <div class="download-queue-row__main">
          <div class="download-queue-row__title">
            <strong :title="task.songName">{{ task.songName }}</strong>
            <span class="download-queue-status" :class="`is-${rowTone(task)}`">
              {{ taskLabel(task) }}
            </span>
          </div>

          <p class="download-queue-row__summary">{{ taskSummary(task) }}</p>

          <div class="download-queue-row__meta">
            <span>{{ task.artist || '未知艺人' }} · {{ task.album || '未知专辑' }}</span>
            <span>{{ sourceLabel(task) }}</span>
            <span>{{ qualityLabel(task.quality) }}</span>
            <span>{{ relativeTime(task.updatedAt) }}</span>
          </div>

          <ol class="download-queue-row__stages" :aria-label="`${task.songName} 当前流程`">
            <li v-for="stage in songStages(task)" :key="stage.key" :class="`is-${stage.state}`">
              {{ stage.label }}
            </li>
          </ol>

          <div
            v-if="task.status === 'downloading' || task.status === 'tagging'"
            class="download-queue-progress"
            role="progressbar"
            :aria-label="`${task.songName} ${taskLabel(task)}进度`"
            :aria-valuenow="normalizedProgress(task.progress)"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <div :style="{ width: `${normalizedProgress(task.progress)}%` }" />
          </div>
        </div>

        <div class="download-queue-row__side">
          <strong v-if="task.status === 'downloading' || task.status === 'tagging'">{{ normalizedProgress(task.progress) }}%</strong>
          <span v-else-if="task.status === 'done'">{{ downstreamLabel }}</span>
          <span v-else>等待中</span>
        </div>
      </article>
    </div>

    <div v-else class="download-queue-empty">
      <span><AppIcon name="archive" :size="22" /></span>
      <strong>{{ emptyTitle }}</strong>
      <p>{{ emptyDescription }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { TaskRunSummary, TaskRunType } from '~~/server/lib/job/types'
import type { DownloadTask, QueueStatus } from '~~/server/lib/download/queue'
import type { SyncState } from '~~/server/lib/log/types'
import {
  buildFlowStages,
  buildQueueMetrics,
  buildSongFlowStages,
  isSyncLikeRun,
  normalizeProgress,
  sortLiveTasks,
  taskProgressSummary,
  taskStatusLabel,
} from '~~/lib/task-center-download-presentation'
import {
  formatManualRelativeTime,
  manualDownloadStatusTone,
  manualQualityLabel,
} from '~~/composables/useManualDownloadPresentation'

const props = defineProps<{
  status: QueueStatus
  liveTasks: DownloadTask[]
  loading: boolean
  error?: string
  syncState?: SyncState | null
  activeRun?: TaskRunSummary | null
}>()

defineEmits<{
  refresh: []
}>()

const resolvedRunType = computed<TaskRunType | null>(() => {
  if (props.activeRun?.type) return props.activeRun.type
  return props.syncState?.isRunning ? 'sync' : null
})
const syncLikeRun = computed(() => isSyncLikeRun(resolvedRunType.value))
const flowStages = computed(() => buildFlowStages({
  runType: resolvedRunType.value,
  currentStage: props.syncState?.currentStage,
}))
const metrics = computed(() => buildQueueMetrics(props.status, resolvedRunType.value))
const visibleTasks = computed(() => sortLiveTasks(props.liveTasks))
const showRunProgress = computed(() => Boolean(props.syncState?.progress?.total))
const runProgressPercent = computed(() => {
  const progress = props.syncState?.progress
  if (!progress?.total) return 0
  return Math.min(100, Math.max(0, Math.round((progress.current / progress.total) * 100)))
})
const progressLabel = computed(() => {
  const progress = props.syncState?.progress
  if (!progress?.total) return '等待进度数据'
  return `${progress.current} / ${progress.total}`
})
const downstreamLabel = computed(() => syncLikeRun.value ? '进入 Plex 阶段' : '已完成')
const panelDescription = computed(() => {
  if (syncLikeRun.value) return '不再区分执行中和等待中，直接查看歌曲当前所在阶段，以及后续 Plex 流程推进到哪里。'
  return '查看当前歌曲从下载到写入完成的处理进度。'
})
const stageBadge = computed(() => {
  if (!props.activeRun && !props.syncState?.isRunning) return '暂无运行'
  if (props.syncState?.currentStage === 'refreshing_plex') return 'Plex 识别中'
  if (props.syncState?.currentStage === 'updating_plex_playlist' || props.syncState?.currentStage === 'reorder') return '歌单更新中'
  if (props.syncState?.currentStage === 'processing_tags') return '标签处理中'
  if (props.syncState?.currentStage === 'downloading') return '下载进行中'
  return syncLikeRun.value ? '准备后续流程' : '批次进行中'
})
const stageBadgeTone = computed(() => {
  if (!props.activeRun && !props.syncState?.isRunning) return 'idle'
  if (props.syncState?.currentStage === 'refreshing_plex' || props.syncState?.currentStage === 'updating_plex_playlist' || props.syncState?.currentStage === 'reorder') return 'success'
  return 'running'
})
const stageHeadline = computed(() => {
  if (!props.activeRun && !props.syncState?.isRunning) return '当前没有需要追踪的歌曲'
  if (props.syncState?.currentStage === 'refreshing_plex') return '下载前置已经结束，正在等待 Plex 扫描和识别'
  if (props.syncState?.currentStage === 'updating_plex_playlist' || props.syncState?.currentStage === 'reorder') return 'Plex 已经接到歌曲，正在更新歌单成员和顺序'
  if (props.syncState?.currentStage === 'processing_tags') return '歌曲文件已经落盘，正在写入元数据'
  if (props.syncState?.currentStage === 'downloading') return '当前重点是把歌曲下载到本地'
  return syncLikeRun.value ? '本轮歌曲会继续流向 Plex 后续步骤' : '当前批次正在处理歌曲文件'
})
const stageDescription = computed(() => {
  if (!props.activeRun && !props.syncState?.isRunning) return '同步或手动下载启动后，这里会直接显示歌曲和整轮流程的实时进度。'
  if (props.syncState?.currentSong) return `当前项目：${props.syncState.currentSong}`
  if (props.activeRun?.summary) return props.activeRun.summary
  return panelDescription.value
})
const emptyTitle = computed(() => {
  if (props.syncState?.isRunning) return '歌曲前置处理暂时空闲'
  return '当前没有正在追踪的歌曲'
})
const emptyDescription = computed(() => {
  if (props.syncState?.currentStage === 'refreshing_plex' || props.syncState?.currentStage === 'updating_plex_playlist' || props.syncState?.currentStage === 'reorder') {
    return '下载和标签写入已经完成，当前这一轮正在推进 Plex 后续步骤。'
  }
  if (props.syncState?.isRunning) return '本轮还在准备歌曲队列，或者刚刚完成当前批次的文件处理。'
  return '新的同步或手动下载开始后，这里会自动出现具体歌曲和阶段进度。'
})

function songStages(task: DownloadTask) {
  return buildSongFlowStages({
    task,
    runType: resolvedRunType.value,
    currentStage: props.syncState?.currentStage,
  })
}
function taskLabel(task: DownloadTask) {
  return taskStatusLabel(task, resolvedRunType.value)
}
function taskSummary(task: DownloadTask) {
  return taskProgressSummary({
    task,
    runType: resolvedRunType.value,
    currentStage: props.syncState?.currentStage,
  })
}
function rowTone(task: DownloadTask) {
  if (task.status === 'done') return 'success'
  return manualDownloadStatusTone(task.status)
}
function rowIcon(task: DownloadTask) {
  if (task.status === 'done') return syncLikeRun.value ? 'sync' : 'checkCircle'
  if (task.status === 'tagging') return 'edit'
  if (task.status === 'pending') return 'clock'
  return 'download'
}
function flowStageIcon(state: 'complete' | 'current' | 'upcoming') {
  if (state === 'complete') return 'checkCircle'
  if (state === 'current') return 'loader'
  return 'minus'
}
function sourceLabel(task: DownloadTask) {
  return task.sourceName || (task.sourceId ? '同步源' : '手动下载')
}
function qualityLabel(quality?: string) {
  return manualQualityLabel(quality)
}
function relativeTime(value: string) {
  return formatManualRelativeTime(value)
}
function normalizedProgress(value: number) {
  return normalizeProgress(value)
}
</script>

<style scoped>
@import '~/assets/css/pages/task-center-download-queue.css';
</style>
