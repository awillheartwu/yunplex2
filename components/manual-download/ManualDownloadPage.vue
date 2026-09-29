<template>
  <div class="manual-page">
    <PageHeader
      description="把一段链接，变成音乐库里的一部分。"
    />

    <ManualDownloadSteps :parse-state="parseState" :dirty="inputChanged" :downloading="downloading" :submitted="Boolean(downloadResult)" :error="error" :has-warnings="resourceFailures.length > 0 || Boolean(downloadResult && !downloadResult.total)" :empty="tracks.length === 0" />
    <div class="manual-workspace">
      <section v-if="parseState !== 'preview' || inputExpanded" class="section-card manual-input-card" aria-labelledby="manual-input-title">
        <header class="manual-card-header">
          <div><h2 id="manual-input-title">{{ parseState === 'preview' ? '音乐来源' : '输入音乐来源' }}</h2><p>{{ parseState === 'preview' ? title : '支持网易云歌曲、歌单或专辑链接，也支持资源 ID。' }}</p></div>
          <button v-if="parseState === 'preview' && !downloadResult" class="btn btn-secondary" :disabled="downloading" @click="inputExpanded = !inputExpanded">{{ inputExpanded ? '收起输入' : '修改链接' }}</button>
          <details v-if="parseState !== 'preview' || inputExpanded" class="manual-help"><summary class="btn btn-ghost">输入帮助<AppIcon name="info" :size="14" /></summary><p>在网易云资源页面选择“分享 → 复制链接”。粘贴链接会自动解析；多个歌曲 ID 可用换行、逗号或分号分隔。</p></details>
        </header>
        <form v-if="parseState !== 'preview' || inputExpanded" class="manual-input-form" @submit.prevent="handleParse">
          <label for="manual-download-input">网易云链接或资源 ID</label>
          <textarea id="manual-download-input" v-model="inputValue" class="form-input manual-textarea" aria-label="网易云链接、歌单 ID、专辑 ID 或歌曲 ID" aria-describedby="manual-input-hint" :placeholder="placeholderText" :disabled="parseState === 'parsing' || downloading" :aria-invalid="Boolean(error && parseState === 'idle')" @keydown.enter.ctrl.prevent="handleParse" @keydown.enter.meta.prevent="handleParse" @paste="onPaste" />
          <div class="manual-action-row">
            <p id="manual-input-hint">多个歌曲 ID 可分行输入 · Ctrl / ⌘ + Enter 解析</p>
            <button class="btn btn-primary" type="submit" :disabled="!inputValue.trim() || parseState === 'parsing' || downloading"><AppIcon :name="parseState === 'parsing' ? 'loader' : 'search'" :size="16" :class="{ 'animate-spin': parseState === 'parsing' }" />{{ parseState === 'parsing' ? '解析中…' : '解析并预览' }}</button>
          </div>
        </form>
        <p v-if="inputChanged" class="manual-input-changed" role="status">输入已修改，请重新解析后再下载。</p>
      </section>

      <details v-if="!downloadResult" class="manual-config-card" aria-label="下载配置"><summary class="manual-options-summary"><AppIcon name="settings" :size="16" /><span>下载选项</span><small>{{ qualityLabel }} · {{ downloadLyrics ? '含歌词' : '无歌词' }} · {{ embedMetadata ? '写入标签' : '不写标签' }}</small><AppIcon name="chevronDown" :size="14" /></summary>
        <div class="manual-config-list">
          <label class="manual-config-row" for="manual-quality">
            <span class="manual-config-icon manual-config-icon--accent">
              <AppIcon name="music" :size="15" />
            </span>
            <span>
              <strong>音质</strong>
            </span>
            <select id="manual-quality" v-model="quality" :disabled="downloading" class="form-input manual-quality-select" aria-label="选择下载音质">
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
            <input v-model="downloadLyrics" :disabled="downloading" type="checkbox" aria-label="下载歌词" />
          </label>

          <label class="manual-config-row manual-config-row--toggle">
            <span class="manual-config-icon manual-config-icon--success">
              <AppIcon name="album" :size="15" />
            </span>
            <span>
              <strong>下载封面</strong>
              <small>{{ downloadImages ? '已开启' : '已关闭' }}</small>
            </span>
            <input v-model="downloadImages" :disabled="downloading" type="checkbox" aria-label="下载封面" />
          </label>

          <label class="manual-config-row manual-config-row--toggle">
            <span class="manual-config-icon manual-config-icon--accent">
              <AppIcon name="edit" :size="15" />
            </span>
            <span>
              <strong>写入元数据</strong>
              <small>{{ embedMetadata ? '已开启' : '已关闭' }}</small>
            </span>
            <input v-model="embedMetadata" :disabled="downloading" type="checkbox" aria-label="写入元数据" />
          </label>
        </div>

        <button class="btn btn-secondary manual-reset-button" type="button" :disabled="downloading" @click="resetOptions">
          <AppIcon name="rotate-ccw" :size="14" />
          <span>恢复默认设置</span>
        </button>
      </details>

        <div v-if="error || saveError || resourceFailures.length || downloadResult" class="manual-alert-stack" aria-live="polite">
          <div v-if="downloadResult" class="manual-alert manual-submitted" :class="downloadResult.total ? 'manual-alert--success' : 'manual-alert--warning'" role="status">
            <AppIcon :name="downloadResult.total ? 'checkCircle' : 'warn'" :size="20" />
            <div><h2>{{ downloadResult.total ? `已提交 ${downloadResult.total} 首歌曲` : '本次没有加入歌曲' }}</h2><p>提交结果已返回。文件下载与后续状态请在活动中查看。</p></div>
            <div class="manual-submitted__actions"><NuxtLink v-if="downloadResult.total" class="btn btn-primary" to="/task-center">查看活动<AppIcon name="arrowRight" :size="15" /></NuxtLink><button class="btn btn-secondary" @click="startNew">继续添加</button></div>
          </div>

          <div v-if="resourceFailures.length" class="manual-alert manual-alert--warning">
            <AppIcon name="warn" :size="16" />
            <div>
              <strong>{{ resourceFailures.length }} 首歌曲未能加入</strong>
              <span>
                ID {{ resourceFailures.slice(0, 5).map(item => item.songId).join('、') }}
                <template v-if="resourceFailures.length > 5">等</template>
                ：{{ resourceFailures[0]?.reason }}
              </span>
            </div>
          </div>

          <div v-if="saveError" class="manual-alert manual-alert--danger">
            <AppIcon name="warn" :size="16" />
            <div>
              <strong>保存同步源失败</strong>
              <span>{{ saveError }}</span>
            </div>
            <button class="icon-button manual-icon-action" type="button" aria-label="关闭保存同步源错误" @click="saveError = ''">
              <AppIcon name="x" :size="14" />
            </button>
          </div>

          <div v-if="error" class="manual-alert manual-alert--danger" role="alert">
            <AppIcon name="warn" :size="16" />
            <div>
              <strong>{{ parseState === 'preview' ? '提交失败，请重试' : '解析失败，请检查输入' }}</strong>
              <span>{{ error }}</span>
            </div>
          </div>
        </div>

    <section v-if="parseHistory.length > 0 && parseState === 'idle'" class="section-card manual-parse-history-card">
      <div class="manual-parse-history-header">
        <div>
          <div class="manual-parse-history-title">
            <h2>最近解析</h2>
            <span>{{ parseHistory.length }}</span>
          </div>
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

    <section v-if="parseState !== 'idle'" class="section-card manual-results-card">
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
            <span class="manual-resource-eyebrow">{{ parseState === 'parsing' ? '正在获取资源' : '解析结果' }}</span>
            <h2 class="manual-resource-title" :title="title || undefined">{{ parseState === 'parsing' ? '正在解析…' : title }}</h2>
            <p class="manual-resource-meta">{{ resultMetaLine }}<template v-if="parseState === 'preview'"> · {{ tracks.length }} 首 · {{ totalDurationLabel }}</template></p>
            <p v-if="parseState === 'preview' && resourceDescription" class="manual-resource-description">{{ resourceDescription }}</p>
          </div>
        </div>
        <button v-if="parseState === 'preview' && !downloadResult && !inputExpanded" class="btn btn-secondary" :disabled="downloading" @click="inputExpanded = true">修改链接</button>
      </div>

      <div v-if="parseState === 'parsing'" class="manual-table-skeleton" aria-live="polite">
        <div v-for="row in 7" :key="row" class="manual-skeleton-row" />
      </div>

      <div v-else class="manual-track-list">
        <div class="manual-track-list-header">
          <div>
            <h3>{{ downloadResult ? '已确认歌曲' : '确认要下载的歌曲' }}</h3>
            <p aria-live="polite">已选择 {{ selectedCount }} / {{ tracks.length }} 首</p>
          </div>
          <div class="manual-track-list-actions">
            <button
              class="btn btn-secondary btn-xs"
              type="button"
              :disabled="tracks.length === 0 || downloading || Boolean(downloadResult)"
              @click="toggleAll"
            >
              <AppIcon name="check" :size="13" />
              <span>{{ allSelected ? '取消全选' : '全部选择' }}</span>
            </button>
            <button
              class="btn btn-secondary btn-xs"
              type="button"
              :disabled="tracks.length === 0 || downloading || Boolean(downloadResult)"
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
                    :disabled="tracks.length === 0 || downloading || Boolean(downloadResult)"
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
              <tr v-for="(track, index) in pageTracks" :key="track.id" :class="{ 'manual-row-muted': !track.selected }">
                <td>
                  <label class="sr-only" :for="`manual-track-${track.id}`">选择 {{ track.name }}</label>
                  <input
                    :id="`manual-track-${track.id}`"
                    type="checkbox"
                    :checked="track.selected"
                    :disabled="downloading || Boolean(downloadResult)"
                    @change="toggleTrack(track.id)"
                  />
                </td>
                <td class="manual-table-index">{{ trackOffset + index + 1 }}</td>
                <td>
                  <div class="manual-song-cell">
                    <strong :title="track.name">{{ track.name }}</strong>

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
        <PageNavigator :page="trackPage" :page-size="trackPageSize" :total="tracks.length" label="歌曲" @change="changeTrackPage" />
        <div v-if="!downloadResult" class="manual-submit-bar">
          <p>已选 <strong>{{ selectedCount }}</strong> 首 · {{ qualityLabel }}<span v-if="inputChanged"> · 请先重新解析</span></p>
          <div class="manual-results-actions">
            <button v-if="canSaveAsSource" class="btn btn-secondary" type="button" :disabled="downloading || !selectedCount || inputChanged" @click="handleDownloadAndSave"><AppIcon name="save" :size="15" />下载并保存为同步源</button>
            <button class="btn btn-primary" type="button" :disabled="downloading || !selectedCount || inputChanged" @click="handleDownload"><AppIcon :name="downloading ? 'loader' : 'download'" :size="16" :class="{ 'animate-spin': downloading }" />{{ downloading ? '提交中…' : `下载 ${selectedCount} 首` }}</button>
          </div>
        </div>
      </div>

    </section>

    </div>
  </div>
</template>

<script setup lang="ts">
import { useManualDownloadPage } from '~~/composables/useManualDownloadPage'

const {
  allSelected, artistsLine, canSaveAsSource, clearParseHistory, coverUrl, downloadImages, downloading, downloadLyrics, downloadResult,
  embedMetadata, error, formatManualDuration, formatManualRelativeTime, handleDownload, handleDownloadAndSave, handleParse, inputChanged, startNew,
  hideBrokenImage, inputValue, invertSelection, manualResourceTypeLabel, onPaste, parseHistory, parseState, placeholderText,
  quality, qualityLabel, qualityOptions, resetOptions, resourceDescription, resourceFailures, restoreParseHistory, resultMetaLine, saveError, selectedCount,
  title, toggleAll, toggleTrack, totalDurationLabel, tracks,
} = useManualDownloadPage()
const inputExpanded = ref(false)
watch(parseState, state => { if (state === 'preview') inputExpanded.value = false })
const trackPageSize = 100
const trackPage = ref(1)
const trackOffset = computed(() => (trackPage.value - 1) * trackPageSize)
const pageTracks = computed(() => tracks.value.slice(trackOffset.value, trackOffset.value + trackPageSize))
watch(tracks, () => { trackPage.value = 1 })
function changeTrackPage(page: number) {
  trackPage.value = page
  const table = document.querySelector('.manual-track-table-shell')
  table?.scrollTo({ top: 0 })
  table?.scrollIntoView({ block: 'start' })
}
</script>

<style scoped>
@import '~/assets/css/pages/manual-download-workspace.css';
@import '~/assets/css/pages/manual-download-input.css';
@import '~/assets/css/pages/manual-download-results.css';
</style>
