<template>
  <section class="section-card system-logs-panel">
    <header class="system-logs-panel__header">
      <div>
        <h2>系统日志</h2>
        <p>{{ total }} 条 · 自动保留最多 5000 条</p>
      </div>
      <div class="system-logs-panel__actions">
        <div class="system-logs-panel__filters" aria-label="日志级别">
          <FilterChip
            v-for="filter in filters"
            :key="filter.value || 'all'"
            :active="activeFilter === filter.value"
            @click="setFilter(filter.value)"
          >
            {{ filter.label }}
          </FilterChip>
        </div>
        <button class="btn btn-secondary btn-sm" type="button" :disabled="loading" @click="fetchLogs">
          <AppIcon :name="loading ? 'loader' : 'refresh'" :size="14" :class="{ 'animate-spin': loading }" />
          刷新
        </button>
        <button class="btn btn-danger btn-sm" type="button" @click="showClearConfirm = true">清空日志</button>
      </div>
    </header>

    <div v-if="loading" class="system-logs-panel__state">加载日志中…</div>
    <div v-else-if="logs.length > 0" class="system-log-list" role="list" aria-label="系统日志列表">
      <article v-for="log in logs" :key="log.id" class="system-log-row" role="listitem">
        <time class="system-log-row__time" :datetime="log.timestamp">{{ formatTime(log.timestamp) }}</time>
        <span class="system-log-row__level" :class="levelClass(log.level)">{{ log.level.toUpperCase() }}</span>
        <span v-if="log.stage && log.stage !== 'idle'" class="system-log-row__stage">[{{ log.stage }}]</span>
        <p class="system-log-row__message">{{ log.message }}</p>
      </article>
    </div>
    <EmptyState v-else title="暂无日志" :description="activeFilter ? '当前级别下没有日志' : '执行同步后日志将出现在这里'" />

    <Pagination
      :has-more="hasMore"
      :loading="loadingMore"
      :current-count="logs.length"
      :total="total"
      @load-more="loadMore"
    />
  </section>

  <ConfirmDialog
    :visible="showClearConfirm"
    title="清空日志"
    message="确定要清空所有系统日志吗？此操作不可撤销。"
    confirm-label="清空"
    variant="danger"
    @confirm="clearLogs"
    @cancel="showClearConfirm = false"
  />
</template>

<script setup lang="ts">
import { useSystemLogs } from '~~/composables/useSystemLogs'

const {
  activeFilter, clearLogs, fetchLogs, filters, formatTime, hasMore, levelClass,
  loading, loadingMore, loadMore, logs, setFilter, showClearConfirm, total,
} = useSystemLogs()
</script>

<style scoped>
.system-logs-panel{display:grid;gap:1rem;padding:1rem 1.1rem}
.system-logs-panel__header{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;flex-wrap:wrap}
.system-logs-panel__header h2{margin:0;color:var(--text-primary);font-size:1rem;font-weight:760}
.system-logs-panel__header p{margin:.25rem 0 0;color:var(--text-tertiary);font-size:.75rem}
.system-logs-panel__actions,.system-logs-panel__filters{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}
.system-log-list{overflow:hidden;border:1px solid var(--border-primary);border-radius:var(--radius-lg);background:var(--bg-input)}
.system-log-row{display:grid;grid-template-columns:10.5rem 4.2rem max-content minmax(0,1fr);gap:.75rem;align-items:start;padding:.65rem .85rem;border-bottom:1px solid var(--border-primary)}
.system-log-row:last-child{border-bottom:0}.system-log-row:hover{background:var(--bg-hover)}
.system-log-row__time,.system-log-row__stage{color:var(--text-tertiary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.7rem;white-space:nowrap}
.system-log-row__level{display:inline-flex;min-height:1.45rem;align-items:center;justify-content:center;border:1px solid;border-radius:999px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.64rem;font-weight:800}
.system-log-row__level--info{color:var(--existing);background:var(--existing-soft);border-color:var(--existing-border)}
.system-log-row__level--debug{color:var(--text-tertiary);background:var(--bg-muted);border-color:var(--border-secondary)}
.system-log-row__level--warn{color:var(--warning);background:var(--warning-soft);border-color:var(--warning-border)}
.system-log-row__level--error{color:var(--danger);background:var(--danger-soft);border-color:var(--danger-border)}
.system-log-row__message{min-width:0;margin:0;color:var(--text-secondary);font-size:.78rem;line-height:1.55;overflow-wrap:anywhere}
.system-logs-panel__state{display:flex;min-height:12rem;align-items:center;justify-content:center;color:var(--text-secondary)}
@media(max-width:760px){.system-log-row{grid-template-columns:1fr;gap:.35rem}.system-log-row__level{justify-self:start;padding:0 .55rem}}
</style>
