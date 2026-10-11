<template>
  <article class="activity-run" :class="`activity-run--${state}`">
    <header class="activity-run__header">
      <span class="activity-run__icon"><AppIcon :name="runTypeIcon(run.type)" :size="20" /></span>
      <div class="activity-run__identity">
        <div class="activity-run__metadata"><span>{{ runTypeLabel(run.type) }}</span><span>{{ runTriggerLabel(run.trigger) }}</span><span v-if="run.dryRun">预演</span></div>
        <h3>{{ title }}</h3>
      </div>
      <StatusBadge :status="state === 'waiting' ? 'warning' : state === 'queued' ? 'idle' : 'running'" :label="state === 'waiting' ? '等待确认' : state === 'queued' ? '等待执行' : '运行中'" size="sm" />
    </header>

    <div class="activity-run__content">
      <p class="activity-run__stage" :aria-live="state === 'waiting' ? 'off' : 'polite'">{{ activityStage(run) }}</p>
      <p v-if="state === 'waiting' || run.type === 'source_initialization'" class="activity-run__summary">{{ runSummaryLabel(run.summary) }}</p>
      <template v-if="state !== 'waiting'">
        <ol v-if="phases.length" class="activity-run__phases" aria-label="当前同步阶段">
          <li v-for="phase in phases" :key="phase.label" :aria-current="phase.current ? 'step' : undefined">{{ phase.label }}</li>
        </ol>
        <p v-if="run.live?.currentSong" class="activity-run__summary">当前歌曲：{{ run.live.currentSong }}</p>
        <div v-if="progress" class="activity-run__progress">
          <span>当前阶段已处理 {{ progress.current }} / {{ progress.total }}</span>
          <progress :value="progress.current" :max="progress.total" aria-label="当前阶段处理进度" />
        </div>
        <template v-if="run.files && run.files.counts.total > 0">
          <dl class="activity-run__counts" aria-label="本次运行的文件任务统计">
            <div v-for="metric in metrics" :key="metric.label" :class="{ 'text-danger': metric.label === '失败' }"><dt>{{ metric.label }}</dt><dd>{{ metric.count }}</dd></div>
          </dl>
          <ul v-if="files.items.value.length" class="activity-song-list" aria-label="当前文件任务">
            <li v-for="task in files.items.value" :key="task.id" class="activity-song">
              <AppIcon :name="task.status === 'pending' ? 'clock' : task.status === 'tagging' ? 'edit' : 'download'" :size="16" />
              <div class="activity-song__identity"><strong>{{ task.songName }}</strong><span>{{ task.artist || '未知艺人' }}</span></div>
              <span class="activity-song__state">{{ task.status === 'pending' ? task.nextAttemptAt ? '等待重试' : run.files?.paused ? '已暂停' : '等待下载' : task.status === 'tagging' ? '写入标签' : '下载中' }}</span>
              <div v-if="task.status !== 'pending'" class="activity-song__progress"><progress :value="task.progress < 0 ? undefined : percent(task.progress)" max="100" :aria-label="`${task.songName} 文件处理进度`" /><span>{{ task.progress < 0 ? '传输中' : `${percent(task.progress)}%` }}</span></div>
            </li>
          </ul>
          <div v-if="files.total.value > files.items.value.length || files.limit.value > 6" class="activity-run__list-actions">
            <span>已显示 {{ files.items.value.length }} / {{ files.total.value }} 项</span>
            <button v-if="files.total.value > files.items.value.length" class="btn btn-secondary btn-sm" :disabled="files.loading.value || stale" @click="files.loadMore">{{ files.loading.value ? '读取中…' : '显示更多歌曲' }}</button>
            <button v-if="files.limit.value > 6" class="btn btn-secondary btn-sm" @click="files.collapse">收起</button>
          </div>
          <p v-if="files.error.value" class="activity-run__file-note" role="alert">歌曲列表更新失败：{{ files.error.value }}<button class="btn btn-secondary btn-sm" :disabled="files.loading.value" @click="files.retry">重试</button></p>
          <p v-if="run.files.counts.failed" class="activity-run__file-note">有文件处理失败，可在运行详情查看原因。</p>
          <p v-if="run.files.paused" class="activity-run__file-note" role="status">本次下载已暂停领取新任务；其他运行共用的文件仍可继续处理。</p>
        </template>
      </template>
    </div>

    <footer class="activity-run__footer">
      <span v-if="state === 'waiting'">分析耗时 {{ formatRunDuration(run.durationMs) }}</span>
      <span v-else-if="state === 'queued'">提交于 {{ new Date(run.startedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }}</span>
      <span v-else>已运行 {{ formatRunDuration(Math.max(0, now - Date.parse(run.startedAt))) }}</span>
      <div class="activity-run__actions">
        <NuxtLink v-if="state === 'waiting' && run.type === 'source_initialization'" :to="activityPlanLink(run)" class="btn btn-primary btn-sm">查看接管方案<AppIcon name="chevronRight" :size="14" /></NuxtLink>
        <NuxtLink :to="detailLink" class="btn btn-secondary btn-sm">运行详情</NuxtLink>
        <button v-if="run.files && run.files.counts.pending + run.files.counts.downloading + run.files.counts.tagging > 0" class="btn btn-secondary btn-sm" :disabled="controlling || stale" @click="toggleDownloads">{{ controlling ? '处理中…' : run.files.paused ? '继续下载' : '暂停下载' }}</button>
        <button v-if="run.live && run.type === 'sync'" class="btn btn-ghost btn-sm" :disabled="cancelling || stale" title="取消当前同步批次，包含同批次尚未执行的来源" @click="$emit('cancel', run.id)">取消本批同步</button>
      </div>
    </footer>
  </article>
</template>

<script setup lang="ts">
import type { ActivityRun } from '~~/shared/activity'
import { useActivityFiles } from '~~/composables/useActivityFiles'
import { useFeedback } from '~~/composables/useFeedback'
import { activityPhases, activityPlanLink, activityStage, activityState } from '~~/lib/activity-presentation'
import { formatRunDuration, runSummaryLabel, runTriggerLabel, runTypeIcon, runTypeLabel } from '~~/lib/run-presentation'
const props = defineProps<{ run: ActivityRun; now: number; cancelling: boolean; stale: boolean }>()
const emit = defineEmits<{ cancel: [id: string]; refresh: [] }>()
const api = useApi()
const feedback = useFeedback()
const controlling = ref(false)
async function toggleDownloads() {
  if (controlling.value) return
  controlling.value = true
  try {
    const action = props.run.files?.paused ? 'resume' : 'pause'
    await api.post(`/runs/${props.run.id}/downloads-control`, { action })
    feedback.success(action === 'pause' ? '已暂停领取新任务，当前文件处理完成后停止' : '已继续下载')
    emit('refresh')
  } catch (error) { feedback.error('操作失败', error instanceof Error ? error.message : '请稍后重试') }
  finally { controlling.value = false }
}
const files = useActivityFiles(() => props.run)
const state = computed(() => activityState(props.run))
const title = computed(() => props.run.sourceNames.join('、') || props.run.source || runTypeLabel(props.run.type))
const phases = computed(() => activityPhases(props.run))
const detailLink = computed(() => `/task-center/runs/${props.run.id}`)
const progress = computed(() => {
  const value = props.run.live?.progress
  return value && value.total > 0 ? { current: Math.max(0, Math.min(value.current, value.total)), total: value.total } : null
})
const metrics = computed(() => {
  const counts = props.run.files?.counts
  if (!counts) return []
  return [
    { label: '下载中', count: counts.downloading }, { label: '写标签', count: counts.tagging },
    { label: '等待', count: counts.pending }, { label: '文件完成', count: counts.done },
    { label: '失败', count: counts.failed },
  ].filter(item => item.count > 0)
})
function percent(value: number) { return Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : 0 }
</script>

<style scoped>
@import '~/assets/css/components/activity-run.css';
</style>
