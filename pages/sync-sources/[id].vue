<template>
  <div class="source-detail page-stack">
    <div v-if="loading" class="section-card p-12 text-center text-muted">正在加载同步源…</div>
    <div v-else-if="loadError && !source" class="source-detail__load-error" role="alert"><h1>暂时无法读取来源</h1><p>{{ loadError }}</p><button class="btn btn-secondary" @click="refresh">重新加载</button><NuxtLink to="/sync-sources">返回音乐库</NuxtLink></div>
    <EmptyState v-else-if="!source" title="同步源不存在" description="它可能已经被删除。"><NuxtLink to="/sync-sources" class="btn btn-secondary">返回音乐库</NuxtLink></EmptyState>
    <template v-else>
      <div v-if="loadError" class="source-detail__load-error" role="alert"><span>{{ loadError }}</span><button class="btn btn-secondary btn-sm" @click="refresh">重新加载</button></div>
      <NuxtLink to="/sync-sources" class="btn btn-ghost btn-xs source-detail__back"><AppIcon name="arrowLeft" :size="14" />返回</NuxtLink>
      <header class="source-detail__header section-card">
        <img v-if="source.coverUrl && !coverFailed" :src="source.coverUrl" :alt="`${source.name} 封面`" @error="coverFailed = true" /><div v-else class="source-detail__cover"><AppIcon :name="source.type === 'album' ? 'album' : 'music'" :size="28" /></div>
        <div class="source-detail__identity"><div class="flex flex-wrap items-center gap-2"><SourceBadge :type="source.type" /><StatusBadge :status="source.enabled?'ok':'idle'" :label="source.enabled?'已启用':'已禁用'" /></div><h1>{{ source.name || source.neteasePlaylistName }}</h1><p>{{ source.neteasePlaylistName }} · {{ sourceCountLabel }}</p></div>
        <div class="source-detail__header-actions"><button class="btn btn-primary btn-sm" :disabled="acting || (source.type === 'playlist' && !source.enabled)" @click="sync('normal')"><AppIcon name="sync" :size="14" />同步</button><button class="btn btn-secondary btn-sm" @click="openTab('settings')"><AppIcon name="settings" :size="14" />设置</button></div>
      </header>
      <section v-if="requestState && requestPresentation" class="section-card source-detail__request" aria-label="当前来源请求" aria-live="polite">
        <div><strong :class="`text-${requestPresentation.tone}`">{{ requestPresentation.label }}</strong><p>{{ requestPresentation.detail }}</p></div>
        <NuxtLink v-if="requestState.runId" :to="`/task-center/runs/${requestState.runId}`" class="btn btn-secondary btn-sm">查看运行结果</NuxtLink>
        <button v-if="requestState.kind === 'analysis' && requestState.status === 'completed'" class="btn btn-secondary btn-sm" @click="openTab('initialization')">查看接管结果</button>
      </section>
      <PageTabs v-model="activeTab" :tabs="tabs" aria-label="同步源详情" @change="syncTabQuery" />

      <section v-if="activeTab==='overview'" class="source-detail__overview">
        <div class="source-detail__metrics"><article class="section-card"><span>首次媒体接管</span><strong>{{ initializationLabel }}</strong><small>首次同步前的媒体确认</small></article><article class="section-card"><span>最近结果</span><strong>{{ { idle: '尚未同步', success: '同步成功', partial: '部分完成', failed: '同步失败' }[source.lastStatus] }}</strong><small>{{ source.lastSyncedAt ? new Date(source.lastSyncedAt).toLocaleString() : '尚未同步' }}</small></article><article class="section-card"><span>Plex 目标</span><strong>{{ source.plexPlaylistName || source.neteasePlaylistName }}</strong><small>{{ source.plexPlaylistRatingKey ? `#${source.plexPlaylistRatingKey}` : '尚未绑定' }}</small></article><article class="section-card"><span>下次排期</span><strong>{{ source.nextSyncAt ? new Date(source.nextSyncAt).toLocaleString() : '未排期' }}</strong><small>{{ source.syncIntervalMinutes ? `${source.syncIntervalMinutes} 分钟` : '继承全局' }}</small></article></div>
        <section class="section-card source-detail__section"><header><div><h2>来源状态</h2><p>网易云目标、Plex 对齐和待处理异常。</p></div></header><div class="source-detail__summary"><SourceSummaryContent :source="source" :repairing="false" /></div></section>
        <details class="source-maintenance"><summary><AppIcon name="settings" :size="17" /><span>维护此收藏<small>重新检查、补全媒体与删除</small></span><AppIcon name="chevronDown" :size="15" /></summary><div class="source-detail__operations"><button class="btn btn-secondary btn-sm" :disabled="acting" @click="sync('full')">完整比较</button><button class="btn btn-secondary btn-sm" :disabled="acting" @click="confirmRebuild=true">重建托管关联</button><button v-if="source.type==='playlist'" class="btn btn-secondary btn-sm" :disabled="acting" @click="openRedownload">重新下载托管媒体</button><button class="btn btn-secondary btn-sm" :disabled="acting" @click="repair">补全媒体</button><button class="btn btn-danger btn-sm" @click="confirmDelete=true">删除来源</button></div></details>
        <section v-if="recentRuns.length" class="section-card source-detail__section"><header><div><h2>最近运行</h2><p>该来源最近的任务记录。</p></div><button class="btn btn-ghost btn-xs" @click="openTab('runs')">查看全部</button></header><div class="source-detail__runs"><RunCard v-for="run in recentRuns.slice(0,3)" :key="run.id" :run="run" /></div></section>
      </section>
      <SourceInitializationPanel v-else-if="activeTab==='initialization'" :source-id="source.id" :source-type="source.type" @changed="refresh" />
      <section v-else-if="activeTab==='media'" class="section-card source-detail__section"><SourceMediaDetails :source-id="source.id" @changed="refresh" /></section>
      <section v-else-if="activeTab==='runs'" class="source-detail__runs-tab"><header class="section-card source-detail__runs-header"><div><h2>运行记录</h2><p>查看该来源最近的接管、同步、下载与修复任务。</p></div><button class="btn btn-secondary btn-xs" @click="loadRuns"><AppIcon name="refresh" :size="13" />刷新</button></header><p v-if="runsLoading" class="text-muted text-sm" role="status">正在读取运行记录…</p><div v-else-if="runsError" class="source-detail__load-error" role="alert"><p>{{ runsError }}</p><button class="btn btn-secondary btn-sm" @click="loadRuns">重试运行记录</button></div><EmptyState v-else-if="!recentRuns.length" title="暂无运行记录" description="该来源还没有可显示的任务。" /><div v-else class="source-detail__runs"><RunCard v-for="run in recentRuns" :key="run.id" :run="run" /></div><NuxtLink :to="`/task-center?tab=runs&runSource=${source.id}`" class="btn btn-secondary w-fit">在活动中查看完整记录</NuxtLink></section>
      <SourceSettingsPanel v-if="settingsVisited" v-show="activeTab === 'settings'" :key="source.id" :source="source" @saved="onSaved" />
      <p v-if="notice" class="source-detail__notice" role="status">{{ notice }}</p><p v-if="error" class="source-detail__error" role="alert">{{ error }}</p>
      <ConfirmDialog :visible="confirmDelete" title="删除同步源" message="删除来源不会删除媒体文件，但会清理该来源的接管工作区和排期。确定继续？" confirm-label="删除来源" variant="danger" :busy="deleting" @confirm="remove" @cancel="confirmDelete=false"><p class="text-sm text-muted">删除来源不会删除媒体文件，但会清理该来源的接管工作区和排期。确定继续？</p><p v-if="deleteError" class="text-sm text-danger mt-3" role="alert">{{ deleteError }}</p></ConfirmDialog>
      <ConfirmDialog :visible="confirmRebuild" title="重新评估自动匹配并同步" message="将保留人工决定，把此来源范围内的自动绑定置为待重新评估，并立即执行完整比较。确定继续？" confirm-label="确认重新评估" @confirm="confirmRebuild=false; sync('rebuild_matching')" @cancel="confirmRebuild=false" />
      <ConfirmDialog :visible="confirmRedownload" title="重新下载托管音频并同步" message="" confirm-label="确认重新下载" variant="danger" :busy="acting" :confirm-disabled="redownloadLoading || !!redownloadError || !redownloadPreview?.snapshotAvailable" @confirm="runRedownload" @cancel="closeRedownload">
        <div class="source-detail__redownload"><p>新音频通过格式校验并完成写标后才会原子替换；单曲失败时保留旧文件和 Plex 条目。</p><p v-if="redownloadLoading">正在检查本地文件归属…</p><p v-else-if="redownloadError" class="text-danger">{{ redownloadError }}</p><dl v-else-if="redownloadPreview"><div><dt>当前范围</dt><dd>{{ redownloadPreview.total }} 首</dd></div><div><dt>默认处理</dt><dd>{{ redownloadPreview.eligible }} 首</dd></div><div><dt>保护外部文件</dt><dd>{{ redownloadPreview.protectedExternal }} 首</dd></div><div><dt>保护人工绑定</dt><dd>{{ redownloadPreview.protectedManual }} 首</dd></div></dl><label v-if="redownloadPreview?.protectedExternal"><input v-model="takeOverExternal" type="checkbox" /><span><strong>接管并替换外部文件</strong>（人工绑定仍受保护）</span></label><p class="text-danger">此操作会产生大量网络流量和磁盘写入。</p></div>
      </ConfirmDialog>
    </template>
  </div>
</template>

<script setup lang="ts">
import { sourceRequestProgress } from '~/lib/source-request-presentation'
import { sseSubscribe } from '~/composables/sse'
import type { PlaylistSource } from '~~/server/lib/playlist/types'; import type { SyncMode } from '~~/server/lib/sync/service-state'; import type { TaskRunSummary } from '~~/server/lib/job/types'
const loadError = ref(''), runsError = ref(''), runsLoading = ref(false), deleting = ref(false), deleteError = ref(''), coverFailed = ref(false)
let sourceGeneration = 0, runsGeneration = 0
interface RedownloadPreview { total:number; eligible:number; protectedExternal:number; protectedManual:number; snapshotAvailable:boolean }
const { error: sourceRequestError, requestState, trackRequest, syncSource: requestSourceSync } = useSourceSync()
const route=useRoute();const router=useRouter();const api=useApi();const source=ref<PlaylistSource|null>(null);const loading=ref(true);const acting=ref(false);const notice=ref('');const error=ref('');const confirmDelete=ref(false);const confirmRebuild=ref(false);const confirmRedownload=ref(false);const redownloadLoading=ref(false);const redownloadError=ref('');const redownloadPreview=ref<RedownloadPreview|null>(null);const takeOverExternal=ref(false);const recentRuns=ref<TaskRunSummary[]>([])
const allowedTabs=['overview','initialization','media','runs','settings'];const activeTab=ref(allowedTabs.includes(String(route.query.tab))?String(route.query.tab):'overview');const tabs=[{key:'overview',label:'概览'},{key:'initialization',label:'首次媒体接管'},{key:'media',label:'歌曲与媒体'},{key:'runs',label:'运行记录'},{key:'settings',label:'设置'}]
const requestPresentation = computed(() => requestState.value ? sourceRequestProgress(requestState.value) : null)
const settingsVisited = ref(activeTab.value === 'settings')
watch(activeTab, tab => { if (tab === 'settings') settingsVisited.value = true })
const initializationLabel=computed(()=>({pending:'待接管',analyzing:'分析中',awaiting_review:'等待确认',applying:'应用中',completed:'已完成',failed:'失败',cancelled:'已取消',skipped:'已跳过'} as Record<string,string>)[source.value?.initializationStatus||'']||'不适用')
const sourceCountLabel=computed(()=>{const value=source.value;if(!value)return '0 首';if(value.type==='playlist'&&value.initializationTotalItems&&['analyzing','awaiting_review','applying','completed'].includes(value.initializationStatus||''))return `${value.initializationTotalItems} 首（接管快照）`;return `${value.trackCount||0} 首`})
function syncTabQuery(){void router.replace({query:{...route.query,tab:activeTab.value==='overview'?undefined:activeTab.value}})}
function openTab(tab:string){activeTab.value=tab;syncTabQuery()}
async function refresh() {
  const id = String(route.params.id), generation = ++sourceGeneration
  loading.value = !source.value
  loadError.value = ''
  try {
    const data = await api.get<PlaylistSource>(`/playlist-sources/${id}`)
    if (generation !== sourceGeneration || String(route.params.id) !== id) return
    source.value = data
    void loadRuns()
  } catch (value) { if (generation === sourceGeneration) loadError.value = value instanceof Error ? value.message : '来源读取失败，请重试' }
  finally { if (generation === sourceGeneration) loading.value = false }
}
async function loadRuns() {
  const id = source.value?.id
  if (!id) return
  const generation = ++runsGeneration
  runsLoading.value = true; runsError.value = ''
  try {
    const data = await api.get<{items:TaskRunSummary[]}>('/runs',{sourceId:id,limit:'20'})
    if (generation === runsGeneration && source.value?.id === id) recentRuns.value = data.items
  } catch (value) { if (generation === runsGeneration) runsError.value = value instanceof Error ? value.message : '运行记录读取失败' }
  finally { if (generation === runsGeneration) runsLoading.value = false }
}
async function sync(mode: SyncMode) {
  if (!source.value) return
  acting.value = true
  error.value = ''
  try {
    const data = await requestSourceSync(source.value.id, { mode })
    const result = data.results[0]
    notice.value = result?.message || '请求已接受'
    if (result?.requestId) await router.replace({ query: { ...route.query, request: result.requestId } })
    if (result?.kind === 'analysis' || result?.status === 'awaiting_review') openTab('initialization')
    await refresh()
  } catch (value) { error.value = value instanceof Error ? value.message : '操作失败' }
  finally { acting.value = false }
}
async function repair(){if(!source.value)return;acting.value=true;try{await api.post(`/playlist-sources/${source.value.id}/repair`,{});notice.value='补全任务已触发'}catch(value){error.value=value instanceof Error?value.message:'补全失败'}finally{acting.value=false}}
async function openRedownload(){if(!source.value)return;confirmRedownload.value=true;redownloadLoading.value=true;redownloadError.value='';redownloadPreview.value=null;takeOverExternal.value=false;try{redownloadPreview.value=await api.get<RedownloadPreview>(`/playlist-sources/${source.value.id}/redownload-preview`)}catch(value){redownloadError.value=value instanceof Error?value.message:'无法读取重新下载范围'}finally{redownloadLoading.value=false}}
function closeRedownload(){if(acting.value)return;confirmRedownload.value=false;redownloadPreview.value=null;redownloadError.value='';takeOverExternal.value=false}
async function runRedownload() {
  if (!source.value || !redownloadPreview.value?.snapshotAvailable) return
  acting.value = true
  error.value = ''
  try {
    const result = await requestSourceSync(source.value.id, { mode: 'redownload_managed', takeOverExternal: takeOverExternal.value })
    notice.value = result.results[0]?.message || '请求已接受'
    confirmRedownload.value = false
    await refresh()
  } catch (value) { error.value = value instanceof Error ? value.message : '触发重新下载失败' }
  finally { acting.value = false }
}
async function remove() {
  if (!source.value || deleting.value) return
  deleting.value = true; deleteError.value = ''
  try { await api.del(`/playlist-sources/${source.value.id}`); confirmDelete.value = false; settingsVisited.value = false; await nextTick(); await navigateTo('/sync-sources') }
  catch (value) { deleteError.value = value instanceof Error ? value.message : '删除失败，请重试' }
  finally { deleting.value = false }
}
watch(confirmDelete, visible => { if (visible) deleteError.value = '' })
watch(() => route.query.tab, tab => { activeTab.value = allowedTabs.includes(String(tab)) ? String(tab) : 'overview' })
watch(() => route.params.id, () => {
  sourceGeneration++; runsGeneration++
  source.value = null; recentRuns.value = []; runsError.value = ''; notice.value = ''; error.value = ''; coverFailed.value = false
  void refresh()
})
onUnmounted(() => { sourceGeneration++; runsGeneration++ })
function onSaved(value:PlaylistSource){source.value=value;notice.value='设置已保存'}
watch(sourceRequestError, value => { if (value) error.value = value })
watch(() => requestState.value?.status, () => { if (!acting.value) void refresh() })
function restoreRequest() {
  const id = typeof route.query.request === 'string' ? route.query.request : null
  if (id && requestState.value?.id === id && requestState.value.sourceId === String(route.params.id)) return
  void trackRequest(id, String(route.params.id))
}
let resumeUnsubscribe: (() => void) | null = null
watch([() => route.query.request, () => route.params.id], restoreRequest)
onMounted(() => { restoreRequest(); void refresh(); resumeUnsubscribe = sseSubscribe('resync', () => { void refresh() }) })
onUnmounted(() => resumeUnsubscribe?.())
</script>

<style scoped>
.source-detail__request { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); padding: var(--space-4); }
.source-detail__request > div { flex: 1; min-width: 0; }
.source-detail__request p { margin: var(--space-1) 0 0; color: var(--text-secondary); font-size: var(--text-sm); }

.source-detail__identity {
  min-width: 0;
}
.source-detail__identity h1 {
  overflow-wrap: anywhere;
  font-size: var(--text-4xl);
  font-weight: var(--font-weight-semibold);
  line-height: 1.3;
  margin: var(--space-1) 0 var(--space-0_5);
  color: var(--text-primary);
}
.source-detail__load-error {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-3);
  padding: var(--space-4);
  border: 1px solid var(--danger-border);
  border-radius: var(--radius-md);
  background: var(--danger-soft);
  font-size: var(--text-sm);
  color: var(--danger);
  overflow-wrap: anywhere;
}
.source-detail__load-error h1 {
  font-size: var(--text-lg);
  font-weight: var(--font-weight-semibold);
}
.source-detail__load-error p {
  flex-basis: 100%;
}
.source-detail__header {
  padding: var(--space-8);
  background: var(--bg-sidebar);
  border: 0;
  box-shadow: none;
  border-radius: var(--radius-xl);
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: var(--space-4);
  align-items: center;
}
.source-detail__header > img,
.source-detail__cover {
  width: 8rem;
  height: 8rem;
  border-radius: var(--radius-lg);
  object-fit: cover;
}
.source-detail__header-actions {
  align-self: end;
}
.source-maintenance {
  border-top: 1px solid var(--border-primary);
  padding: var(--space-4) 0;
}
.source-maintenance summary {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  list-style: none;
  cursor: pointer;
  font-size: var(--text-base);
}
.source-maintenance summary > span {
  flex: 1;
}
.source-maintenance small {
  display: block;
  margin-top: var(--space-1);
  font-size: var(--text-xs);
  color: var(--text-tertiary);
}
.source-maintenance .source-detail__operations {
  margin-top: var(--space-5);
}
.source-maintenance summary::-webkit-details-marker {
  display: none;
}
.source-detail__cover {
  display: grid;
  place-items: center;
  background: var(--accent-muted);
  color: var(--accent);
  border: 1px solid var(--border-primary);
}
.source-detail {
  padding-bottom: var(--space-8);
}
.source-detail__back {
  width: max-content;
  margin-bottom: -0.45rem;
}
.source-detail__identity p {
  color: var(--text-muted);
  font-size: var(--text-xs);
}
.source-detail__header-actions,
.source-detail__operations {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.source-detail__overview,
.source-detail__runs-tab {
  display: grid;
  gap: var(--space-4);
}
.source-detail__metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-3);
}
.source-detail__metrics article {
  padding: var(--space-3_5);
}
.source-detail__metrics span,
.source-detail__metrics strong,
.source-detail__metrics small {
  display: block;
}
.source-detail__metrics span,
.source-detail__metrics small {
  color: var(--text-muted);
  font-size: var(--text-xs);
}
.source-detail__metrics strong {
  margin: var(--space-1) 0;
  overflow: hidden;
  color: var(--text-primary);
  font-size: var(--text-base);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.source-detail__section {
  padding: var(--space-4);
}
.source-detail__section > header,
.source-detail__runs-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
}
.source-detail__section > header {
  margin-bottom: var(--space-3);
}
.source-detail__section h2,
.source-detail__runs-header h2 {
  color: var(--text-primary);
  font-size: var(--text-base);
}
.source-detail__section header p,
.source-detail__runs-header p {
  margin-top: var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-xs);
}
.source-detail__summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-3) var(--space-5);
  align-items: center;
  padding: var(--space-3);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-lg);
  background: var(--bg-surface);
}
.source-detail__summary:deep(.sync-hover-card__header) {
  grid-row: 1 / span 2;
}
.source-detail__summary:deep(.sync-hover-card__stats) {
  justify-content: flex-end;
  margin: 0;
}
.source-detail__summary:deep(.sync-hover-card__footer) {
  margin: 0;
  text-align: right;
}
.source-detail__runs-header {
  align-items: center;
  padding: var(--space-3_5) var(--space-4);
}
.source-detail__runs {
  display: grid;
}
.source-detail__redownload {
  display: grid;
  gap: var(--space-3);
  color: var(--text-secondary);
  font-size: var(--text-xs);
}
.source-detail__redownload dl {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-2);
}
.source-detail__redownload dl div,
.source-detail__redownload label {
  padding: var(--space-2_5);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-lg);
}
.source-detail__redownload label {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.source-detail__notice,
.source-detail__error {
  position: fixed;
  z-index: 30;
  right: 1rem;
  bottom: 1rem;
  max-width: 28rem;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  font-size: var(--text-xs);
}
.source-detail__notice {
  color: var(--success);
  background: var(--success-soft);
  border: 1px solid var(--success-border);
}
.source-detail__error {
  color: var(--danger);
  background: var(--danger-soft);
  border: 1px solid var(--danger-border);
}
@media (max-width: 900px) {
  .source-detail__metrics {
    grid-template-columns: repeat(2, 1fr);
  }
  .source-detail__header {
    grid-template-columns: auto minmax(0, 1fr);
  }
  .source-detail__header-actions {
    grid-column: 1/-1;
  }
  .source-detail__summary {
    grid-template-columns: 1fr;
  }
  .source-detail__summary:deep(.sync-hover-card__header) {
    grid-row: auto;
  }
  .source-detail__summary:deep(.sync-hover-card__stats) {
    justify-content: flex-start;
  }
  .source-detail__summary:deep(.sync-hover-card__footer) {
    text-align: left;
  }
}
@media (max-width: 560px) {
  .source-detail__metrics {
    grid-template-columns: 1fr 1fr;
  }
  .source-detail__operations {
    align-items: stretch;
    flex-direction: column;
  }
  .source-detail__operations .btn {
    justify-content: center;
  }
  .source-detail__runs-header {
    align-items: flex-start;
  }
  .source-detail__runs-header .btn {
    flex: none;
  }
}
@media (max-width: 767px) {
  .source-detail__notice,
  .source-detail__error {
    bottom: calc(5.5rem + env(safe-area-inset-bottom));
    max-width: calc(100vw - 2rem);
    overflow-wrap: anywhere;
  }
}
@media (max-width: 767px) {
  .source-detail__header {
    padding: var(--space-5);
  }
  .source-detail__identity h1 {
    font-size: var(--text-2xl);
  }
  .source-detail__header > img,
  .source-detail__cover {
    width: 5rem;
    height: 5rem;
  }
}
</style>
