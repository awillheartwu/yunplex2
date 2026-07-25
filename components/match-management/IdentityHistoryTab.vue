<template>
  <section class="history-tab space-y-4" :aria-busy="loading">
    <div class="section-card history-toolbar">
      <label>
        <span>歌单来源</span>
        <select v-model="sourceId" class="form-input" @change="applySource">
          <option value="">全部歌单</option>
          <option v-for="source in sources" :key="source.id" :value="source.id">{{ source.name }}</option>
        </select>
      </label>
      <label>
        <span>操作者</span>
        <select v-model="actorType" class="form-input" @change="applyFilters">
          <option value="">全部</option>
          <option value="admin">人工决策</option>
          <option value="system">系统决策</option>
        </select>
      </label>
      <label>
        <span>事件类型</span>
        <select v-model="eventType" class="form-input" @change="applyFilters">
          <option value="">全部身份变化</option>
          <option v-for="option in eventOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </label>
      <label>
        <span>网易云歌曲 ID</span>
        <input v-model="songIdQuery" class="form-input" inputmode="numeric" placeholder="精确查询" @keyup.enter="applyFilters">
      </label>
      <FilterDateRange
        class="history-date-range"
        label="事件日期"
        :model-value="dateRange"
        :min-date="null"
        @update:model-value="applyDateRange"
      />
    </div>

    <div v-if="error" class="section-card history-error" role="alert">
      <span>{{ error }}</span><button class="btn btn-ghost btn-sm" @click="load">重试</button>
    </div>
    <div v-else-if="loading && !result.items.length" class="section-card p-10 text-center text-muted">加载身份决策历史…</div>
    <EmptyState
      v-else-if="!result.items.length"
      title="没有符合条件的身份事件"
      description="身份历史只追加、不撤改。旧决定被修正时，会新增一条覆盖事件。"
    />

    <ol v-else class="history-list" aria-label="身份决策历史">
      <li v-for="event in result.items" :key="event.id" class="section-card history-event">
        <div class="history-marker" :class="`history-marker--${event.actorType}`">
          <AppIcon :name="event.actorType === 'admin' ? 'edit' : 'sync'" :size="14" />
        </div>
        <header>
          <div>
            <p>{{ event.actorType === 'admin' ? '人工' : '系统' }} · 网易云 #{{ event.neteaseSongId }}</p>
            <h2>{{ eventLabel(event.eventType) }}</h2>
          </div>
          <time :datetime="event.createdAt">{{ new Date(event.createdAt).toLocaleString() }}</time>
        </header>
        <div class="history-transition">
          <div>
            <span>变更前</span>
            <strong>{{ bindingTitle(event.previousBinding) }}</strong>
            <small>{{ event.previousBinding?.plexRelativePath || '无绑定' }}</small>
          </div>
          <AppIcon name="arrowRight" :size="16" />
          <div>
            <span>变更后</span>
            <strong>{{ bindingTitle(event.nextBinding) }}</strong>
            <small>{{ event.nextBinding?.plexRelativePath || '无绑定' }}</small>
          </div>
        </div>
        <details>
          <summary>查看证据与来源</summary>
          <dl>
            <div><dt>来源歌单</dt><dd>{{ sourceName(event.sourceId) }}</dd></div>
            <div><dt>Run</dt><dd>{{ event.runId || '无' }}</dd></div>
            <div><dt>审核记录</dt><dd>{{ event.reviewId || '无' }}</dd></div>
          </dl>
          <pre>{{ JSON.stringify(event.evidence, null, 2) }}</pre>
        </details>
      </li>
    </ol>

    <nav v-if="result.total > result.pageSize" class="section-card history-pagination" aria-label="身份历史分页">
      <button class="btn btn-secondary btn-sm" :disabled="result.page <= 1 || loading" @click="goPage(result.page - 1)">上一页</button>
      <span>第 {{ result.page }} / {{ Math.ceil(result.total / result.pageSize) }} 页 · 共 {{ result.total }} 条</span>
      <button class="btn btn-secondary btn-sm" :disabled="result.page >= Math.ceil(result.total / result.pageSize) || loading" @click="goPage(result.page + 1)">下一页</button>
    </nav>
  </section>
</template>

<script setup lang="ts">
import type { SongIdentityEventPage, SongIdentityEventType } from '~~/types/match-management'
import type { SongIdentityBinding } from '~~/types/match-review'

interface SourceOption { id: string; name: string; neteasePlaylistName: string }
const props = defineProps<{ initialSourceId?: string }>()
const emit = defineEmits<{ sourceChange: [value: string] }>()
const api = useApi()
const route = useRoute()
const router = useRouter()
const sources = ref<SourceOption[]>([])
const sourceId = ref(props.initialSourceId === 'orphaned' ? '' : props.initialSourceId || '')
const actorType = ref<'admin' | 'system' | ''>(route.query.actor === 'admin' || route.query.actor === 'system' ? route.query.actor : '')
const eventType = ref<SongIdentityEventType | ''>(typeof route.query.event === 'string' ? route.query.event as SongIdentityEventType : '')
const songIdQuery = ref(typeof route.query.song === 'string' ? route.query.song : '')
const from = ref(toDateOnly(route.query.from))
const to = ref(toDateOnly(route.query.to))
const page = ref(Number(route.query.page) || 1)
const result = ref<SongIdentityEventPage>({ items: [], total: 0, page: 1, pageSize: 25 })
const loading = ref(false)
const error = ref('')
const dateRange = computed(() => ({
  from: from.value || null,
  to: to.value || null,
}))

const eventOptions: Array<{ value: SongIdentityEventType; label: string }> = [
  { value: 'manual_accept', label: '人工接受' },
  { value: 'manual_reject', label: '人工拒绝' },
  { value: 'manual_rebind', label: '人工重绑' },
  { value: 'manual_reevaluate', label: '解绑并重新评估' },
  { value: 'manual_exclude', label: '排除文件' },
  { value: 'auto_bind', label: '自动绑定' },
  { value: 'auto_migrate', label: '自动迁移' },
  { value: 'invalidate', label: '绑定失效' },
  { value: 'migration_snapshot', label: '历史迁移快照' },
]
function eventLabel(value: SongIdentityEventType) {
  return eventOptions.find(option => option.value === value)?.label ?? value
}
function bindingTitle(binding: SongIdentityBinding | null) {
  if (!binding) return '无全局绑定'
  return `Plex #${binding.plexRatingKey || '无 ratingKey'} · ${binding.status}`
}
function sourceName(id: string | null) {
  if (!id) return '全局操作'
  const source = sources.value.find(item => item.id === id)
  return source?.name || source?.neteasePlaylistName || id
}
function toDateOnly(value: unknown) {
  if (typeof value !== 'string') return ''
  const match = value.match(/^\d{4}-\d{2}-\d{2}/)
  return match?.[0] ?? ''
}
function localDayBoundaryIso(value: string, boundary: 'start' | 'end') {
  if (!value) return ''
  const time = boundary === 'start' ? 'T00:00:00.000' : 'T23:59:59.999'
  const date = new Date(`${value}${time}`)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString()
}
function syncUrl() {
  router.replace({ query: {
    ...route.query,
    source: sourceId.value || undefined,
    actor: actorType.value || undefined,
    event: eventType.value || undefined,
    song: songIdQuery.value || undefined,
    from: from.value || undefined,
    to: to.value || undefined,
    page: page.value > 1 ? String(page.value) : undefined,
  } })
}
async function load() {
  loading.value = true
  error.value = ''
  try {
    result.value = await api.get<SongIdentityEventPage>('/match-management/events', {
      sourceId: sourceId.value,
      actorType: actorType.value,
      eventType: eventType.value,
      neteaseSongId: songIdQuery.value,
      from: localDayBoundaryIso(from.value, 'start'),
      to: localDayBoundaryIso(to.value, 'end'),
      page: String(page.value),
      pageSize: '25',
    })
    syncUrl()
  } catch (value) {
    error.value = value instanceof Error ? value.message : '加载身份历史失败'
  } finally {
    loading.value = false
  }
}
async function applySource() { page.value = 1; emit('sourceChange', sourceId.value); await load() }
async function applyFilters() { page.value = 1; await load() }
async function applyDateRange(value: { from: string | null; to: string | null }) {
  from.value = value.from || ''
  to.value = value.to || ''
  await applyFilters()
}
async function goPage(value: number) { page.value = value; await load() }
onMounted(async () => {
  sources.value = await api.get<SourceOption[]>('/playlist-sources')
  await load()
})
</script>

<style scoped>
.history-toolbar { display: grid; grid-template-columns: 1.3fr .8fr 1fr .75fr auto; gap: .75rem; align-items: end; padding: 1rem; }
.history-toolbar label { display: flex; min-width: 0; flex-direction: column; gap: .35rem; color: var(--text-muted-deep); font-size: .7rem; font-weight: 650; }
.history-date-range { min-width: 11rem; }
.history-date-range::after { display: block; margin-top: .3rem; color: var(--text-muted-deep); font-size: .6rem; content: '结束日期包含当天全部事件'; }
.history-error { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .8rem 1rem; color: var(--danger); }
.history-list { position: relative; display: grid; gap: .8rem; margin: 0; padding: 0; list-style: none; }
.history-list::before { position: absolute; top: 1.5rem; bottom: 1.5rem; left: 1.55rem; width: 1px; background: var(--border-primary); content: ''; }
.history-event { position: relative; padding: 1rem 1rem 1rem 3.7rem; }
.history-marker { position: absolute; z-index: 1; top: 1rem; left: 1rem; display: grid; width: 1.15rem; height: 1.15rem; place-items: center; border-radius: 50%; color: var(--text-muted); background: var(--bg-hover); box-shadow: 0 0 0 .35rem var(--bg-surface); }
.history-marker--admin { color: var(--accent); background: var(--accent-muted); }
.history-event header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
.history-event header p { color: var(--text-muted-deep); font-size: .65rem; }
.history-event h2 { color: var(--text-primary); font-size: .9rem; }
.history-event time { color: var(--text-muted-deep); font-size: .68rem; white-space: nowrap; }
.history-transition { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: .8rem; margin-top: .8rem; }
.history-transition > div { display: flex; min-width: 0; flex-direction: column; padding: .65rem; border: 1px solid var(--border-primary); border-radius: .55rem; background: var(--bg-app); }
.history-transition span, .history-transition small { color: var(--text-muted-deep); font-size: .65rem; }
.history-transition strong { margin-block: .15rem; color: var(--text-primary); font-size: .75rem; }
.history-transition small { overflow-wrap: anywhere; font-family: var(--font-mono, monospace); }
.history-event details { margin-top: .7rem; }
.history-event summary { cursor: pointer; color: var(--accent); font-size: .7rem; }
.history-event dl { display: grid; grid-template-columns: repeat(3, 1fr); gap: .5rem; margin-top: .6rem; }
.history-event dt { color: var(--text-muted-deep); font-size: .62rem; }
.history-event dd { color: var(--text-primary); font-size: .7rem; overflow-wrap: anywhere; }
.history-event pre { max-height: 14rem; margin-top: .6rem; overflow: auto; padding: .65rem; border-radius: .5rem; background: var(--bg-app); font-size: .64rem; }
.history-pagination { display: flex; align-items: center; justify-content: center; gap: 1rem; padding: .75rem; color: var(--text-muted); font-size: .72rem; }
@media (max-width: 850px) {
  .history-toolbar { grid-template-columns: 1fr 1fr; }
}
@media (max-width: 600px) {
  .history-toolbar { grid-template-columns: 1fr; }
  .history-event header { flex-direction: column; }
  .history-transition { grid-template-columns: 1fr; }
  .history-transition > svg { transform: rotate(90deg); }
  .history-event dl { grid-template-columns: 1fr; }
  .history-pagination { flex-wrap: wrap; }
}
</style>
