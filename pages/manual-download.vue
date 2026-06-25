<template>
  <div class="manual-page">
    <PageHeader
      description="解析网易云链接或资源 ID，选择歌曲并跟踪下载批次"
    />

    <PageTabs
      :model-value="manualView"
      :tabs="manualPageTabs"
      aria-label="手动下载视图"
      @change="switchManualView"
    />

    <div v-if="manualView === 'workspace'" class="manual-workspace">
    <div class="manual-top-grid">
      <section class="section-card manual-input-card">
        <div class="manual-card-header">
          <div>
            <h3>下载工作台</h3>
            <p>支持链接、纯数字 ID、多首换行、逗号或分号分隔。</p>
          </div>
          <button class="manual-help-link" type="button" aria-label="查看如何获取链接或 ID">
            如何获取链接或 ID?
            <AppIcon name="info" :size="14" />
          </button>
        </div>

        <label class="sr-only" for="manual-download-input">网易云链接、歌单 ID、专辑 ID 或歌曲 ID</label>
        <textarea
          id="manual-download-input"
          v-model="inputValue"
          class="form-input manual-textarea"
          :placeholder="placeholderText"
          :disabled="parseState === 'parsing'"
          @keydown.enter.ctrl.prevent="handleParse"
          @paste="onPaste"
        />

        <div class="manual-input-hints" aria-label="输入帮助">
          <span><AppIcon name="keyboard" :size="13" /> Ctrl+Enter 快速解析</span>
          <span>链接</span>
          <span>歌单 ID</span>
          <span>歌曲 ID</span>
          <span>多行批量输入</span>
        </div>

        <div class="manual-alert-stack" aria-live="polite">
          <div v-if="detectHint && parseState === 'preview'" class="manual-alert manual-alert--success">
            <AppIcon name="check-circle" :size="16" />
            <div>
              <strong>{{ detectHint }}</strong>
              <span>{{ parsedTargetLine }}</span>
            </div>
          </div>

          <div v-if="downloadResult" class="manual-alert manual-alert--success">
            <AppIcon name="download" :size="16" />
            <div>
              <strong>下载已启动，共 {{ downloadResult.total }} 首歌曲</strong>
              <span>任务已进入队列，下方会持续刷新执行状态。</span>
            </div>
          </div>

          <div v-if="saveError" class="manual-alert manual-alert--danger">
            <AppIcon name="warn" :size="16" />
            <div>
              <strong>保存同步源失败</strong>
              <span>{{ saveError }}</span>
            </div>
            <button class="manual-icon-action" type="button" aria-label="关闭保存同步源错误" @click="saveError = ''">
              <AppIcon name="x" :size="14" />
            </button>
          </div>

          <div v-if="error" class="manual-alert manual-alert--danger">
            <AppIcon name="warn" :size="16" />
            <div>
              <strong>解析或启动失败</strong>
              <span>{{ error }}</span>
            </div>
          </div>
        </div>

        <div class="manual-action-row">
          <button
            class="btn btn-primary"
            type="button"
            :disabled="primaryActionDisabled"
            @click="handlePrimaryAction"
          >
            <AppIcon :name="primaryActionIcon" :size="15" :class="{ 'animate-spin': parseState === 'parsing' || downloading }" />
            <span>{{ primaryActionLabel }}</span>
          </button>
          <button
            v-if="parseState === 'preview'"
            class="btn btn-secondary"
            type="button"
            :disabled="parseState === 'parsing'"
            @click="handleParse"
          >
            <AppIcon name="refresh" :size="14" />
            <span>重新解析</span>
          </button>
          <button
            v-if="canSaveAsSource"
            class="btn btn-ghost"
            type="button"
            :disabled="downloading || selectedCount === 0"
            @click="handleDownloadAndSave"
          >
            <AppIcon name="save" :size="14" />
            <span>下载并保存为同步源</span>
          </button>
        </div>
      </section>

      <aside class="section-card manual-config-card" aria-label="下载配置">
        <div class="manual-card-header">
          <div>
            <h3>下载配置</h3>
            <p>当前下载配置</p>
          </div>
        </div>

        <div class="manual-config-list">
          <label class="manual-config-row" for="manual-quality">
            <span class="manual-config-icon manual-config-icon--accent">
              <AppIcon name="music" :size="15" />
            </span>
            <span>
              <strong>音质</strong>
            </span>
            <select id="manual-quality" v-model="quality" class="manual-quality-select" aria-label="选择下载音质">
              <option v-for="option in qualityOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>

          <label class="manual-config-row manual-config-row--toggle">
            <span class="manual-config-icon manual-config-icon--success">
              <AppIcon name="list" :size="15" />
            </span>
            <span>
              <strong>下载歌词</strong>
              <small>{{ downloadLyrics ? '已开启' : '已关闭' }}</small>
            </span>
            <input v-model="downloadLyrics" type="checkbox" aria-label="下载歌词" />
          </label>

          <label class="manual-config-row manual-config-row--toggle">
            <span class="manual-config-icon manual-config-icon--success">
              <AppIcon name="album" :size="15" />
            </span>
            <span>
              <strong>下载封面</strong>
              <small>{{ downloadImages ? '已开启' : '已关闭' }}</small>
            </span>
            <input v-model="downloadImages" type="checkbox" aria-label="下载封面" />
          </label>

          <label class="manual-config-row manual-config-row--toggle">
            <span class="manual-config-icon manual-config-icon--accent">
              <AppIcon name="edit" :size="15" />
            </span>
            <span>
              <strong>写入元数据</strong>
              <small>{{ embedMetadata ? '已开启' : '已关闭' }}</small>
            </span>
            <input v-model="embedMetadata" type="checkbox" aria-label="写入元数据" />
          </label>
        </div>

        <button class="btn btn-secondary manual-reset-button" type="button" @click="resetOptions">
          <AppIcon name="rotate-ccw" :size="14" />
          <span>恢复默认设置</span>
        </button>
      </aside>
    </div>

    <section v-if="parseHistory.length > 0" class="section-card manual-parse-history-card">
      <div class="manual-parse-history-header">
        <div>
          <div class="manual-parse-history-title">
            <h3>最近解析</h3>
            <span>{{ parseHistory.length }}</span>
          </div>
          <p>回到常用歌单或刚刚试过的资源。</p>
        </div>
        <button class="btn btn-ghost btn-xs" type="button" @click="clearParseHistory">清空</button>
      </div>
      <div class="manual-parse-history-list">
        <button
          v-for="item in parseHistory"
          :key="item.id"
          class="manual-parse-history-item"
          type="button"
          @click="restoreParseHistory(item)"
        >
          <span class="manual-parse-history-cover" :class="{ 'manual-parse-history-cover--empty': !item.coverUrl }">
            <img v-if="item.coverUrl" :src="item.coverUrl" :alt="item.title" />
            <AppIcon v-else name="music" :size="14" />
          </span>
          <span class="manual-parse-history-copy">
            <strong>{{ item.title }}</strong>
            <small>{{ manualResourceTypeLabel(item.type) }} · {{ item.trackCount }} 首 · {{ formatManualRelativeTime(item.parsedAt) }}</small>
          </span>
        </button>
      </div>
    </section>

    <section class="section-card manual-results-card">
      <div class="manual-results-header" :class="{ 'manual-results-header--parsed': parseState === 'preview' }">
        <div class="manual-resource-summary">
          <div class="manual-cover" :class="{ 'manual-cover--empty': !coverUrl }">
            <img
              v-if="coverUrl"
              :src="coverUrl"
              :alt="title || '解析资源封面'"
              @error="hideBrokenImage"
            />
            <AppIcon v-else name="music" :size="24" />
          </div>
          <div class="min-w-0">
            <div class="manual-heading-line manual-heading-line--compact">
              <h3>解析结果</h3>
              <span class="manual-count-chip">共 {{ trackCount || 0 }} 首</span>
            </div>
            <p class="manual-resource-title" :title="title || undefined">{{ title || resultEmptyTitle }}</p>
            <p class="manual-resource-meta" :title="resultMetaLine">{{ resultMetaLine }}</p>
            <p
              v-if="parseState === 'preview' && resourceDescription"
              class="manual-resource-description"
              :title="resourceDescription"
            >
              {{ resourceDescription }}
            </p>
            <div v-if="parseState === 'preview'" class="manual-resource-facts">
              <span><strong>{{ trackCount }}</strong> 首歌曲</span>
              <span>{{ totalDurationLabel }}</span>
              <span>{{ manualResourceTypeLabel(resourceType) }}</span>
              <span v-if="resourceUpdatedAt">更新于 {{ formatResourceDate(resourceUpdatedAt) }}</span>
              <span v-if="artist">{{ resourceType === 'playlist' ? '创建者' : '艺人' }}：{{ artist }}</span>
            </div>
          </div>
        </div>

        <div class="manual-results-actions">
          <button
            v-if="parseState === 'preview'"
            class="btn btn-primary manual-result-download"
            type="button"
            :disabled="downloading || selectedCount === 0"
            @click="handleDownload"
          >
            <AppIcon :name="downloading ? 'loader' : 'download'" :size="15" :class="{ 'animate-spin': downloading }" />
            <span>{{ downloading ? '启动中...' : `下载 ${selectedCount} 首` }}</span>
          </button>
        </div>
      </div>

      <div v-if="parseState === 'idle'" class="manual-state-panel manual-state-panel--result-empty">
        <AppIcon name="search" :size="26" />
        <strong>等待解析资源</strong>
        <span>粘贴网易云歌单、专辑或歌曲后，这里会生成可选择的下载表格。</span>
      </div>

      <div v-else-if="parseState === 'parsing'" class="manual-table-skeleton" aria-live="polite">
        <div v-for="row in 7" :key="row" class="manual-skeleton-row" />
      </div>

      <div v-else class="manual-track-list">
        <div class="manual-track-list-header">
          <div>
            <h4>歌曲列表</h4>
            <p aria-live="polite">已选择 {{ selectedCount }} / {{ tracks.length }} 首</p>
          </div>
          <div class="manual-track-list-actions">
            <button
              class="btn btn-secondary btn-xs"
              type="button"
              :disabled="tracks.length === 0"
              @click="toggleAll"
            >
              <AppIcon name="check" :size="13" />
              <span>{{ allSelected ? '取消全选' : '全部选择' }}</span>
            </button>
            <button
              class="btn btn-secondary btn-xs"
              type="button"
              :disabled="tracks.length === 0"
              @click="invertSelection"
            >
              <AppIcon name="sync" :size="13" />
              <span>反选</span>
            </button>
          </div>
        </div>

        <div class="manual-table-shell manual-track-table-shell" tabindex="0" aria-label="歌曲列表，可上下滚动">
          <table class="manual-track-table">
            <thead>
              <tr>
                <th class="manual-col-check">
                  <label class="sr-only" for="manual-select-all">全选解析歌曲</label>
                  <input
                    id="manual-select-all"
                    type="checkbox"
                    :checked="allSelected"
                    :indeterminate.prop="!allSelected && selectedCount > 0"
                    :disabled="tracks.length === 0"
                    @change="toggleAll"
                  />
                </th>
                <th>#</th>
                <th>歌曲名称</th>
                <th>歌手</th>
                <th>专辑</th>
                <th>时长</th>
                <th>音质</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(track, index) in tracks" :key="track.id" :class="{ 'manual-row-muted': !track.selected }">
                <td>
                  <label class="sr-only" :for="`manual-track-${track.id}`">选择 {{ track.name }}</label>
                  <input
                    :id="`manual-track-${track.id}`"
                    type="checkbox"
                    :checked="track.selected"
                    @change="toggleTrack(track.id)"
                  />
                </td>
                <td class="manual-table-index">{{ index + 1 }}</td>
                <td>
                  <div class="manual-song-cell">
                    <strong :title="track.name">{{ track.name }}</strong>
                    <span>
                      <span v-if="qualityBadgeTone" class="manual-quality-badge" :class="`manual-quality-badge--${qualityBadgeTone}`">
                        {{ qualityShortLabel }}
                      </span>
                      <span v-if="embedMetadata" class="manual-quality-badge manual-quality-badge--green">元数据</span>
                    </span>
                  </div>
                </td>
                <td>{{ artistsLine(track) }}</td>
                <td>{{ track.album?.name || '-' }}</td>
                <td>{{ formatManualDuration(track.dt) }}</td>
                <td>{{ qualityLabel }}</td>
              </tr>
            </tbody>
          </table>

          <div v-if="tracks.length === 0" class="manual-state-panel manual-state-panel--compact">
            <strong>暂无可下载歌曲</strong>
            <span>资源已解析，但没有返回可下载曲目。</span>
          </div>
        </div>
      </div>

    </section>

    <section class="section-card manual-queue-card">
      <div class="manual-tabs-header">
        <div>
          <h3>下载队列</h3>
          <p>只展示真实可执行的队列动作；当前系统不承诺暂停正在写入的任务。</p>
        </div>
        <div class="manual-queue-actions">
          <button class="btn btn-secondary btn-xs" type="button" :disabled="retrying || queueStatus.failed === 0" @click="retryAll">
            <AppIcon :name="retrying ? 'loader' : 'refresh'" :size="13" :class="{ 'animate-spin': retrying }" />
            <span>重试失败</span>
          </button>
          <button class="btn btn-danger btn-xs" type="button" :disabled="clearableQueueCount === 0" @click="clearQueue">
            <AppIcon name="trash" :size="13" />
            <span>清空等待与失败</span>
          </button>
        </div>
      </div>

      <div class="manual-tab-strip" role="tablist" aria-label="下载队列分段">
        <button
          v-for="tabItem in queueTabs"
          :key="tabItem.key"
          class="manual-tab-button"
          :class="{ 'manual-tab-button--active': activeQueueTab === tabItem.key }"
          type="button"
          role="tab"
          :aria-selected="activeQueueTab === tabItem.key"
          @click="activeQueueTab = tabItem.key"
        >
          {{ tabItem.label }}
          <span>{{ tabItem.count }}</span>
        </button>
      </div>

      <div class="manual-queue-panel">
        <div v-if="visibleQueueTasks.length > 0" class="manual-task-list">
          <article v-for="task in visibleQueueTasks" :key="task.id" class="manual-task-row">
            <div class="manual-task-cover">
              <AppIcon :name="task.status === 'failed' ? 'warn' : 'music'" :size="16" />
            </div>
            <div class="manual-task-main">
              <div class="manual-task-title-row">
                <strong>{{ task.songName }}</strong>
                <span class="manual-status-badge" :class="`manual-status-badge--${manualDownloadStatusTone(task.status)}`">
                  {{ manualDownloadStatusLabel(task.status) }}
                </span>
              </div>
              <p>{{ task.artist || '未知艺人' }} · {{ task.album || '未知专辑' }} · {{ manualQualityLabel(task.quality) }}</p>
              <p v-if="task.error" class="manual-task-error">{{ task.error }}</p>
              <div v-if="task.status === 'downloading' || task.status === 'tagging'" class="manual-progress-line">
                <div :style="{ width: `${task.progress}%` }" />
              </div>
            </div>
            <div class="manual-task-side">
              <span>{{ task.progress }}%</span>
              <small>{{ formatManualRelativeTime(task.updatedAt) }}</small>
            </div>
            <div class="manual-task-actions">
              <button
                v-if="task.status === 'failed'"
                class="manual-icon-action"
                type="button"
                :aria-label="`重试 ${task.songName}`"
                :disabled="retryingOne === task.id"
                @click="retryOne(task.id)"
              >
                <AppIcon :name="retryingOne === task.id ? 'loader' : 'refresh'" :size="14" :class="{ 'animate-spin': retryingOne === task.id }" />
              </button>
              <button
                v-if="canDeleteManualDownloadTask(task)"
                class="manual-icon-action"
                type="button"
                :aria-label="`删除 ${task.songName}`"
                @click="deleteOne(task.id)"
              >
                <AppIcon name="x" :size="14" />
              </button>
            </div>
          </article>
        </div>

        <div v-else class="manual-state-panel manual-state-panel--queue-empty">
          <AppIcon name="archive" :size="22" />
          <strong>{{ queueEmptyTitle }}</strong>
          <span>{{ loading ? '正在刷新下载队列。' : '这一分段现在没有任务。' }}</span>
        </div>
      </div>
    </section>
    </div>

    <section v-else class="manual-history">
      <div class="manual-history__header">
        <div>
          <h3>手动下载记录</h3>
          <p>每次下载批次都是一个完整运行，失败项可从异常处理统一重试。</p>
        </div>
        <button class="btn btn-secondary btn-xs" type="button" :disabled="manualRuns.loading.value" @click="manualRuns.fetch()">
          <AppIcon :name="manualRuns.loading.value ? 'loader' : 'refresh'" :size="14" :class="{ 'animate-spin': manualRuns.loading.value }" />
          刷新
        </button>
      </div>
      <div v-if="manualRuns.loading.value && manualRuns.items.value.length === 0" class="manual-state-panel">
        <strong>正在加载下载记录</strong>
      </div>
      <EmptyState v-else-if="manualRuns.items.value.length === 0" title="暂无手动下载记录" description="从工作台启动下载后，批次记录会显示在这里。" />
      <div v-else class="space-y-3">
        <RunCard v-for="run in manualRuns.items.value" :key="run.id" :run="run" />
        <Pagination :has-more="manualRuns.hasMore.value" :loading="manualRuns.loadingMore.value" :current-count="manualRuns.items.value.length" :total="manualRuns.total.value" @load-more="manualRuns.loadMore()" />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { URL_PATTERNS } from '~~/composables/useManualDownload'
import {
  MANUAL_DOWNLOAD_QUALITY_LABELS,
  buildManualQueueTabs,
  canDeleteManualDownloadTask,
  formatManualDuration,
  formatManualRelativeTime,
  formatManualTotalDuration,
  manualDownloadStatusLabel,
  manualDownloadStatusTone,
  manualQualityLabel,
  manualResourceTypeLabel,
} from '~~/composables/useManualDownloadPresentation'
import type { DownloadTask } from '~~/server/lib/download/queue'
import { useRuns } from '~~/composables/useRuns'

const route = useRoute()
const router = useRouter()
const manualView = ref<'workspace' | 'history'>(route.query.view === 'history' ? 'history' : 'workspace')
const manualPageTabs = [
  { key: 'workspace', label: '工作台' },
  { key: 'history', label: '下载记录' },
]
const manualRuns = useRuns({ type: 'manual_download' })

async function switchManualView(view: string) {
  if (view !== 'workspace' && view !== 'history') return
  manualView.value = view
  void router.replace({ query: { ...route.query, view: view === 'history' ? 'history' : undefined } })
  if (view === 'history' && manualRuns.items.value.length === 0) await manualRuns.fetch()
}

interface ParseHistoryItem {
  id: string
  input: string
  type: 'playlist' | 'album' | 'songs' | null
  title: string
  artist: string
  coverUrl: string
  trackCount: number
  parsedAt: string
}

const {
  parseState,
  inputValue,
  resourceType,
  detectHint,
  title,
  artist,
  coverUrl,
  tracks,
  neteaseId,
  trackCount,
  albumInfo,
  resourceDescription,
  resourceUpdatedAt,
  quality,
  downloadLyrics,
  downloadImages,
  embedMetadata,
  error,
  saveError,
  downloadResult,
  downloading,
  allSelected,
  selectedCount,
  parse,
  download,
  downloadAndSave,
  toggleAll,
  toggleTrack,
} = useManualDownload()

const {
  queueStatus,
  activeTasks,
  failedTasks,
  loading,
  retrying,
  retryingOne,
  retryOne,
  retryAll,
  clearQueue,
  deleteOne,
} = useDownloadQueue({ includeHistory: false })

type QueueTab = 'running' | 'pending' | 'failed'

const activeQueueTab = ref<QueueTab>('running')
const parseHistory = ref<ParseHistoryItem[]>([])
const PARSE_HISTORY_KEY = 'yunplex-manual-parse-history'
const PARSE_HISTORY_LIMIT = 10

const placeholderText = '粘贴网易云链接、歌单 ID、专辑 ID 或歌曲 ID\n例如：https://music.163.com/#/playlist?id=123456\n也支持多首歌曲 ID 换行输入'

const qualityOptions = Object.entries(MANUAL_DOWNLOAD_QUALITY_LABELS).map(([value, label]) => ({ value, label }))
const qualityLabel = computed(() => manualQualityLabel(quality.value))
const qualityShortLabel = computed(() => {
  if (quality.value === 'jymaster') return 'SQ'
  if (quality.value === 'hires') return 'Hi-Res'
  if (quality.value === 'lossless') return '无损'
  return qualityLabel.value
})
const qualityBadgeTone = computed(() => quality.value === 'jymaster' || quality.value === 'hires' || quality.value === 'lossless' ? 'gold' : 'green')
const totalDurationLabel = computed(() => formatManualTotalDuration(
  tracks.value.reduce((total, track) => total + (track.dt || 0), 0),
))
const canSaveAsSource = computed(() => parseState.value === 'preview' && resourceType.value && resourceType.value !== 'songs' && neteaseId.value)

const parsedTargetLine = computed(() => {
  if (neteaseId.value) return `当前目标 ID ${neteaseId.value}，已生成可选择下载列表。`
  return `当前目标为 ${trackCount.value} 首单曲集合，已生成可选择下载列表。`
})

const resultEmptyTitle = computed(() => {
  if (parseState.value === 'parsing') return '正在解析资源'
  return '尚未解析资源'
})

const resultMetaLine = computed(() => {
  if (parseState.value === 'idle') return '解析后会显示资源类型、艺人、专辑和曲目数。'
  if (parseState.value === 'parsing') return '正在拉取网易云元数据。'
  const parts = [manualResourceTypeLabel(resourceType.value)]
  if (artist.value) parts.push(artist.value)
  if (albumInfo.value?.company) parts.push(albumInfo.value.company)
  if (albumInfo.value?.publishTime) parts.push(String(new Date(albumInfo.value.publishTime).getFullYear()))
  return parts.join(' · ')
})

const primaryActionLabel = computed(() => {
  if (parseState.value === 'parsing') return '解析中...'
  if (parseState.value === 'preview') return downloading.value ? '启动中...' : `下载选中 (${selectedCount.value})`
  return '解析并预览'
})
const primaryActionIcon = computed(() => {
  if (parseState.value === 'parsing' || downloading.value) return 'loader'
  if (parseState.value === 'preview') return 'download'
  return 'search'
})
const primaryActionDisabled = computed(() => {
  if (parseState.value === 'parsing' || downloading.value) return true
  if (parseState.value === 'preview') return selectedCount.value === 0
  return !inputValue.value.trim()
})

const queueTabs = computed(() => buildManualQueueTabs(queueStatus.value))
const pendingTasks = computed(() => activeTasks.value.filter((task) => task.status === 'pending'))
const runningTasks = computed(() => activeTasks.value.filter((task) => task.status === 'downloading' || task.status === 'tagging'))
const clearableQueueCount = computed(() =>
  queueStatus.value.pending
  + queueStatus.value.failed,
)

const visibleQueueTasks = computed<DownloadTask[]>(() => {
  if (activeQueueTab.value === 'pending') return pendingTasks.value
  if (activeQueueTab.value === 'failed') return failedTasks.value.slice(0, 8)
  return runningTasks.value
})

const queueEmptyTitle = computed(() => {
  if (activeQueueTab.value === 'pending') return '没有等待中的任务'
  if (activeQueueTab.value === 'failed') return '没有失败任务'
  return '当前没有正在执行的下载'
})

function onPaste(e: ClipboardEvent) {
  const text = e.clipboardData?.getData('text') || ''
  if (URL_PATTERNS.some((p) => p.pattern.test(text))) {
    nextTick(() => {
      if (inputValue.value.trim()) void handleParse()
    })
  }
}

async function handlePrimaryAction() {
  if (parseState.value === 'preview') {
    await handleDownload()
    return
  }
  await handleParse()
}

async function handleParse() {
  await parse()
  rememberParsedResource()
}

async function handleDownload() {
  await download()
  activeQueueTab.value = 'running'
}

async function handleDownloadAndSave() {
  await downloadAndSave()
  activeQueueTab.value = 'running'
}

function resetOptions() {
  quality.value = 'jymaster'
  downloadLyrics.value = true
  downloadImages.value = true
  embedMetadata.value = true
}

function invertSelection() {
  for (const track of tracks.value) {
    track.selected = !track.selected
  }
}

function artistsLine(track: { artists?: { name: string }[] }) {
  return track.artists?.map((item) => item.name).join(' / ') || '-'
}

function formatResourceDate(timestamp: number) {
  return new Date(timestamp).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

function hideBrokenImage(event: Event) {
  const img = event.target as HTMLImageElement
  img.style.display = 'none'
}

function loadParseHistory() {
  try {
    const raw = localStorage.getItem(PARSE_HISTORY_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as ParseHistoryItem[]
    parseHistory.value = parsed.filter((item) => item && item.id && item.title).slice(0, PARSE_HISTORY_LIMIT)
  } catch {
    parseHistory.value = []
  }
}

function saveParseHistory() {
  try {
    localStorage.setItem(PARSE_HISTORY_KEY, JSON.stringify(parseHistory.value.slice(0, PARSE_HISTORY_LIMIT)))
  } catch {
    // localStorage can be unavailable in private contexts.
  }
}

function rememberParsedResource() {
  if (parseState.value !== 'preview' || tracks.value.length === 0) return
  const item: ParseHistoryItem = {
    id: `${resourceType.value || 'resource'}:${neteaseId.value || tracks.value.map((track) => track.id).join(',')}`,
    input: inputValue.value.trim(),
    type: resourceType.value,
    title: title.value || '未命名资源',
    artist: artist.value,
    coverUrl: coverUrl.value,
    trackCount: trackCount.value,
    parsedAt: new Date().toISOString(),
  }
  parseHistory.value = [item, ...parseHistory.value.filter((historyItem) => historyItem.id !== item.id)].slice(0, PARSE_HISTORY_LIMIT)
  saveParseHistory()
}

async function restoreParseHistory(item: ParseHistoryItem) {
  inputValue.value = item.input
  await handleParse()
}

function clearParseHistory() {
  parseHistory.value = []
  saveParseHistory()
}

onMounted(() => {
  loadParseHistory()
  if (manualView.value === 'history') void manualRuns.fetch()
})
</script>

<style scoped>
.manual-page{display:flex;flex-direction:column;gap:1.5rem;padding-bottom:1.5rem}
.manual-history{display:flex;flex-direction:column;gap:1rem}
.manual-history__header{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem}
.manual-history__header h3{margin:0;color:var(--text-primary);font-size:1rem}
.manual-history__header p{margin:.35rem 0 0;color:var(--text-secondary);font-size:.78rem}
.manual-workspace {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding-bottom: 0;
}

.manual-workspace > * {
  flex: none;
}

.manual-heading-line,
.manual-card-header,
.manual-results-header,
.manual-results-actions,
.manual-action-row,
.manual-tabs-header,
.manual-queue-actions,
.manual-task-title-row,
.manual-task-actions {
  display: flex;
  align-items: center;
}

.manual-card-header,
.manual-results-header,
.manual-tabs-header {
  justify-content: space-between;
  gap: 1rem;
}

.manual-card-header h3,
.manual-results-header h3,
.manual-tabs-header h3 {
  margin: 0;
  color: var(--text-primary);
  font-weight: 750;
  letter-spacing: 0;
}

.manual-card-header p,
.manual-tabs-header p,
.manual-resource-meta,
.manual-resource-title,
.manual-task-main p,
.manual-song-cell span,
.manual-config-row small {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.82rem;
  line-height: 1.45;
}

.manual-heading-line {
  flex-wrap: wrap;
  gap: 0.65rem;
}

.manual-heading-line--compact {
  gap: 0.55rem;
}

.manual-count-chip,
.manual-status-badge,
.manual-quality-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
}

.manual-count-chip {
  min-height: 1.75rem;
  padding: 0 0.65rem;
  border-radius: 999px;
  border: 1px solid var(--border-primary);
  background: var(--bg-input);
}

.manual-top-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 16rem;
  gap: 1rem;
  align-items: start;
}

.manual-input-card,
.manual-config-card,
.manual-parse-history-card,
.manual-results-card,
.manual-queue-card {
  padding: 1rem;
}

.manual-input-card,
.manual-config-card {
  display: grid;
  gap: 0.9rem;
  min-width: 0;
}

.manual-help-link {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  min-height: 2.25rem;
  color: var(--accent);
  font-size: 0.78rem;
  font-weight: 700;
  text-decoration: none;
  cursor: pointer;
}

.manual-textarea {
  min-height: 9.25rem;
  resize: vertical;
  padding: 0.95rem 1rem;
  line-height: 1.65;
  background: var(--bg-input);
}

.manual-input-hints {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.manual-input-hints span {
  display: inline-flex;
  min-height: 1.65rem;
  align-items: center;
  gap: 0.3rem;
  padding: 0 0.55rem;
  border-radius: 999px;
  color: var(--text-tertiary);
  background: color-mix(in srgb, var(--bg-input) 72%, transparent);
  font-size: 0.72rem;
}

.manual-input-hints span:first-child {
  color: var(--text-secondary);
  border: 1px solid var(--border-primary);
}

.manual-alert-stack {
  display: grid;
  gap: 0.55rem;
}

.manual-alert {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  gap: 0.65rem;
  padding: 0.72rem 0.8rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-primary);
  font-size: 0.8rem;
}

.manual-alert strong,
.manual-alert span {
  display: block;
  line-height: 1.4;
}

.manual-alert strong {
  color: var(--text-primary);
}

.manual-alert span {
  color: var(--text-secondary);
}

.manual-alert--success {
  color: var(--success);
  border-color: rgba(22, 163, 74, 0.22);
  background: var(--success-soft);
}

.manual-alert--danger {
  color: var(--danger);
  border-color: rgba(220, 38, 38, 0.22);
  background: var(--danger-soft);
}

.manual-action-row,
.manual-results-actions,
.manual-queue-actions,
.manual-task-actions {
  flex-wrap: wrap;
  gap: 0.55rem;
}

.manual-action-row > .btn-primary {
  min-width: 160px;
  min-height: 48px;
  font-size: 0.92rem;
}

.manual-config-card {
  gap: 0.7rem;
  padding: 0.8rem;
  background: color-mix(in srgb, var(--bg-surface) 84%, var(--bg-app));
  box-shadow: var(--shadow-xs);
}

.manual-config-card::before {
  opacity: 0.35;
}

.manual-config-list {
  display: grid;
  gap: 0.45rem;
  min-width: 0;
  width: 100%;
}

.manual-config-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
  width: 100%;
  min-height: 3.2rem;
  padding: 0.55rem 0.6rem;
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  background: var(--bg-input);
  cursor: pointer;
  transition: border-color 150ms ease, background 150ms ease, box-shadow 150ms ease;
}

.manual-config-row > span:nth-child(2) {
  min-width: 0;
}

.manual-config-row:hover {
  border-color: var(--border-secondary);
  background: var(--bg-surface);
}

.manual-config-row strong,
.manual-config-row small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.manual-config-row strong {
  color: var(--text-primary);
  font-size: 0.84rem;
  line-height: 1.35;
}

.manual-config-icon,
.manual-task-cover,
.manual-icon-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.manual-config-icon {
  width: 1.8rem;
  height: 1.8rem;
  border-radius: 0.6rem;
}

.manual-config-icon--accent {
  color: var(--accent);
  background: var(--accent-muted);
}

.manual-config-icon--success {
  color: var(--success);
  background: var(--success-soft);
}

.manual-quality-select {
  width: 6rem;
  max-width: 100%;
  min-height: 2.2rem;
  padding: 0 1.7rem 0 0.65rem;
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  background: var(--bg-surface);
  font-size: 0.78rem;
  cursor: pointer;
}

.manual-reset-button {
  max-width: 100%;
  min-width: 0;
  width: 100%;
}

.manual-parse-history-card {
  display: grid;
  gap: 0.75rem;
}

.manual-parse-history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.manual-parse-history-header h3 {
  margin: 0;
  color: var(--text-primary);
  font-size: 0.92rem;
  font-weight: 750;
}

.manual-parse-history-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.manual-parse-history-title span {
  display: inline-flex;
  min-width: 1.65rem;
  min-height: 1.65rem;
  align-items: center;
  justify-content: center;
  padding: 0 0.45rem;
  border: 1px solid var(--border-primary);
  border-radius: 999px;
  color: var(--accent);
  background: var(--accent-muted);
  font-size: 0.72rem;
  font-weight: 750;
}

.manual-parse-history-header p {
  margin: 0.15rem 0 0;
  color: var(--text-secondary);
  font-size: 0.76rem;
}

.manual-parse-history-list {
  display: flex;
  gap: 0.55rem;
  overflow-x: auto;
  padding: 0.1rem 0 0.4rem;
  overscroll-behavior-x: contain;
  scroll-snap-type: x proximity;
  scrollbar-gutter: stable;
}

.manual-parse-history-item {
  display: grid;
  flex: 0 0 clamp(13rem, 19vw, 17rem);
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 0.55rem;
  min-width: 0;
  min-height: 3.75rem;
  padding: 0.5rem;
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  color: inherit;
  background: var(--bg-input);
  cursor: pointer;
  scroll-snap-align: start;
  text-align: left;
  transition: border-color 150ms ease, background 150ms ease;
}

.manual-parse-history-item:hover {
  border-color: var(--border-secondary);
  background: var(--bg-hover);
}

.manual-parse-history-cover {
  width: 2.65rem;
  height: 2.65rem;
  overflow: hidden;
  border-radius: 0.55rem;
  border: 1px solid var(--border-primary);
  background: var(--bg-surface);
}

.manual-parse-history-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.manual-parse-history-cover--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
}

.manual-parse-history-copy {
  display: grid;
  min-width: 0;
  gap: 0.18rem;
}

.manual-parse-history-copy strong,
.manual-parse-history-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.manual-parse-history-copy strong {
  color: var(--text-primary);
  font-size: 0.8rem;
}

.manual-parse-history-copy small {
  color: var(--text-tertiary);
  font-size: 0.7rem;
}

.manual-results-card,
.manual-queue-card {
  display: grid;
  grid-template-rows: auto minmax(0, auto);
  gap: 0;
  overflow: hidden;
}

.manual-results-header,
.manual-tabs-header {
  padding-bottom: 0.95rem;
  border-bottom: 1px solid var(--border-primary);
}

.manual-results-header--parsed {
  min-height: 192px;
  align-items: stretch;
  padding: 0 0 1rem;
}

.manual-results-header--parsed .manual-resource-summary {
  flex: 1;
}

.manual-results-header--parsed .manual-results-actions {
  align-content: flex-end;
  justify-content: flex-end;
  max-width: 20rem;
}

.manual-resource-summary {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 0.85rem;
  min-width: 0;
}

.manual-cover {
  width: 4.25rem;
  height: 4.25rem;
  overflow: hidden;
  border-radius: 0.75rem;
  border: 1px solid var(--border-primary);
  background: var(--bg-input);
}

.manual-results-header--parsed .manual-cover {
  width: 160px;
  height: 160px;
  max-height: 160px;
  border-radius: 0.85rem;
  box-shadow: var(--shadow-sm);
}

.manual-cover img {
  display: block;
  width: 100%;
  height: 100%;
  max-height: 160px;
  object-fit: cover;
}

.manual-cover--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-tertiary);
}

.manual-resource-title {
  margin-top: 0.25rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-weight: 700;
}

.manual-results-header--parsed .manual-resource-title {
  margin-top: 0.55rem;
  color: var(--text-primary);
  font-size: 1.25rem;
  font-weight: 800;
}

.manual-resource-meta {
  margin-top: 0.15rem;
}

.manual-resource-description {
  display: -webkit-box;
  max-width: 58rem;
  margin: 0.45rem 0 0;
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: 0.76rem;
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.manual-resource-facts {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin-top: 0.75rem;
}

.manual-resource-facts span {
  display: inline-flex;
  min-height: 1.7rem;
  align-items: center;
  padding: 0 0.6rem;
  border-radius: 999px;
  color: var(--text-secondary);
  background: var(--bg-input);
  border: 1px solid var(--border-primary);
  font-size: 0.74rem;
}

.manual-resource-facts strong {
  margin-right: 0.2rem;
  color: var(--text-primary);
}

.manual-result-download {
  min-width: 9.5rem;
  min-height: 2.75rem;
}

.manual-state-panel {
  display: flex;
  min-height: 10rem;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.55rem;
  padding: 1.25rem;
  color: var(--text-tertiary);
  text-align: center;
  border: 1px dashed var(--border-primary);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-input) 70%, transparent);
}

.manual-state-panel strong {
  color: var(--text-primary);
  font-size: 0.95rem;
}

.manual-state-panel span {
  color: var(--text-secondary);
  font-size: 0.82rem;
}

.manual-state-panel--result-empty {
  min-height: 200px;
}

.manual-state-panel--queue-empty {
  min-height: 140px;
}

.manual-state-panel--compact {
  min-height: 10rem;
  margin-top: 0.8rem;
}

.manual-table-shell {
  width: 100%;
  overflow-x: auto;
}

.manual-track-list {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
}

.manual-track-list-header {
  display: flex;
  min-height: 3.75rem;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.75rem 0;
}

.manual-track-list-header h4,
.manual-track-list-header p {
  margin: 0;
}

.manual-track-list-header h4 {
  color: var(--text-primary);
  font-size: 0.9rem;
  font-weight: 750;
}

.manual-track-list-header p {
  margin-top: 0.15rem;
  color: var(--text-tertiary);
  font-size: 0.74rem;
}

.manual-track-list-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.manual-track-table-shell {
  height: clamp(360px, 52vh, 600px);
  max-height: 600px;
  overflow: auto;
  overscroll-behavior: contain;
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  border-bottom: 1px solid var(--border-primary);
  scrollbar-gutter: stable;
}

.manual-track-table-shell .manual-track-table thead {
  position: sticky;
  top: 0;
  z-index: 2;
}

.manual-track-table {
  width: 100%;
  min-width: 760px;
  border-collapse: collapse;
}

.manual-track-table th,
.manual-track-table td {
  height: 3.05rem;
  padding: 0.65rem 0.75rem;
  border-bottom: 1px solid var(--border-primary);
  color: var(--text-secondary);
  font-size: 0.8rem;
  text-align: left;
  vertical-align: middle;
}

.manual-track-table th {
  color: var(--text-tertiary);
  font-weight: 750;
  background: color-mix(in srgb, var(--bg-input) 74%, transparent);
}

.manual-track-table tbody tr {
  transition: background 150ms ease;
}

.manual-track-table tbody tr:hover {
  background: var(--bg-hover);
}

.manual-col-check {
  width: 3rem;
}

.manual-row-muted {
  opacity: 0.55;
}

.manual-table-index {
  width: 3.25rem;
  color: var(--text-tertiary);
}

.manual-song-cell {
  display: grid;
  gap: 0.22rem;
  min-width: 0;
}

.manual-song-cell strong {
  overflow: hidden;
  color: var(--text-primary);
  font-size: 0.84rem;
  font-weight: 750;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.manual-quality-badge {
  min-height: 1.3rem;
  margin-right: 0.3rem;
  padding: 0 0.42rem;
  border-radius: 0.38rem;
  font-size: 0.68rem;
  font-weight: 800;
}

.manual-quality-badge--gold {
  color: #b7791f;
  background: rgba(245, 158, 11, 0.14);
}

.manual-quality-badge--green {
  color: var(--success);
  background: var(--success-soft);
}

.manual-results-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding-top: 0.9rem;
  color: var(--text-secondary);
  font-size: 0.82rem;
}

.manual-table-skeleton {
  display: grid;
  gap: 0.55rem;
  padding: 0.9rem 0 0;
}

.manual-skeleton-row {
  height: 3rem;
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-input) 82%, transparent);
  animation: manual-pulse 1.2s ease-in-out infinite;
}

.manual-tab-strip {
  display: flex;
  gap: 0.5rem;
  padding: 0.9rem 0 0.8rem;
  overflow-x: auto;
}

.manual-tab-button {
  display: inline-flex;
  min-height: 2.35rem;
  align-items: center;
  justify-content: center;
  gap: 0.45rem;
  padding: 0 0.85rem;
  border: 1px solid var(--border-primary);
  border-radius: 999px;
  color: var(--text-secondary);
  background: var(--bg-input);
  font-size: 0.8rem;
  font-weight: 750;
  cursor: pointer;
  white-space: nowrap;
  transition: color 150ms ease, border-color 150ms ease, background 150ms ease, box-shadow 150ms ease;
}

.manual-tab-button span {
  min-width: 1.25rem;
  height: 1.25rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  color: var(--accent);
  background: var(--accent-muted);
  font-size: 0.72rem;
}

.manual-tab-button--active {
  color: var(--accent);
  border-color: color-mix(in srgb, var(--accent) 42%, transparent);
  background: var(--accent-muted);
  box-shadow: 0 10px 26px var(--accent-glow);
}

.manual-task-list {
  display: grid;
  gap: 0.55rem;
}

.manual-task-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 0.75rem;
  min-height: 4.75rem;
  padding: 0.75rem;
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  background: var(--bg-input);
}

.manual-task-cover {
  width: 2.6rem;
  height: 2.6rem;
  border-radius: 0.7rem;
  color: var(--accent);
  background: var(--accent-muted);
}

.manual-task-main {
  min-width: 0;
}

.manual-task-title-row {
  justify-content: flex-start;
  gap: 0.55rem;
}

.manual-task-title-row strong {
  overflow: hidden;
  color: var(--text-primary);
  font-size: 0.88rem;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.manual-task-error {
  color: var(--danger) !important;
}

.manual-task-side {
  display: grid;
  gap: 0.2rem;
  text-align: right;
}

.manual-task-side span {
  color: var(--text-primary);
  font-weight: 800;
}

.manual-task-side small {
  color: var(--text-tertiary);
  font-size: 0.74rem;
}

.manual-progress-line {
  height: 0.42rem;
  margin-top: 0.55rem;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--border-primary) 60%, transparent);
}

.manual-progress-line div {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--accent), var(--accent-soft));
  transition: width 220ms ease;
}

.manual-status-badge {
  min-height: 1.55rem;
  padding: 0 0.55rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 800;
}

.manual-status-badge--idle {
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--text-tertiary) 12%, transparent);
}

.manual-status-badge--running {
  color: var(--accent);
  background: var(--accent-muted);
}

.manual-status-badge--success {
  color: var(--success);
  background: var(--success-soft);
}

.manual-status-badge--danger {
  color: var(--danger);
  background: var(--danger-soft);
}

.manual-icon-action {
  width: 2.25rem;
  height: 2.25rem;
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  background: var(--bg-surface);
  cursor: pointer;
  transition: color 150ms ease, background 150ms ease, border-color 150ms ease;
}

.manual-icon-action:hover:not(:disabled) {
  color: var(--text-primary);
  border-color: var(--border-secondary);
  background: var(--bg-hover);
}

.manual-icon-action:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

:global(.dark .manual-workspace) {
  --manual-page-bg: #020617;
  --manual-card-bg: #0f172a;
  --manual-input-bg: #111827;
}

:global(.dark .manual-workspace)::before {
  content: none;
}

:global(.dark .manual-workspace .manual-input-card),
:global(.dark .manual-workspace .manual-parse-history-card),
:global(.dark .manual-workspace .manual-results-card),
:global(.dark .manual-workspace .manual-queue-card) {
  background: var(--manual-card-bg) !important;
}

:global(.dark .manual-workspace .manual-config-card) {
  background: #0b1324 !important;
}

:global(.dark .manual-workspace .manual-textarea),
:global(.dark .manual-workspace .manual-config-row),
:global(.dark .manual-workspace .manual-parse-history-item),
:global(.dark .manual-workspace .manual-task-row),
:global(.dark .manual-workspace .manual-state-panel),
:global(.dark .manual-workspace .manual-resource-facts span) {
  background: var(--manual-input-bg) !important;
}

@keyframes manual-pulse {
  0%,
  100% {
    opacity: 0.55;
  }
  50% {
    opacity: 0.95;
  }
}

@media (max-width: 1279px) {
  .manual-top-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 767px) {
  .manual-card-header,
  .manual-results-header,
  .manual-tabs-header,
  .manual-results-footer {
    align-items: flex-start;
    flex-direction: column;
  }

  .manual-results-actions,
  .manual-action-row,
  .manual-queue-actions {
    justify-content: flex-start;
    width: 100%;
  }

  .manual-action-row .btn,
  .manual-results-footer .btn,
  .manual-reset-button {
    width: 100%;
  }

  .manual-task-row {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .manual-results-header--parsed {
    min-height: 0;
  }

  .manual-results-header--parsed .manual-resource-summary {
    width: 100%;
  }

  .manual-results-header--parsed .manual-cover {
    width: 6rem;
    height: 6rem;
  }

  .manual-results-header--parsed .manual-results-actions {
    max-width: none;
  }

  .manual-track-list-header {
    align-items: flex-start;
    flex-direction: column;
  }

  .manual-track-list-actions {
    width: 100%;
  }

  .manual-track-list-actions .btn {
    flex: 1;
  }

  .manual-track-table-shell {
    height: min(56vh, 32rem);
    min-height: 20rem;
  }

  .manual-result-download {
    width: 100%;
  }

  .manual-parse-history-item {
    flex-basis: min(82vw, 17rem);
  }

  .manual-task-side,
  .manual-task-actions {
    grid-column: 2;
    justify-content: flex-start;
    text-align: left;
  }
}

@media (prefers-reduced-motion: reduce) {
  .manual-skeleton-row,
  .manual-progress-line div,
  .manual-track-table tbody tr,
  .manual-tab-button,
  .manual-config-row,
  .manual-icon-action {
    animation: none;
    transition: none;
  }
}
</style>
