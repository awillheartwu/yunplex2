<template>
  <div class="source-detail page-stack">
    <SourceInitializationLeaveGuard ref="initializationGuard" :pending="activeTab === 'initialization' && initializationPending.pending && !deleting" :analyzing="initializationPending.analyzing" />
    <div v-if="loading" class="section-card p-12 text-center text-muted">正在加载同步源…</div>
    <div v-else-if="loadError && !source" class="source-detail__load-error" role="alert"><h1>暂时无法读取来源</h1><p>{{ loadError }}</p><button class="btn btn-secondary" @click="refresh">重新加载</button><NuxtLink to="/sync-sources">返回音乐库</NuxtLink></div>
    <EmptyState v-else-if="!source" title="同步源不存在" description="它可能已经被删除。"><NuxtLink to="/sync-sources" class="btn btn-ghost">返回音乐库</NuxtLink></EmptyState>
    <template v-else>
      <div v-if="loadError" class="source-detail__load-error" role="alert"><span>{{ loadError }}</span><button class="btn btn-secondary btn-sm" @click="refresh">重新加载</button></div>
      <NuxtLink to="/sync-sources" class="btn btn-ghost btn-xs source-detail__back"><AppIcon name="arrowLeft" :size="14" />返回</NuxtLink>
      <nav v-if="onboardingIds.length > 1 && onboardingIndex >= 0" class="section-card source-detail__onboarding" aria-label="本次新增的歌单"><span>本次添加 {{ onboardingIds.length }} 个歌单 · 当前第 {{ onboardingIndex + 1 }} 个，各歌单按所选方式在后台准备</span><div><NuxtLink v-if="onboardingIndex > 0" :to="onboardingLink(onboardingIds[onboardingIndex - 1]!)" class="btn btn-ghost btn-sm">上一个歌单</NuxtLink><NuxtLink v-if="onboardingIndex + 1 < onboardingIds.length" :to="onboardingLink(onboardingIds[onboardingIndex + 1]!)" class="btn btn-secondary btn-sm">下一个歌单</NuxtLink></div></nav>
      <header class="source-detail__header section-card">
        <img v-if="source.coverUrl && !coverFailed" :src="source.coverUrl" :alt="`${source.name} 封面`" @error="coverFailed = true" /><div v-else class="source-detail__cover"><AppIcon :name="source.type === 'album' ? 'album' : 'music'" :size="28" /></div>
        <div class="source-detail__identity"><div class="flex flex-wrap items-center gap-2"><SourceBadge :type="source.type" /><StatusBadge :status="source.enabled?'ok':'idle'" :label="source.enabled?'已启用':'已禁用'" /></div><h1>{{ source.name || source.neteasePlaylistName }}</h1><p>{{ source.neteasePlaylistName }} · {{ sourceCountLabel }}</p></div>
        <div class="source-detail__header-actions"><button class="btn btn-primary btn-sm" :disabled="acting" @click="sync('normal')"><AppIcon name="sync" :size="14" />同步</button><button class="btn btn-secondary btn-sm" @click="openTab('settings')"><AppIcon name="settings" :size="14" />设置</button></div>
      </header>
      <section v-if="requestState && requestPresentation" class="section-card source-detail__request" aria-label="当前来源请求" aria-live="polite">
        <div><strong :class="`text-${requestPresentation.tone}`">{{ requestPresentation.label }}</strong><p>{{ requestPresentation.detail }}</p></div>
        <NuxtLink v-if="requestState.runId" :to="`/task-center/runs/${requestState.runId}`" class="btn btn-ghost btn-sm">查看运行结果</NuxtLink>
        <button v-if="requestState.kind === 'analysis' && requestState.status === 'completed'" class="btn btn-ghost btn-sm" @click="openTab('initialization')">查看接管结果</button>
      </section>
      <PageTabs :model-value="activeTab" :tabs="tabs" aria-label="同步源详情" @change="openTab" />
      <aside v-if="source.plexNotice" class="section-card source-detail__plex-notice" role="status"><AppIcon name="info" :size="18" /><span>{{ source.plexNotice.message }}</span><button class="btn btn-info btn-sm" :disabled="acting" @click="sync('full')">检查同步</button></aside>

      <section v-if="activeTab==='overview'" class="source-detail__overview">
        <SourceSummaryContent :source="source" @runs="openTab('runs')" />
        <div class="source-detail__metrics">
          <article class="section-card source-detail__metric-action"><div><span><AppIcon name="shield" :size="16" />首次媒体接管</span><strong>{{ initializationLabel }}</strong></div><button class="btn btn-sm" :class="source.initializationStatus === 'awaiting_review' ? 'btn-soft' : 'btn-ghost'" aria-label="查看或确认首次接管方案" @click="openTab('initialization')">{{ source.initializationStatus === 'awaiting_review' ? '确认方案' : '查看详情' }}<AppIcon name="arrowRight" :size="14" /></button></article>
          <article class="section-card"><span><AppIcon name="source" :size="16" />Plex 目标</span><strong :title="source.plexPlaylistName || source.neteasePlaylistName">{{ source.plexPlaylistName || source.neteasePlaylistName }}</strong><small>{{ source.plexPlaylistRatingKey ? '已连接 Plex 歌单' : '尚未连接' }}</small></article>
          <article class="section-card"><span><AppIcon name="calendar" :size="16" />下次同步</span><strong>{{ source.nextSyncAt ? new Date(source.nextSyncAt).toLocaleString() : '未排期' }}</strong><small>{{ source.syncIntervalMinutes ? `每 ${source.syncIntervalMinutes} 分钟` : '使用全局同步间隔' }}</small></article>
        </div>
        <details class="source-maintenance" open><summary><AppIcon name="settings" :size="17" /><span>维护此收藏<small>重新检查、补全媒体与删除</small></span><AppIcon name="chevronDown" :size="15" /></summary><div class="source-detail__operations"><ActionHint text="重新检查整张歌单，并按当前设置补齐歌曲、移除多余条目和调整顺序。"><button aria-label="完整比较" class="btn btn-info btn-sm" :disabled="acting" @click="sync('full')"><AppIcon name="search" :size="16" />检查同步</button></ActionHint><ActionHint v-if="source.type==='playlist'" text="重新按标题、艺人、时长等规则评估系统自动选择的歌曲，生成一份新方案；你确认过或手动选择的关联会保留，审核确认后才会应用。"><button aria-label="重新分析自动匹配" class="btn btn-info btn-sm" :disabled="acting" @click="confirmReanalyze=true"><AppIcon name="refresh" :size="16" />重新分析匹配</button></ActionHint><ActionHint text="只按精确路径重新核对 YunPlex 托管文件与 Plex 的关联，再更新歌单；不会重新按标题/艺人评分，也不会覆盖手动选择。"><button aria-label="重建托管关联" class="btn btn-soft btn-sm" :disabled="acting" @click="confirmRebuild=true"><AppIcon name="link" :size="16" />重建托管关联</button></ActionHint><ActionHint v-if="source.type==='playlist'" text="重新下载由应用保存的音乐；新文件检查通过后替换旧文件，下载失败则保留旧文件。"><button aria-label="重新下载托管媒体" class="btn btn-warning btn-sm" :disabled="acting" @click="openRedownload"><AppIcon name="download" :size="16" />重新下载</button></ActionHint><ActionHint text="为现有音乐补全标签、歌词和独立图片；缺少音乐文件的歌曲会跳过，不调整 Plex 歌单。"><button aria-label="补全标签和词图" class="btn btn-info btn-sm" :disabled="acting" @click="repair"><AppIcon name="repair" :size="16" />补全标签和词图</button></ActionHint><ActionHint text="移除这份收藏和未提交的方案，停止自动同步；音乐文件会保留。"><button aria-label="删除来源" class="btn btn-danger btn-sm" @click="confirmDelete=true"><AppIcon name="trash" :size="16" />删除收藏</button></ActionHint></div></details>
        <section v-if="recentRuns.length" class="section-card source-detail__section"><header><div><h2>最近运行</h2><p>该来源最近的任务记录。</p></div><button class="btn btn-ghost btn-xs" @click="openTab('runs')"><AppIcon name="activity" :size="14" />全部记录</button></header><div class="source-detail__runs"><RunCard v-for="run in recentRuns.slice(0,3)" :key="run.id" :run="run" /></div></section>
      </section>
      <SourceInitializationPanel v-else-if="activeTab==='initialization'" :key="source.id" :source-id="source.id" :source-type="source.type" @changed="refresh" @submitted="onInitializationSubmitted" @pending-change="initializationPending = $event" @media="openTab('media')" />
      <section v-else-if="activeTab==='media'" class="section-card source-detail__section"><SourceMediaDetails :source-id="source.id" @changed="refresh" /></section>
      <section v-else-if="activeTab==='runs'" class="source-detail__runs-tab"><header class="section-card source-detail__runs-header"><div><h2>运行记录</h2><p>查看该来源最近的接管、同步、下载与修复任务。</p></div><button class="btn btn-ghost btn-xs" @click="loadRuns"><AppIcon name="refresh" :size="13" />刷新</button></header><p v-if="runsLoading" class="text-muted text-sm" role="status">正在读取运行记录…</p><div v-else-if="runsError" class="source-detail__load-error" role="alert"><p>{{ runsError }}</p><button class="btn btn-secondary btn-sm" @click="loadRuns">重试运行记录</button></div><EmptyState v-else-if="!recentRuns.length" title="暂无运行记录" description="该来源还没有可显示的任务。" /><div v-else class="source-detail__runs"><RunCard v-for="run in recentRuns" :key="run.id" :run="run" /></div><NuxtLink :to="`/task-center?tab=runs&runSource=${source.id}`" class="btn btn-ghost w-fit">在活动中查看完整记录</NuxtLink></section>
      <SourceSettingsPanel v-if="settingsVisited" v-show="activeTab === 'settings'" :key="source.id" :source="source" @saved="onSaved" />
      <p v-if="notice" class="source-detail__notice" role="status">{{ notice }}</p><p v-if="error" class="source-detail__error" role="alert">{{ error }}</p>
      <ConfirmDialog :visible="confirmDelete" title="删除同步源" message="删除后将停止这份收藏的自动同步，并清除未提交的方案。音乐文件和 Plex 歌单会保留。确定继续？" confirm-label="删除来源" variant="danger" :busy="deleting" @confirm="remove" @cancel="confirmDelete=false"><p class="text-sm text-muted">删除后将停止这份收藏的自动同步，并清除未提交的方案。音乐文件和 Plex 歌单会保留。确定继续？</p><p v-if="deleteError" class="text-sm text-danger mt-3" role="alert">{{ deleteError }}</p></ConfirmDialog>
      <ConfirmDialog :visible="confirmRebuild" title="重建托管关联并同步" message="按精确路径重新核对托管文件关联，再更新 Plex 歌单；不重新评估标题、艺人、时长，也不会覆盖手动选择。确定继续？" confirm-label="确认重建" @confirm="confirmRebuild=false; sync('rebuild_matching')" @cancel="confirmRebuild=false" /><ConfirmDialog :visible="confirmReanalyze" title="重新分析自动匹配" message="只重评自动选择、未人工确认的歌曲；confirmed 和 manual 关联会保留。分析完成后会生成新方案，不会直接改 Plex。确定继续？" confirm-label="开始重新分析" :busy="acting" @confirm="reanalyzeMatching" @cancel="confirmReanalyze=false" />
      <ConfirmDialog :visible="confirmRedownload" title="重新下载音乐并同步" message="" confirm-label="确认重新下载" variant="danger" :busy="acting" :confirm-disabled="redownloadLoading || !!redownloadError || !redownloadPreview?.snapshotAvailable" @confirm="runRedownload" @cancel="closeRedownload">
        <div class="source-detail__redownload"><p>新文件下载并检查成功后才替换旧文件。失败的歌曲会继续使用旧文件。</p><p v-if="redownloadLoading">正在检查哪些文件可以重新下载…</p><p v-else-if="redownloadError" class="text-danger">{{ redownloadError }}</p><dl v-else-if="redownloadPreview"><div><dt>当前范围</dt><dd>{{ redownloadPreview.total }} 首</dd></div><div><dt>默认处理</dt><dd>{{ redownloadPreview.eligible }} 首</dd></div><div><dt>保护外部文件</dt><dd>{{ redownloadPreview.protectedExternal }} 首</dd></div><div><dt>保护人工绑定</dt><dd>{{ redownloadPreview.protectedManual }} 首</dd></div></dl><label v-if="redownloadPreview?.protectedExternal"><input v-model="takeOverExternal" type="checkbox" /><span><strong>也替换原来就有的文件</strong>（你手动选过的文件仍会保留）</span></label><p class="text-danger">此操作会产生大量网络流量和磁盘写入。</p></div>
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
const route=useRoute();const router=useRouter();const api=useApi();const source=ref<PlaylistSource|null>(null);const loading=ref(true);const acting=ref(false);const notice=ref('');const error=ref('');const confirmDelete=ref(false);const confirmRebuild=ref(false);const confirmReanalyze=ref(false);const confirmRedownload=ref(false);const redownloadLoading=ref(false);const redownloadError=ref('');const redownloadPreview=ref<RedownloadPreview|null>(null);const takeOverExternal=ref(false);const recentRuns=ref<TaskRunSummary[]>([])
const allowedTabs=['overview','initialization','media','runs','settings'];const activeTab=ref(allowedTabs.includes(String(route.query.tab))?String(route.query.tab):'overview');const tabs=[{key:'overview',label:'概览'},{key:'initialization',label:'首次媒体接管'},{key:'media',label:'歌曲与媒体'},{key:'runs',label:'运行记录'},{key:'settings',label:'设置'}]
const requestPresentation = computed(() => requestState.value ? sourceRequestProgress(requestState.value) : null)
const settingsVisited = ref(activeTab.value === 'settings')
const initializationGuard = ref<{ confirmNavigation: () => boolean | Promise<boolean> } | null>(null)
const initializationPending = ref({ pending: false, analyzing: false })
const onboardingIds = computed(() => {
  const value = route.query.onboarding
  return (Array.isArray(value) ? value : [value]).filter((id): id is string => typeof id === 'string' && Boolean(id))
})
const onboardingIndex = computed(() => onboardingIds.value.indexOf(String(route.params.id)))
function onboardingLink(id: string) { return { path: `/sync-sources/${encodeURIComponent(id)}`, query: { tab: 'initialization', onboarding: onboardingIds.value } } }
watch(activeTab, tab => { if (tab === 'settings') settingsVisited.value = true })
const initializationLabel=computed(()=>({pending:'待接管',analyzing:'分析中',awaiting_review:'等待确认',applying:'应用中',completed:'已完成',failed:'失败',cancelled:'已取消',skipped:'已跳过'} as Record<string,string>)[source.value?.initializationStatus||'']||'不适用')
const sourceCountLabel=computed(()=>{const value=source.value;if(!value)return '0 首';if(value.type==='playlist'&&value.initializationTotalItems&&['analyzing','awaiting_review','applying'].includes(value.initializationStatus||''))return `${value.initializationTotalItems} 首（方案内）`;return `${value.trackCount||0} 首`})
function syncTabQuery(){void router.replace({query:{...route.query,tab:activeTab.value==='overview'?undefined:activeTab.value}})}
async function openTab(tab:string) {
  if (tab === activeTab.value) return
  if (activeTab.value === 'initialization' && !await initializationGuard.value?.confirmNavigation()) return
  activeTab.value = tab
  await nextTick()
  syncTabQuery()
}
function onInitializationSubmitted() { void refresh() }
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
async function reanalyzeMatching() {
  if (!source.value) return
  acting.value = true
  error.value = ''
  try {
    await api.post(`/playlist-sources/${source.value.id}/reanalyze-matching`, {})
    confirmReanalyze.value = false
    notice.value = '已开始重新分析自动匹配'
    activeTab.value = 'initialization'
    await nextTick()
    syncTabQuery()
    await refresh()
  } catch (value) { error.value = value instanceof Error ? value.message : '重新分析匹配失败' }
  finally { acting.value = false }
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
  initializationPending.value = { pending: false, analyzing: false }
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
let plexUnsubscribe: (() => void) | null = null
async function refreshPlexNotice() {
  const id = String(route.params.id)
  try {
    const result = await api.get<PlaylistSource>(`/playlist-sources/${id}`)
    if (source.value?.id === id) source.value.plexNotice = result.plexNotice
  } catch { /* A later refresh reconciles this informational hint. */ }
}
watch([() => route.query.request, () => route.params.id], restoreRequest)
onMounted(() => { restoreRequest(); void refresh(); resumeUnsubscribe = sseSubscribe('resync', () => { void refresh() }); plexUnsubscribe = sseSubscribe('plex-library-change', () => { void refreshPlexNotice() }) })
onUnmounted(() => { resumeUnsubscribe?.(); plexUnsubscribe?.() })
</script>

<style scoped>
.source-detail__plex-notice{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-3);padding:var(--space-4);border-inline-start:3px solid var(--warning);font-size:var(--text-sm);color:var(--text-secondary)}
.source-detail__plex-notice>span{flex:1;min-width:0}
.source-detail__request { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); padding: var(--space-4); }
.source-detail__request > div { flex: 1; min-width: 0; }
.source-detail__request p { margin: var(--space-1) 0 0; color: var(--text-secondary); font-size: var(--text-sm); }

.source-detail__identity {
  min-width: 0;
}
.source-detail__identity h1 {
  overflow-wrap: anywhere;
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
.source-detail__load-error p {
  flex-basis: 100%;
}
.source-detail__header {
  padding: var(--space-6);
  background: var(--bg-surface);
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
  width: 6rem;
  height: 6rem;
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
  grid-template-columns: repeat(3, minmax(0, 1fr));
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
}
.source-detail__section header p,
.source-detail__runs-header p {
  margin-top: var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-xs);
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
  .source-detail__header {
    grid-template-columns: auto minmax(0, 1fr);
  }
  .source-detail__header-actions {
    grid-column: 1/-1;
  }
}
@media (max-width: 560px) {
  .source-detail__metrics {
    grid-template-columns: 1fr;
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
  .source-detail__header > img,
  .source-detail__cover {
    width: 5rem;
    height: 5rem;
  }
}
.source-detail__metrics article > span,
.source-detail__metric-action > div > span { display: flex; align-items: center; gap: var(--space-2); }
.source-detail__metric-action { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.source-detail__metric-action > div { min-width: 0; }
.source-detail__metric-action > .btn { flex: none; }
.source-detail__operations :deep(.action-hint) { flex: 0 1 auto; }
.source-detail__onboarding { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-3); padding: var(--space-3) var(--space-4); color: var(--text-secondary); font-size: var(--text-sm); }
.source-detail__onboarding > div { display: flex; gap: var(--space-2); }
@media (max-width: 560px) {
  .source-detail__metric-action { flex-wrap: wrap; }
  .source-detail__operations :deep(.action-hint), .source-detail__operations :deep(.btn) { width: 100%; }
}
</style>
