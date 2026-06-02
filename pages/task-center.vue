<template>
  <div>
    <h2 class="text-sm font-semibold" style="color: var(--text-primary)">任务中心</h2>
    <p class="text-2xs text-muted mt-0.5 mb-6">统一查看同步与下载的运行状态、历史记录和失败处理</p>

    <!-- Tab bar -->
    <div class="flex gap-1 mb-6" style="border-bottom: 1px solid var(--border-primary)">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="px-4 py-2 text-sm font-medium transition-colors duration-150 border-b-2 -mb-px"
        :class="activeTab === tab.key
          ? 'border-accent text-accent'
          : 'border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'"
        @click="switchTab(tab.key)"
      >{{ tab.label }}</button>
    </div>

    <!-- ═══ Tab 1: 运行中 ═══ -->
    <div v-if="activeTab === 'running'" class="flex gap-6" style="min-height: 60vh">
      <!-- Left: Sync Progress (60%) -->
      <div class="flex-1 space-y-4" style="flex: 3">
        <div class="section-card p-5">
          <h3 class="text-sm font-semibold mb-4">同步状态</h3>

          <!-- Running state -->
          <template v-if="syncState?.isRunning">
            <div class="space-y-4">
              <div class="flex items-center gap-3">
                <StatusBadge status="running" />
                <span class="text-sm font-medium text-[var(--text-primary)]">{{ stageLabel }}</span>
              </div>

              <div v-if="syncState.progress" class="space-y-2">
                <div class="flex items-center justify-between text-xs text-muted">
                  <span>进度</span>
                  <span>{{ syncState.progress.current }} / {{ syncState.progress.total }}</span>
                </div>
                <div class="w-full h-2 rounded-full overflow-hidden" style="background: var(--border-primary)">
                  <div
                    class="h-full rounded-full transition-all duration-500"
                    style="background: linear-gradient(135deg, #6366f1, #8b5cf6)"
                    :style="{ width: progressPct + '%' }"
                  />
                </div>
              </div>

              <div v-if="syncState.currentSong" class="flex items-center gap-2 text-xs text-muted">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" class="shrink-0">
                  <path d="M13 2.5L5 8l8 5.5V2.5z" fill="var(--text-tertiary)" />
                </svg>
                <span class="truncate">{{ syncState.currentSong }}</span>
              </div>

              <div v-if="syncState.startedAt" class="text-2xs text-muted-deep">
                开始于 {{ formatTime(syncState.startedAt) }}
              </div>

              <button class="btn btn-danger btn-sm" @click="handleCancelSync">
                取消同步
              </button>
            </div>
          </template>

          <!-- Idle state -->
          <template v-else>
            <div class="space-y-4">
              <StatusBadge status="idle" />
              <p class="text-xs text-muted">当前无正在进行的同步任务</p>

              <!-- Last run summary -->
              <div v-if="syncState?.lastSyncAt" class="grid grid-cols-3 gap-3">
                <div class="rounded-lg p-3 text-center" style="background:var(--bg-app);border:1px solid var(--border-primary)">
                  <p class="text-lg font-semibold" :class="syncState.lastSyncResult === 'success' ? 'text-success' : 'text-danger'">
                    {{ syncState.lastSyncResult === 'success' ? '成功' : '失败' }}
                  </p>
                  <p class="text-2xs text-muted-deep">上次结果</p>
                </div>
                <div class="rounded-lg p-3 text-center" style="background:var(--bg-app);border:1px solid var(--border-primary)">
                  <p class="text-lg font-semibold text-[var(--text-primary)]">{{ syncState.syncCount ?? 0 }}</p>
                  <p class="text-2xs text-muted-deep">同步次数</p>
                </div>
                <div class="rounded-lg p-3 text-center" style="background:var(--bg-app);border:1px solid var(--border-primary)">
                  <p class="text-lg font-semibold text-muted">{{ formatTime(syncState.lastSyncAt) }}</p>
                  <p class="text-2xs text-muted-deep">上次同步</p>
                </div>
              </div>

              <div v-if="syncError" class="text-xs text-danger bg-[#e74c3c10] rounded-lg p-3 border border-[#e74c3c20]">
                {{ syncError }}
              </div>

              <!-- Quick actions -->
              <div class="flex items-center gap-2 pt-2">
                <NuxtLink to="/sync-sources" class="btn btn-secondary btn-sm text-xs">去同步源</NuxtLink>
                <NuxtLink to="/manual-download" class="btn btn-secondary btn-sm text-xs">去手动下载</NuxtLink>
                <button class="btn btn-ghost btn-sm text-xs" @click="switchTab('failures')">查看失败项目</button>
              </div>
            </div>
          </template>
        </div>

        <!-- Sync failures preview -->
        <div v-if="syncState?.failures && syncState.failures.length > 0" class="section-card overflow-hidden">
          <div class="section-header flex items-center justify-between">
            <span>最近失败 ({{ syncState.failures.length }})</span>
            <button class="text-2xs text-accent hover:underline" @click="switchTab('failures')">查看全部</button>
          </div>
          <div class="divide-y divide-[var(--border-primary)]">
            <div v-for="(f, i) in syncState.failures.slice(0, 5)" :key="i" class="px-5 py-2.5 flex items-center justify-between gap-4">
              <div class="min-w-0">
                <p class="text-xs font-medium text-[var(--text-primary)] truncate">{{ f.songName }}</p>
                <p class="text-2xs text-danger line-clamp-1">{{ f.reason }}</p>
              </div>
              <span class="text-2xs text-muted-deep shrink-0">{{ formatTime(f.timestamp) }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Right: Download Queue (40%) -->
      <div class="space-y-4" style="flex: 2">
        <div class="section-card p-5">
          <h3 class="text-sm font-semibold mb-4">下载队列</h3>

          <!-- Queue stats -->
          <div class="grid grid-cols-5 gap-2 mb-4">
            <div class="text-center p-2 rounded-lg" style="background:var(--bg-app)">
              <p class="text-sm font-semibold text-[var(--text-primary)]">{{ queueStatus.pending }}</p>
              <p class="text-2xs text-muted-deep">等待</p>
            </div>
            <div class="text-center p-2 rounded-lg" style="background:var(--bg-app)">
              <p class="text-sm font-semibold text-accent">{{ queueStatus.downloading }}</p>
              <p class="text-2xs text-muted-deep">下载中</p>
            </div>
            <div class="text-center p-2 rounded-lg" style="background:var(--bg-app)">
              <p class="text-sm font-semibold" style="color:#818cf8">{{ queueStatus.tagging }}</p>
              <p class="text-2xs text-muted-deep">标记中</p>
            </div>
            <div class="text-center p-2 rounded-lg" style="background:var(--bg-app)">
              <p class="text-sm font-semibold text-success">{{ queueStatus.done }}</p>
              <p class="text-2xs text-muted-deep">已完成</p>
            </div>
            <div class="text-center p-2 rounded-lg" style="background:var(--bg-app)">
              <p class="text-sm font-semibold text-danger">{{ queueStatus.failed }}</p>
              <p class="text-2xs text-muted-deep">失败</p>
            </div>
          </div>

          <!-- Active downloads -->
          <div v-if="dqActiveTasks.length > 0" class="space-y-2">
            <p class="text-2xs text-muted-deep mb-2">进行中 ({{ dqActiveTasks.length }})</p>
            <div
              v-for="task in dqActiveTasks"
              :key="task.id"
              class="flex items-center gap-3 p-3 rounded-lg"
              style="background:var(--bg-app);border:1px solid var(--border-primary)"
            >
              <div class="flex-1 min-w-0">
                <p class="text-xs font-medium text-[var(--text-primary)] truncate">{{ task.songName }}</p>
                <p class="text-2xs text-muted truncate">{{ task.artist }}</p>
                <div class="mt-1.5 w-full h-1 rounded-full overflow-hidden" style="background: var(--border-primary)">
                  <div
                    class="h-full rounded-full transition-all duration-300"
                    :class="task.status === 'tagging' ? '' : 'progress-bar'"
                    :style="task.status === 'tagging'
                      ? 'background: linear-gradient(135deg, #6366f1, #8b5cf6); width: 100%'
                      : { width: (task.progress * 100) + '%', background: 'var(--accent)' }"
                  />
                </div>
              </div>
              <span class="text-2xs shrink-0" :class="task.status === 'tagging' ? 'text-accent' : 'text-muted'">
                {{ task.status === 'tagging' ? '标记中' : Math.round(task.progress * 100) + '%' }}
              </span>
            </div>
          </div>

          <!-- Empty queue -->
          <div v-else class="text-center py-8">
            <p class="text-xs text-muted">队列为空</p>
            <p class="text-2xs text-muted-deep mt-1">暂无进行中的下载任务</p>
          </div>
        </div>

        <!-- Failed downloads (mini) -->
        <div v-if="dqFailedTasks.length > 0" class="section-card overflow-hidden">
          <div class="section-header flex items-center justify-between">
            <span>最近失败 ({{ dqFailedTasks.length }})</span>
            <button class="text-2xs text-accent hover:underline" @click="switchTab('download-history')">查看全部</button>
          </div>
          <div class="divide-y divide-[var(--border-primary)]">
            <div v-for="task in dqFailedTasks.slice(0, 5)" :key="task.id" class="px-4 py-2.5 flex items-center justify-between gap-3">
              <div class="min-w-0">
                <p class="text-xs text-[var(--text-primary)] truncate">{{ task.songName }}</p>
                <p class="text-2xs text-danger truncate">{{ task.error || '下载失败' }}</p>
              </div>
              <button
                class="text-2xs px-2 py-1 rounded transition-colors shrink-0 cursor-pointer"
                :class="dqRetryingOne === task.id
                  ? 'text-muted-deep cursor-not-allowed'
                  : 'text-accent hover:bg-[var(--accent-muted)]'"
                :disabled="dqRetryingOne === task.id"
                @click="dqRetryOne(task.id)"
              >{{ dqRetryingOne === task.id ? '重试中' : '重试' }}</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══ Tab 2: 同步历史 ═══ -->
    <div v-else-if="activeTab === 'sync-history'" class="space-y-4">
      <!-- Job detail view -->
      <template v-if="selectedJob">
        <JobDetail :job="selectedJob" @back="clearSelectedJob" />
      </template>

      <!-- Job list view -->
      <template v-else>
        <!-- Filters bar -->
        <div class="flex items-center gap-2 flex-wrap">
          <button
            v-for="t in typeTabs"
            :key="t.value"
            class="text-xs px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
            :class="jobsActiveType === t.value
              ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] font-medium'
              : 'text-muted hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]'"
            @click="jobsSetType(t.value)"
          >{{ t.label }}</button>

          <span class="text-muted-deep mx-1" style="font-size:10px">|</span>

          <button
            v-for="f in statusFilters"
            :key="f.value"
            class="text-xs px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
            :class="jobsActiveFilter === f.value
              ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] font-medium'
              : 'text-muted hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]'"
            @click="jobsSetFilter(f.value)"
          >{{ f.label }}</button>

          <div class="flex-1" />

          <input
            v-model="jobsSearchQuery"
            class="form-input w-48 h-8 text-xs"
            placeholder="搜索..."
            @input="onSearchInput"
          />

          <DateRange v-model="jobsDateFilter" :min-date="jobsEarliestDate" />

          <button class="btn btn-danger btn-xs" @click="showClearConfirm = true">清除全部</button>
          <button class="btn btn-secondary btn-xs" :disabled="jobsLoading" @click="fetchJobs()">
            {{ jobsLoading ? '刷新中...' : '刷新' }}
          </button>
        </div>

        <!-- Job cards -->
        <div v-if="jobsLoading && jobs.length === 0" class="flex items-center justify-center py-16">
          <span class="text-muted text-sm">加载中...</span>
        </div>

        <div v-else-if="jobs.length === 0" class="section-card p-8 text-center">
          <p class="text-sm text-muted">暂无同步历史</p>
          <p class="text-2xs text-muted-deep mt-1">执行同步后，历史记录将在此处显示</p>
        </div>

        <div v-else class="space-y-3">
          <JobCard
            v-for="job in jobs"
            :key="job.id"
            :job="job"
            @select="selectJob(job.id)"
          />

          <Pagination
            :has-more="jobsHasMore"
            :loading="jobsLoadingMore"
            :current-count="jobs.length"
            :total="jobsTotal"
            @load-more="jobsLoadMore()"
          />
        </div>
      </template>
    </div>

    <!-- ═══ Tab 3: 下载历史 ═══ -->
    <div v-else-if="activeTab === 'download-history'" class="space-y-4">
      <!-- Filters -->
      <div class="flex items-center gap-2">
        <input
          v-model="dqHistorySearch"
          class="form-input w-56 h-8 text-xs"
          placeholder="搜索歌曲名..."
          @input="onHistorySearchInput"
        />

        <DateRange v-model="dqDateFilter" :min-date="dqHistoryEarliestDate ?? null" />

        <button class="btn btn-secondary btn-xs" :disabled="dqLoading" @click="dqFetchAll()">
          {{ dqLoading ? '刷新中...' : '刷新' }}
        </button>

        <div class="flex-1" />

        <span v-if="dqHistoryTotal > 0" class="text-2xs text-muted-deep">共 {{ dqHistoryTotal }} 条</span>
        <button v-if="dqHistoryTotal > 0" class="btn btn-danger btn-xs" @click="showClearDownloads = true">
          清除历史
        </button>
      </div>

      <!-- Loading -->
      <div v-if="dqLoading && dqHistoryItems.length === 0" class="flex items-center justify-center py-16">
        <span class="text-muted text-sm">加载中...</span>
      </div>

      <!-- Empty -->
      <div v-else-if="dqHistoryItems.length === 0" class="section-card p-8 text-center">
        <p class="text-sm text-muted">暂无下载记录</p>
        <p class="text-2xs text-muted-deep mt-1">开始同步或手动下载后，记录将在此处显示</p>
      </div>

      <!-- Download history list -->
      <div v-else class="section-card overflow-hidden">
        <div class="divide-y divide-[var(--border-primary)]">
          <div
            v-for="task in dqHistoryItems"
            :key="task.id"
            class="px-5 py-3 flex items-center gap-4 hover:bg-[var(--bg-hover)] transition-colors"
          >
            <!-- Status icon -->
            <div class="shrink-0">
              <div
                class="w-7 h-7 rounded-lg flex items-center justify-center"
                :class="task.status === 'done' ? 'bg-[#2ecc7120]' : 'bg-[#e74c3c20]'"
              >
                <svg v-if="task.status === 'done'" width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8l3.5 3.5L13 5" :stroke="task.status === 'done' ? '#2ecc71' : '#e74c3c'" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                <svg v-else width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" stroke="#e74c3c" stroke-width="1.5" stroke-linecap="round" />
                </svg>
              </div>
            </div>

            <!-- Song info -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <span class="text-xs font-medium text-[var(--text-primary)] truncate">{{ task.songName }}</span>
                <span v-if="task.quality" class="text-2xs px-1.5 py-0.5 rounded shrink-0" :class="qualityBadgeClass(task.quality)">{{ task.quality }}</span>
              </div>
              <p class="text-2xs text-muted truncate">{{ task.artist }} · {{ task.album }}</p>
              <p v-if="task.filePath" class="text-2xs text-muted-deep truncate font-mono mt-0.5">{{ task.filePath }}</p>
            </div>

            <!-- Timestamp -->
            <div class="shrink-0 text-right">
              <p class="text-2xs text-muted-deep">{{ formatTime(task.createdAt) }}</p>
              <p v-if="task.error" class="text-2xs text-danger truncate max-w-[120px]">{{ task.error }}</p>
            </div>
          </div>
        </div>

        <Pagination
          :has-more="dqHistoryHasMore"
          :loading="dqHistoryLoadingMore"
          :current-count="dqHistoryItems.length"
          :total="dqHistoryTotal"
          @load-more="dqLoadMoreHistory()"
        />
      </div>
    </div>

    <!-- ═══ Tab 4: 失败项目 ═══ -->
    <div v-else-if="activeTab === 'failures'" class="space-y-4">
      <!-- Filter bar -->
      <div class="flex items-center gap-2 flex-wrap">
        <button
          v-for="f in failureKindFilters" :key="f.value"
          class="text-xs px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
          :class="failuresFilter.failureKind === f.value
            ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] font-medium'
            : 'text-muted hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]'"
          @click="failuresSetFilter({ failureKind: f.value })"
        >{{ f.label }}</button>

        <span class="text-muted-deep mx-1" style="font-size:10px">|</span>

        <button
          v-for="t in failureTaskFilters" :key="t.value"
          class="text-xs px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
          :class="failuresFilter.type === t.value
            ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] font-medium'
            : 'text-muted hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]'"
          @click="failuresSetFilter({ type: t.value })"
        >{{ t.label }}</button>

        <div class="flex-1" />

        <span v-if="failuresTotal > 0" class="text-2xs text-muted-deep">共 {{ failuresTotal }} 项</span>
        <button class="btn btn-secondary btn-xs" :disabled="failuresLoading" @click="failuresFetch()">刷新</button>
      </div>

      <!-- Batch actions -->
      <div v-if="selectedFailures.size > 0" class="flex items-center gap-2 px-4 py-2 rounded-lg" style="background:var(--bg-surface);border:1px solid var(--border-primary)">
        <span class="text-xs text-muted">已选 {{ selectedFailures.size }} 项</span>
        <button
          class="btn btn-primary btn-xs"
          :disabled="!canBatchRetry"
          @click="handleBatchRetry"
        >批量重试</button>
        <button
          class="btn btn-secondary btn-xs"
          @click="handleBatchIgnore"
        >批量忽略</button>
        <button class="btn btn-ghost btn-xs" @click="selectedFailures.clear()">取消选择</button>
      </div>

      <!-- Result message -->
      <div v-if="failureMsg" class="text-xs px-3 py-2 rounded-lg" :class="failureMsgOk ? 'text-success bg-[#2ecc7110]' : 'text-warning bg-[#f59e0b10]'">{{ failureMsg }}</div>

      <!-- Loading -->
      <div v-if="failuresLoading && failuresItems.length === 0" class="flex items-center justify-center py-16">
        <span class="text-muted text-sm">加载中...</span>
      </div>

      <!-- Empty -->
      <div v-else-if="failuresItems.length === 0" class="section-card p-8 text-center">
        <p class="text-sm text-muted">暂无失败项目</p>
        <p class="text-2xs text-muted-deep mt-1">{{ hasFailureFilter ? '当前筛选条件下没有匹配的失败项' : '所有同步和下载任务均已完成，没有失败记录' }}</p>
      </div>

      <!-- Failure list -->
      <div v-else class="section-card overflow-hidden">
        <div class="divide-y divide-[var(--border-primary)]">
          <div v-for="item in failuresItems" :key="item.id">
            <!-- Row -->
            <div class="px-5 py-3 flex items-center gap-3 hover:bg-[var(--bg-hover)] transition-colors">
              <input
                type="checkbox"
                class="w-3.5 h-3.5 shrink-0 cursor-pointer"
                :checked="selectedFailures.has(item.id)"
                :disabled="(item.failure_kind === 'copyright_restricted' || item.task_type === 'sync') && !selectedFailures.has(item.id)"
                :title="item.task_type === 'sync' ? '同步失败需从同步源页面重试' : item.failure_kind === 'copyright_restricted' ? '版权受限无法重试' : ''"
                @change="toggleFailureSelect(item.id)"
              />

              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="text-xs font-medium text-[var(--text-primary)] truncate">{{ item.song_name }}</span>
                  <span class="text-2xs text-muted-deep truncate">{{ item.artist }}</span>
                  <span class="text-2xs px-1.5 py-0.5 rounded shrink-0" :class="failureKindBadge(item.failure_kind)">{{ failureKindLabel(item.failure_kind) }}</span>
                  <span class="text-2xs px-1.5 py-0.5 rounded shrink-0" :class="item.task_type === 'sync' ? 'bg-[var(--accent-muted)] text-accent' : 'bg-[var(--bg-input)] text-muted-deep'" style="background:var(--bg-input);color:var(--text-tertiary)">{{ item.task_type === 'sync' ? '同步' : item.task_type === 'repair' ? '补全' : '手动' }}</span>
                  <span class="text-2xs text-muted-deep truncate max-w-[120px]">{{ item.source_name }}</span>
                </div>
              </div>

              <span class="text-2xs text-muted-deep shrink-0 w-10 text-right">{{ item.failure_count }} 次</span>
              <span class="text-2xs text-muted-deep shrink-0 w-16 text-right">{{ formatTimeShort(item.last_failed_at) }}</span>

              <div class="flex items-center gap-1 shrink-0">
                <!-- Sync failures: retry via sync source page -->
                <template v-if="item.task_type === 'sync'">
                  <span class="text-2xs text-muted-deep">需从同步源重试</span>
                </template>
                <!-- Download failures: actionable -->
                <template v-else>
                  <button
                    v-if="item.failure_kind !== 'copyright_restricted'"
                    class="text-2xs px-2 py-1 rounded cursor-pointer hover:bg-[var(--bg-hover)] transition-colors"
                    style="color:var(--text-secondary)"
                    @click="retrySingleFailure(item.id)"
                  >重试</button>
                  <button
                    class="text-2xs px-2 py-1 rounded cursor-pointer hover:bg-[var(--bg-hover)] transition-colors"
                    style="color:var(--text-tertiary)"
                    @click="ignoreSingleFailure(item.id)"
                  >忽略</button>
                </template>
                <button
                  class="text-2xs px-1 py-1 rounded cursor-pointer hover:bg-[var(--bg-hover)] transition-colors"
                  style="color:var(--text-tertiary)"
                  @click="toggleFailureExpand(item.id)"
                >
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" class="transition-transform" :class="expandedFailures.has(item.id) ? 'rotate-90' : ''">
                    <path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>
              </div>
            </div>

            <!-- Expanded detail -->
            <div v-if="expandedFailures.has(item.id)" class="px-12 pb-3" style="border-top:1px solid var(--border-primary)">
              <div class="pt-3 space-y-1 text-xs">
                <div class="flex gap-2">
                  <span class="text-muted-deep shrink-0">失败原因:</span>
                  <span class="text-danger">{{ item.failure_reason || '未知错误' }}</span>
                </div>
                <div class="flex gap-2">
                  <span class="text-muted-deep shrink-0">最近失败:</span>
                  <span style="color:var(--text-secondary)">{{ formatTime(item.last_failed_at) }}</span>
                </div>
                <div class="flex gap-2">
                  <span class="text-muted-deep shrink-0">累计失败:</span>
                  <span style="color:var(--text-secondary)">{{ item.failure_count }} 次</span>
                </div>
                <div v-if="item.netease_song_id" class="flex gap-2">
                  <span class="text-muted-deep shrink-0">网易云 ID:</span>
                  <span class="font-mono" style="color:var(--text-secondary)">{{ item.netease_song_id }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <Pagination
          :has-more="failuresHasMore"
          :loading="failuresLoading"
          :current-count="failuresItems.length"
          :total="failuresTotal"
          @load-more="failuresLoadMore()"
        />
      </div>
    </div>

    <!-- Confirm dialogs -->
    <ConfirmDialog
      :visible="showClearConfirm"
      title="清除全部同步历史"
      message="此操作将永久删除所有同步历史记录，不可恢复。确定继续？"
      confirm-label="确认清除"
      variant="danger"
      @confirm="handleClearJobs"
      @cancel="showClearConfirm = false"
    />

    <ConfirmDialog
      :visible="showClearDownloads"
      title="清除全部下载记录"
      message="此操作将清空所有下载任务记录（包括排队、进行中、已完成和失败的记录）。正在下载的文件不受影响。"
      confirm-label="确认清除"
      variant="danger"
      @confirm="handleClearDownloads"
      @cancel="showClearDownloads = false"
    />
  </div>
</template>

<script setup lang="ts">
import type { SyncJob, JobStatus, JobType } from '~~/server/lib/job/types'
import JobCard from '~~/components/jobs/JobCard.vue'
import JobDetail from '~~/components/jobs/JobDetail.vue'
import DateRange from '~~/components/common/DateRange.vue'
import Pagination from '~~/components/common/Pagination.vue'
import ConfirmDialog from '~~/components/common/ConfirmDialog.vue'

const route = useRoute()
const router = useRouter()
const api = useApi()

// ── Tab state (synced with URL) ──
const tabs = [
  { key: 'running', label: '运行中' },
  { key: 'sync-history', label: '同步历史' },
  { key: 'download-history', label: '下载历史' },
  { key: 'failures', label: '失败项目' },
]

const activeTab = ref<string>((route.query.tab as string) || 'running')

function switchTab(key: string) {
  activeTab.value = key
  router.replace({ query: { ...route.query, tab: key, id: undefined } })
}

// ── Composables ──
const { state: syncState, cancelSync, error: syncError } = useSync()
const {
  queueStatus, activeTasks: dqActiveTasks, loading: dqLoading,
  failedTasks: dqFailedTasks,
  historyItems: dqHistoryItems, historyEarliestDate: dqHistoryEarliestDate,
  historyTotal: dqHistoryTotal, historyHasMore: dqHistoryHasMore,
  historyLoadingMore: dqHistoryLoadingMore, loadMoreHistory: dqLoadMoreHistory,
  retryingOne: dqRetryingOne, retryOne: dqRetryOne,
  clearAll: dqClearAll, dateFilter: dqDateFilter, historySearch: dqHistorySearch,
  fetchAll: dqFetchAll,
} = useDownloadQueue()
const {
  jobs, total: jobsTotal, loading: jobsLoading, loadingMore: jobsLoadingMore,
  hasMore: jobsHasMore, activeFilter: jobsActiveFilter, activeType: jobsActiveType,
  searchQuery: jobsSearchQuery, dateFilter: jobsDateFilter, earliestDate: jobsEarliestDate,
  fetchJobs, loadMore: jobsLoadMore, setFilter: jobsSetFilter, setType: jobsSetType,
} = useJobs()
const {
  items: failuresItems, total: failuresTotal, loading: failuresLoading,
  hasMore: failuresHasMore, filter: failuresFilter,
  fetch: failuresFetch, loadMore: failuresLoadMore,
  batchRetry: failuresBatchRetry, batchIgnore: failuresBatchIgnore,
  setFilter: failuresSetFilter,
} = useFailures()

// ── Failure tab helpers ──
const selectedFailures = ref(new Set<string>())
const expandedFailures = ref(new Set<string>())
const hasFailureFilter = computed(() => !!failuresFilter.value.failureKind || !!failuresFilter.value.type)

const failureKindFilters = [
  { label: '全部可处理', value: '' },
  { label: '下载失败', value: 'download_failed' },
  { label: '元数据失败', value: 'metadata_failed' },
  { label: '已忽略', value: 'ignored_failure' },
  { label: '版权受限', value: 'copyright_restricted' },
]
const failureTaskFilters = [
  { label: '全部来源', value: '' },
  { label: '同步', value: 'sync' },
  { label: '手动', value: 'manual' },
]

const canBatchRetry = computed(() => {
  if (selectedFailures.value.size === 0) return false
  for (const item of failuresItems.value) {
    if (selectedFailures.value.has(item.id) && item.failure_kind === 'copyright_restricted') return false
  }
  return true
})

function failureKindLabel(kind: string): string {
  const map: Record<string, string> = {
    download_failed: '下载失败',
    metadata_failed: '元数据失败',
    ignored_failure: '已忽略',
    copyright_restricted: '版权受限',
  }
  return map[kind] || kind
}

function failureKindBadge(kind: string): string {
  switch (kind) {
    case 'download_failed': return 'bg-[#e74c3c20] text-danger'
    case 'metadata_failed': return 'bg-[#f59e0b20] text-warning'
    case 'ignored_failure': return 'bg-[var(--bg-input)] text-muted-deep'
    case 'copyright_restricted': return 'bg-[#71717a20] text-muted-deep'
    default: return 'bg-[var(--bg-input)] text-muted-deep'
  }
}

function toggleFailureSelect(id: string) {
  const s = new Set(selectedFailures.value)
  if (s.has(id)) { s.delete(id) } else { s.add(id) }
  selectedFailures.value = s
}

function toggleFailureExpand(id: string) {
  const s = new Set(expandedFailures.value)
  if (s.has(id)) { s.delete(id) } else { s.add(id) }
  expandedFailures.value = s
}

const failureMsg = ref('')
const failureMsgOk = ref(true)

function showFailureMsg(msg: string, ok: boolean) {
  failureMsg.value = msg
  failureMsgOk.value = ok
  setTimeout(() => { failureMsg.value = '' }, 5000)
}

async function handleBatchRetry() {
  const { count, msg } = await failuresBatchRetry([...selectedFailures.value])
  selectedFailures.value = new Set()
  showFailureMsg(msg, count > 0)
}

async function handleBatchIgnore() {
  const { count, msg } = await failuresBatchIgnore([...selectedFailures.value])
  selectedFailures.value = new Set()
  showFailureMsg(msg, count > 0)
}

async function retrySingleFailure(id: string) {
  await failuresBatchRetry([id])
}

async function ignoreSingleFailure(id: string) {
  await failuresBatchIgnore([id])
}

// ── Sync helpers ──
const stageLabelMap: Record<string, string> = {
  idle: '空闲',
  fetching_playlist: '获取歌单',
  comparing: '对比差异',
  downloading: '下载中',
  processing_tags: '处理标签',
  refreshing_plex: '刷新 Plex',
  updating_plex_playlist: '更新 Plex 歌单',
  reorder: '排序中',
  cancelled: '已取消',
  error: '错误',
  repair: '补全中',
}

const stageLabel = computed(() => {
  if (!syncState.value?.currentStage) return '空闲'
  return stageLabelMap[syncState.value.currentStage] || syncState.value.currentStage
})

const progressPct = computed(() => {
  const p = syncState.value?.progress
  if (!p || p.total === 0) return 0
  return Math.round((p.current / p.total) * 100)
})

async function handleCancelSync() {
  try {
    await cancelSync()
  } catch {
    // error is already set on syncError
  }
}

// ── Time formatting ──
function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatTimeShort(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

// ── Sync history filters ──
const typeTabs: { label: string; value: JobType }[] = [
  { label: '同步任务', value: 'sync' },
  { label: '补全任务', value: 'repair' },
]

const statusFilters: { label: string; value: JobStatus | '' }[] = [
  { label: '全部', value: '' },
  { label: '成功', value: 'success' },
  { label: '部分失败', value: 'partial' },
  { label: '失败', value: 'failed' },
]

// ── Search debounce ──
let searchTimer: ReturnType<typeof setTimeout> | null = null
function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    fetchJobs()
  }, 400)
}

let historySearchTimer: ReturnType<typeof setTimeout> | null = null
function onHistorySearchInput() {
  if (historySearchTimer) clearTimeout(historySearchTimer)
  historySearchTimer = setTimeout(() => {
    dqFetchAll()
  }, 400)
}

// ── Job detail ──
const selectedJob = ref<SyncJob | null>(null)
const jobLoading = ref(false)

async function selectJob(id: string) {
  jobLoading.value = true
  try {
    const job = await api.get<SyncJob>(`/jobs/${id}`)
    selectedJob.value = job
    router.replace({ query: { ...route.query, id } })
  } catch {
    // ignore
  } finally {
    jobLoading.value = false
  }
}

function clearSelectedJob() {
  selectedJob.value = null
  router.replace({ query: { ...route.query, id: undefined } })
}

// ── Clear confirmations ──
const showClearConfirm = ref(false)
const showClearDownloads = ref(false)

async function handleClearJobs() {
  showClearConfirm.value = false
  try {
    await api.del('/jobs')
    fetchJobs()
  } catch { /* ignore */ }
}

async function handleClearDownloads() {
  showClearDownloads.value = false
  try {
    await dqClearAll()
  } catch { /* ignore */ }
}

// ── Quality badge ──
function qualityBadgeClass(quality: string): string {
  const q = quality.toLowerCase()
  if (q.includes('hires') || q.includes('192') || q.includes('24bit')) return 'bg-[var(--accent-glow)] text-accent'
  if (q.includes('lossless') || q.includes('flac') || q.includes('无损')) return 'bg-[#22c55e20] text-success'
  if (q.includes('320') || q.includes('极高')) return 'bg-[#f59e0b20] text-warning'
  return 'bg-[var(--bg-hover)] text-muted-deep'
}

// ── Initialize: fetch jobs on mount, handle URL id param ──
onMounted(async () => {
  // Always pre-fetch jobs so sync-history tab has data on first switch
  fetchJobs()

  // If URL has an id param, load that job detail
  const urlId = route.query.id as string
  if (urlId && activeTab.value === 'sync-history') {
    await selectJob(urlId)
  }
})

// When activeTab changes to sync-history, fetch if needed
watch(activeTab, (tab) => {
  if (tab === 'sync-history' && jobs.length === 0) {
    fetchJobs()
  }
  if (tab === 'failures' && failuresItems.length === 0) {
    failuresFetch()
  }
})

// Cleanup
onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer)
  if (historySearchTimer) clearTimeout(historySearchTimer)
})
</script>

<style scoped>
.progress-bar {
  background: var(--accent);
}
</style>
