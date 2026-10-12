<script setup lang="ts">
import { scoreReason } from '../../shared/score-labels'
import { DEFAULT_INITIALIZATION_MATCHING } from '../../shared/initialization-matching'
import type { QuickPlanItem, QuickPreview } from '../../shared/quick-initialization'
import type { SourceInitializationSummary } from '../../composables/useSourceInitialization'

const props = defineProps<{
  visible: boolean
  sourceId: string
  initialization: SourceInitializationSummary
  busy?: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{ changed: []; close: []; requestCommit: [] }>()

const api = useApi()
const defaultThreshold = props.initialization.quickThreshold ?? props.initialization.matchingConfig?.config.quickMatchThreshold ?? DEFAULT_INITIALIZATION_MATCHING.quickMatchThreshold
const threshold = ref<number | string>(defaultThreshold)
const preview = ref<QuickPreview | null>(null)
const saved = ref<{ operationId: string; token: string } | null>(props.initialization.savedQuickOperation ?? null)
const loading = ref(false)
const paging = ref(false)
const confirming = ref(false)
const restoring = ref(false)
const quickItems = ref<HTMLElement | null>(null)
const error = ref('')
const notice = ref('')

/** Quick previews only exist for score version 1 drafts; anything older needs a reanalysis. */
const scoreReady = computed(() => props.initialization.scoreVersion === 1 && Number.isInteger(props.initialization.revision))
const queued = computed(() => props.initialization.quickStatus === 'queued')
const blocked = computed(() => Boolean(props.disabled) || queued.value || Boolean(props.busy) || confirming.value || restoring.value)
const thresholdValid = computed(() => Number.isInteger(threshold.value) && Number(threshold.value) >= 0 && Number(threshold.value) <= 100)
const canPreview = computed(() => !blocked.value && scoreReady.value && thresholdValid.value)
const canConfirm = computed(() => Boolean(preview.value) && canPreview.value && !loading.value && !paging.value)
const totalPages = computed(() => preview.value ? Math.max(1, Math.ceil(preview.value.total / preview.value.pageSize)) : 1)
const maxBucket = computed(() => Math.max(1, ...(preview.value?.histogram ?? [])))
const metrics = computed(() => {
  const counts = preview.value?.counts
  if (!counts) return []
  return [
    { label: '保留现有绑定', value: counts.preserved },
    { label: '采用 Plex', value: counts.matched },
    { label: '计划下载', value: counts.downloads },
    { label: '共享媒体组', value: counts.shared },
    { label: '覆盖决定', value: counts.overwritten },
  ]
})
const histogramLabel = computed(() => (preview.value?.histogram ?? []).map((count, index) => `${index * 10}-${index === 9 ? 100 : index * 10 + 9} 分：${count} 首`).join('；'))

const decisionLabels: Record<QuickPlanItem['decision'], string> = { preserve: '保留现有绑定', adopt: '采用 Plex', download: '计划下载' }
const originLabels: Record<QuickPlanItem['origin'], string> = { preserved: '已有绑定', rule_recommended: '规则推荐', threshold_match: '达到分数线', threshold_download: '未达到分数线' }

function message(value: unknown, fallback: string): string {
  return value instanceof Error ? value.message : fallback
}

function bucketHeight(count: number): number {
  return count === 0 ? 0 : Math.max(8, Math.round((count / maxBucket.value) * 100))
}

function decisionLabel(item: QuickPlanItem): string {
  return decisionLabels[item.decision]
}

function originLabel(item: QuickPlanItem): string {
  return originLabels[item.origin]
}

function tierClass(item: QuickPlanItem): string {
  if (item.decision === 'adopt') return 'source-adoption__tier--strong_id'
  return item.decision === 'download' ? 'source-adoption__tier--possible' : 'source-adoption__tier--preserved'
}

watch(() => props.initialization.savedQuickOperation, value => { saved.value = value ?? null })

watch(threshold, () => {
  if (!preview.value) return
  preview.value = null
  error.value = ''
  notice.value = '分数线已修改，旧预览已失效；请按当前分数线重新生成预览。'
})

watch(() => props.initialization.revision, revision => {
  if (preview.value && preview.value.revision !== revision) preview.value = null
})

watch(() => props.initialization.id, () => {
  threshold.value = props.initialization.quickThreshold ?? props.initialization.matchingConfig?.config.quickMatchThreshold ?? DEFAULT_INITIALIZATION_MATCHING.quickMatchThreshold
  preview.value = null
  saved.value = null
  error.value = ''
  notice.value = ''
})

async function previewPlan(): Promise<void> {
  if (!canPreview.value || loading.value) return
  loading.value = true
  error.value = ''
  notice.value = ''
  try {
    preview.value = await api.post<QuickPreview>(`/playlist-sources/${props.sourceId}/initialization/quick-preview`, {
      initializationId: props.initialization.id,
      revision: props.initialization.revision,
      threshold: Number(threshold.value),
    })
  } catch (value) {
    error.value = message(value, '生成快速预览失败')
  } finally {
    loading.value = false
  }
}

async function loadPreviewPage(target: number): Promise<void> {
  const current = preview.value
  if (!current || paging.value) return
  const next = Math.min(Math.max(1, Math.trunc(target)), totalPages.value)
  if (next === current.page) return
  paging.value = true
  error.value = ''
  try {
    const data = await api.get<QuickPreview>(`/playlist-sources/${props.sourceId}/initialization/quick-preview`, {
      operationId: current.operationId,
      token: current.token,
      page: String(next),
    })
    if (preview.value?.operationId === current.operationId) {
      preview.value = data
      await nextTick()
      quickItems.value?.scrollIntoView({ block: 'start' })
    }
  } catch (value) {
    // Keep the rendered preview so the failure stays recoverable without regenerating it.
    error.value = message(value, '预览分页加载失败')
  } finally {
    paging.value = false
  }
}

async function confirmPlan(start: boolean): Promise<void> {
  const current = preview.value
  if (!current || !canConfirm.value || confirming.value) return
  confirming.value = true
  error.value = ''
  notice.value = ''
  try {
    const result = await api.post<{ operationId: string; requestId: string | null; status: 'queued' | 'saved' }>(`/playlist-sources/${props.sourceId}/initialization/quick-confirm`, {
      operationId: current.operationId,
      token: current.token,
      start,
    })
    if (result.status === 'queued') notice.value = '快速方案已提交并排队，后台会按预览结果处理；处理前不能继续编辑本草案。'
    else {
      saved.value = { operationId: current.operationId, token: current.token }
      notice.value = '草案已保存，尚未启动处理；未再次编辑时可以恢复此前草案。'
    }
    emit('changed')
  } catch (value) {
    error.value = message(value, start ? '提交快速方案失败' : '保存快速方案失败')
  } finally {
    confirming.value = false
  }
}

async function restorePlan(): Promise<void> {
  const current = saved.value
  if (!current || restoring.value) return
  restoring.value = true
  error.value = ''
  notice.value = ''
  try {
    await api.post(`/playlist-sources/${props.sourceId}/initialization/quick-restore`, { operationId: current.operationId, token: current.token })
    saved.value = null
    preview.value = null
    notice.value = '已恢复此前草案。'
    emit('changed')
  } catch (value) {
    error.value = message(value, '恢复此前草案失败')
  } finally {
    restoring.value = false
  }
}
async function cancelQueued(): Promise<void> {
  confirming.value = true
  error.value = ''
  try {
    await api.post(`/playlist-sources/${props.sourceId}/initialization/quick-cancel`, {initializationId:props.initialization.id})
    notice.value = '已请求取消，草案决定保留；已执行的外部操作不会回滚。'
    emit('changed')
  } catch (value) { error.value = message(value, '取消失败') }
  finally { confirming.value = false }
}
</script>

<template>
  <AppDrawer :visible="visible" title="快速方案" wide :busy="confirming || restoring || loading || !!busy" @close="emit('close')">
  <section class="source-adoption__quick" aria-label="快速方案内容">
    <header class="source-adoption__quick-head">
      <div>
        <h2>快速方案</h2>
        <p>按分数线一次性采用达标的 Plex 候选，未达标的歌曲留在下载计划；确认后覆盖本草案的全部未提交决定。</p>
      </div>
      <div v-if="queued"><StatusBadge status="running" label="已排队" /><button class="btn btn-secondary btn-sm" :disabled="confirming" @click="cancelQueued">取消本次处理</button></div>
      <StatusBadge v-else-if="saved" status="warning" label="草案已保存" />
    </header>

    <div class="source-adoption__quick-controls">
      <label class="source-adoption__quick-threshold">
        <span>分数线（0–100 整数）</span>
        <input v-model.number="threshold" class="form-input" type="number" min="0" max="100" step="1" inputmode="numeric" :disabled="blocked || !scoreReady" />
      </label>
      <button class="btn btn-primary btn-sm" :disabled="!canPreview || loading" @click="previewPlan">
        <AppIcon name="search" :size="14" />{{ loading ? '正在生成预览' : preview ? '按当前分数线重新预览' : '生成快速预览' }}
      </button>
      <span v-if="preview" class="source-adoption__quick-meta">预览分数线 {{ preview.threshold }} · 共 {{ preview.total }} 首 · 第 {{ preview.page }} / {{ totalPages }} 页</span>
    </div>

    <p v-if="!scoreReady" class="source-adoption__quick-hint" role="status">当前草案没有评分版本 1 的候选分数，需要重新分析后才能生成快速预览。</p>
    <p v-else-if="queued" class="source-adoption__quick-hint" role="status">快速方案已提交，正在等待后台处理；完成前不能编辑或重新预览。</p>
    <p v-else-if="!thresholdValid" class="source-adoption__quick-hint" role="alert">分数线必须是 0–100 的整数。</p>
    <p v-else-if="blocked" class="source-adoption__quick-hint" role="status">当前草案不可编辑；重新分析后再使用快速方案。</p>
    <p v-else-if="!preview && !saved" class="source-adoption__quick-hint" role="status">先点上方“生成快速预览”查看当前分数线的处理结果；确认按钮会出现在面板底部。</p>




    <template v-if="preview">
      <div class="source-adoption__quick-counts">
        <div v-for="metric in metrics" :key="metric.label"><span>{{ metric.label }}</span><strong>{{ metric.value }}</strong></div>
      </div>

      <div class="source-adoption__quick-histogram" role="img" :aria-label="histogramLabel">
        <div v-for="(count, index) in preview.histogram" :key="index" class="source-adoption__quick-bucket">
          <strong>{{ count }}</strong>
          <span class="source-adoption__quick-track"><i :style="{ height: `${bucketHeight(count)}%` }" /></span>
          <small>{{ index * 10 }}</small>
        </div>
      </div>

      <ul ref="quickItems" class="source-adoption__quick-items">
        <li v-for="item in preview.items" :key="item.songId">
          <div class="source-adoption__quick-item-head">
            <strong>{{ item.title || `歌曲 #${item.songId}` }}</strong>
            <span class="source-adoption__score">{{ item.score === null ? '未评分' : `${item.score.toFixed(1)} 分` }}</span>
          </div>
          <p class="source-adoption__quick-item-meta"><span class="source-adoption__tier" :class="tierClass(item)">{{ decisionLabel(item) }}</span><span>{{ originLabel(item) }} · #{{ item.songId }}</span></p>
          <p v-if="item.sharedIds.length > 1" class="source-adoption__quick-risk">共享组 #{{ item.sharedIds.join('、#') }}：整组一并授权，各自保留网易云 ID 与歌单条目。</p>
          <p v-for="risk in item.risks" :key="risk" class="source-adoption__quick-risk">{{ scoreReason(risk) }}</p>
        </li>
      </ul>
      <div v-if="!preview.items.length" class="p-8 text-center text-muted">本次预览没有歌曲。</div>

      <PageNavigator :page="preview.page" :page-size="preview.pageSize" :total="preview.total" label="快速预览" :loading="paging" @change="loadPreviewPage" />

    </template>
  </section>
  <template #footer>
    <p v-if="error" class="source-adoption__error" role="alert">{{ error }}</p>
    <p v-if="notice" class="source-adoption__quick-notice" role="status">{{ notice }}</p>
    <template v-if="preview">
      <div class="source-adoption__quick-warning" role="note">
        <strong>确认后覆盖全部未提交决定</strong>
        <details><summary>查看覆盖范围与处理说明</summary><ul>
          <li>包括手动设置的使用 Plex、下载并托管与暂缓：本草案所有未提交选择都会按这次预览重写。</li>
          <li>来源即使已禁用，本次仍会启动一次处理；只影响本次运行，不改变来源启用状态。</li>
          <li>共用同一媒体的歌曲整组一并授权，各自保留网易云 ID 与歌单条目。</li>
        </ul></details>
      </div>

      <div v-if="!saved" class="source-adoption__quick-actions">
        <button class="btn btn-primary" :disabled="!canConfirm || confirming || blocked" @click="confirmPlan(true)">确认并启动处理</button>
        <button class="btn btn-secondary" :disabled="!canConfirm || confirming || blocked" @click="confirmPlan(false)">仅保存草案</button>
      </div>
    </template>

    <div v-if="saved" class="source-adoption__quick-actions">
      <p>草案还没有执行。提交后开始接管和后续同步；未再次编辑时，也可以恢复保存前的决定。</p>
      <button class="btn btn-primary" :disabled="blocked" @click="emit('requestCommit')">提交并启动处理</button>
      <button class="btn btn-secondary btn-sm" :disabled="restoring || busy || queued" @click="restorePlan">恢复此前草案</button>
    </div>
  </template>
  </AppDrawer>
</template>

<style scoped>
@import '~/assets/css/components/source-initialization-shared.css';
.source-adoption__quick { display: grid; gap: var(--space-3); padding: var(--space-4); min-width: 0; }
.source-adoption__quick-head { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: var(--space-3); }
.source-adoption__quick-head h2 { margin: var(--space-0_5) 0; }
.source-adoption__quick-head p { color: var(--text-tertiary); font-size: var(--text-xs); }
.source-adoption__quick-controls { display: flex; align-items: flex-end; flex-wrap: wrap; gap: var(--space-3); }
.source-adoption__quick-threshold { display: grid; gap: var(--space-1); color: var(--text-secondary); font-size: var(--text-xs); }
.source-adoption__quick-threshold .form-input { width: 8rem; }
.source-adoption__quick-meta { color: var(--text-tertiary); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
.source-adoption__quick-hint { color: var(--text-secondary); font-size: var(--text-xs); }
.source-adoption__quick-notice { color: var(--success); font-size: var(--text-xs); }
.source-adoption__quick-counts { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-5); font-size: var(--text-xs); }
.source-adoption__quick-counts span { color: var(--text-secondary); }
.source-adoption__quick-counts strong { color: var(--text-primary); font-variant-numeric: tabular-nums; }
.source-adoption__quick-histogram { display: flex; align-items: flex-end; gap: var(--space-1); min-width: 0; }
.source-adoption__quick-bucket { display: grid; flex: 1 1 0; justify-items: center; gap: var(--space-1); min-width: 0; color: var(--text-tertiary); font-size: var(--text-xs); }
.source-adoption__quick-bucket strong { font-variant-numeric: tabular-nums; }
.source-adoption__quick-track { display: flex; align-items: flex-end; width: 100%; height: 3.5rem; border-radius: var(--radius-xs); background: var(--bg-app); }
.source-adoption__quick-track i { display: block; width: 100%; border-radius: var(--radius-xs) var(--radius-xs) 0 0; background: var(--accent-muted); }
.source-adoption__quick-items { display: grid; gap: var(--space-2); margin: 0; padding: 0; list-style: none; min-width: 0; }
.source-adoption__quick-items li { min-width: 0; padding: var(--space-2) var(--space-3); border: 1px solid var(--border-primary); border-radius: var(--radius-md); background: var(--bg-surface); }
.source-adoption__quick-item-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); min-width: 0; }
.source-adoption__quick-item-head strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-sm); }
.source-adoption__score { display: inline-flex; width: max-content; flex: 0 0 auto; padding: var(--space-0_5) var(--space-2); border-radius: var(--radius-full); background: var(--accent-muted); color: var(--accent); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
.source-adoption__quick-item-meta { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-1) var(--space-2); margin-top: var(--space-1); }
.source-adoption__quick-item-meta span:not(.source-adoption__tier) { color: var(--text-tertiary); font-size: var(--text-xs); }
.source-adoption__quick-risk { margin-top: var(--space-1); color: var(--warning); font-size: var(--text-xs); overflow-wrap: anywhere; }
.source-adoption__quick-warning { padding: var(--space-3); border: 1px solid var(--warning-border); border-radius: var(--radius-md); background: var(--warning-soft); font-size: var(--text-xs); }
.source-adoption__quick-warning strong { color: var(--warning); }
.source-adoption__quick-warning ul { margin: var(--space-1) 0 0; padding-left: var(--space-4); color: var(--text-secondary); }
.source-adoption__quick-actions { margin-top: var(--space-3); display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
.source-adoption__quick-actions p { flex: 1 1 12rem; color: var(--text-tertiary); font-size: var(--text-xs); }
@media (max-width: 640px) {
  .source-adoption__quick { padding: var(--space-3); }
  .source-adoption__quick-controls { align-items: stretch; }
  .source-adoption__quick-threshold { flex: 1 1 100%; }
  .source-adoption__quick-threshold .form-input { width: 100%; }
  .source-adoption__quick-controls .btn { flex: 1 1 100%; justify-content: center; }
  .source-adoption__quick-meta { overflow-wrap: anywhere; }
  .source-adoption__quick-actions .btn { flex: 1 1 100%; justify-content: center; }
}
</style>
