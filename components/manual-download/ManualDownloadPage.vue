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
import { useManualDownloadPage } from '~~/composables/useManualDownloadPage'

const {
  activeQueueTab, allSelected, artist, artistsLine, canDeleteManualDownloadTask, canSaveAsSource, clearableQueueCount, clearParseHistory,
  clearQueue, coverUrl, deleteOne, detectHint, downloadImages, downloading, downloadLyrics, downloadResult,
  embedMetadata, error, formatManualDuration, formatManualRelativeTime, formatResourceDate, handleDownload, handleDownloadAndSave, handleParse,
  handlePrimaryAction, hideBrokenImage, inputValue, invertSelection, loading, manualDownloadStatusLabel, manualDownloadStatusTone, manualPageTabs,
  manualResourceTypeLabel, manualRuns, manualView, onPaste, parsedTargetLine, parseHistory, parseState, placeholderText,
  primaryActionDisabled, primaryActionIcon, primaryActionLabel, quality, qualityBadgeTone, qualityLabel, qualityOptions, qualityShortLabel,
  queueEmptyTitle, queueStatus, queueTabs, resetOptions, resourceDescription, resourceType, resourceUpdatedAt, restoreParseHistory,
  resultEmptyTitle, resultMetaLine, retryAll, retrying, retryingOne, retryOne, saveError, selectedCount,
  switchManualView, title, toggleAll, toggleTrack, totalDurationLabel, trackCount, tracks, visibleQueueTasks,
} = useManualDownloadPage()
</script>

<style scoped>
@import '~/assets/css/pages/manual-download-workspace.css';
@import '~/assets/css/pages/manual-download-queue.css';
</style>
