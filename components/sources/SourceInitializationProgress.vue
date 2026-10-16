<script setup lang="ts">
import type { InitializationProcessing } from '../../shared/source-onboarding'
import type { SourceInitializationSummary } from '../../composables/useSourceInitialization'
const props = defineProps<{ initialization: SourceInitializationSummary; processing: InitializationProcessing | null }>()
const emit = defineEmits<{ review: [] }>()
const heading = computed(() => {
  const progress = props.processing
  if (progress?.active) return progress.status === 'running' ? progress.stage : '已安排，等待后台处理'
  if (progress?.status === 'success') return `Plex 已同步 ${progress.synced} / ${progress.total} 首`
  if (progress?.status === 'partial') return `Plex 已同步 ${progress.synced} / ${progress.total} 首，${progress.remaining} 首未同步`
  if (progress?.status === 'failed') return '本次处理未完成'
  if (progress?.status === 'cancelled') return '本次处理已取消'
  if (props.initialization.status === 'analyzing') return '正在查找可以复用的 Plex 音乐'
  if (props.initialization.status === 'awaiting_review') return '歌曲已安排好，可以开始下载和同步'
  if (props.initialization.status === 'completed') return '歌曲安排已应用'
  return '已添加，正在准备歌单'
})
const tone = computed(() => !props.processing || props.processing.active ? 'running' : props.processing.status === 'success' ? 'ok' : 'warning')
const busy = computed(() => Boolean(props.processing?.active) || ['pending', 'analyzing', 'applying'].includes(props.initialization.status))
const detail = computed(() => {
  if (props.processing?.active) return '任务会在后台继续。下载完成后，自动等待 Plex 入库并更新歌单。'
  if (props.processing?.status === 'success') return '本次目标歌曲均已完成同步，可以到 Plex 播放。'
  if (props.processing) return '尚未同步的歌曲可以在处理结果中查看原因并重试；也可以在“歌曲与媒体”调整匹配。'
  if (props.initialization.status === 'completed') return '可在“歌曲与媒体”查看当前匹配和同步状态。'
  return props.initialization.autoProcess ? '系统将自动采用最高分的可用候选，其余尝试下载，然后更新 Plex 歌单。' : '系统已按最高分安排可用候选，其余尝试下载。你可以直接开始，或展开列表调整。'
})
const phases = ['分析现有音乐', '复用或下载', '等待 Plex 入库', '更新歌单']
const phaseIndex = computed(() => {
  if (!props.processing) return 0
  if (!props.processing.active) return props.processing.status === 'success' ? 4 : -1
  if (props.processing.stage.includes('扫描') || props.processing.stage.includes('索引')) return 2
  if (props.processing.stage.includes('歌单') || props.processing.stage.includes('重排')) return 3
  return 1
})
</script>

<template>
  <section class="section-card initialization-progress" :data-tone="tone" aria-live="polite" aria-label="首次同步进度">
    <header><AppIcon :name="tone === 'ok' ? 'checkCircle' : tone === 'warning' ? 'warn' : busy ? 'loader' : 'info'" :size="22" :class="busy ? 'animate-spin' : ''" /><div><h3>{{ heading }}</h3><p>{{ detail }}</p></div></header>
    <ol><li v-for="(phase, index) in phases" :key="phase" :class="{ 'is-current': index === phaseIndex, 'is-done': index < phaseIndex }"><span>{{ index + 1 }}</span>{{ phase }}</li></ol>
    <p class="initialization-progress__counts">继续使用 {{ initialization.preservedItems }} 首 · 选用 Plex {{ initialization.adoptItems }} 首 · 计划下载 {{ initialization.downloadItems }} 首<span v-if="initialization.deferredItems"> · 暂不加入 {{ initialization.deferredItems }} 首</span></p>
    <p v-if="processing?.error" class="text-danger" role="alert">{{ processing.error }}</p>
    <div v-if="processing?.runId" class="initialization-progress__actions"><NuxtLink :to="`/task-center/runs/${processing.runId}`" class="btn btn-secondary btn-sm">{{ processing.active ? '查看实时运行' : '查看处理结果' }}</NuxtLink><button v-if="!processing.active && processing.remaining" class="btn btn-ghost btn-sm" @click="emit('review')">查看未同步歌曲</button></div>
    <button v-else-if="initialization.status === 'completed'" class="btn btn-ghost btn-sm" @click="emit('review')">查看歌曲与媒体</button>
  </section>
</template>

<style scoped>
.initialization-progress{display:grid;gap:var(--space-4);padding:var(--space-5);border-color:var(--accent)}.initialization-progress header{display:flex;align-items:flex-start;gap:var(--space-3)}.initialization-progress header>svg{flex:none;color:var(--accent);margin-top:var(--space-1)}.initialization-progress h3{margin:0}.initialization-progress p{margin:var(--space-1) 0 0;color:var(--text-secondary);font-size:var(--text-sm);line-height:var(--body-leading)}.initialization-progress ol{display:flex;flex-wrap:wrap;gap:var(--space-3) var(--space-5);padding:0;margin:0;list-style:none}.initialization-progress li{display:flex;align-items:center;gap:var(--space-2);color:var(--text-tertiary);font-size:var(--text-sm)}.initialization-progress li span{display:grid;place-items:center;width:1.5rem;height:1.5rem;border-radius:var(--radius-full);background:var(--bg-input)}.initialization-progress li.is-current{color:var(--accent)}.initialization-progress li.is-done{color:var(--success)}.initialization-progress__actions{display:flex;flex-wrap:wrap;gap:var(--space-2)}.initialization-progress[data-tone='ok']{border-color:var(--success)}.initialization-progress[data-tone='warning']{border-color:var(--warning)}
</style>
