<template>
  <section class="section-card system-logs-panel">
    <header class="system-logs-panel__header">
      <div>
        <h2>诊断日志</h2>
        <p>{{ total }} 条 · 自动维护至 2000 条以内 · 最长保留 30 天</p>
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
      </div>
    </header>

    <div v-if="error" class="system-logs-error" role="alert"><strong>日志读取失败</strong><p>{{ error }}</p><button class="btn btn-secondary btn-sm" :disabled="loading" @click="fetchLogs">重新加载</button></div>
    <div v-if="loading" class="system-logs-panel__state">加载日志中…</div>
    <div v-else-if="logs.length > 0" class="system-log-list" role="list" aria-label="系统日志列表">
      <article v-for="log in logs" :key="log.id" class="system-log-row" role="listitem">
        <time class="system-log-row__time" :datetime="log.timestamp">{{ formatTime(log.timestamp) }}</time>
        <span class="system-log-row__level" :class="levelClass(log.level)">{{ log.level.toUpperCase() }}</span>
        <span v-if="log.stage && log.stage !== 'idle'" class="system-log-row__stage">[{{ log.stage }}]</span>
        <div class="system-log-row__content">
          <div class="system-log-row__summary">
            <p class="system-log-row__message">{{ log.message }}</p>
            <span v-if="log.errorCode" class="system-log-row__error-code">
              {{ errorLabel(log.errorCode) }} · {{ log.retryable ? '可重试' : '不可自动重试' }}
            </span>
          </div>
          <details v-if="log.detail" class="system-log-row__detail">
            <summary>查看详情</summary>
            <pre>{{ log.detail }}</pre>
          </details>
        </div>
      </article>
    </div>
    <EmptyState v-else-if="!error" title="暂无诊断日志" :description="activeFilter ? '当前级别下没有日志' : '暂时没有诊断事件，服务连接状况可在总览查看'" />

    <Pagination
      :has-more="hasMore"
      :loading="loadingMore"
      :current-count="logs.length"
      :total="total"
      @load-more="loadMore"
    />
  </section>

</template>

<script setup lang="ts">
import { useSystemLogs } from '~~/composables/useSystemLogs'
import { getDomainErrorDefinition } from '~~/shared/domain-errors'

const {
  activeFilter, error, fetchLogs, filters, formatTime, hasMore, levelClass,
  loading, loadingMore, loadMore, logs, setFilter, total,
} = useSystemLogs()

function errorLabel(code: string) {
  return getDomainErrorDefinition(code).label
}
</script>

<style scoped>
.system-logs-error{display:grid;justify-items:start;gap:var(--space-2_5);padding:var(--space-4);border:1px solid var(--danger-border);border-radius:var(--radius-md);background:var(--danger-soft);color:var(--danger);font-size:var(--text-sm)}
.system-logs-panel{display:grid;gap:var(--space-4);padding:var(--space-4) var(--space-4)}
.system-logs-panel__header{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--space-4);flex-wrap:wrap}
.system-logs-panel__header h2{margin:0;color:var(--text-primary)}
.system-logs-panel__header p{margin:var(--space-1) 0 0;color:var(--text-tertiary);font-size:var(--text-xs)}
.system-logs-panel__actions,.system-logs-panel__filters{display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap}
.system-log-list{overflow:hidden;border:1px solid var(--border-primary);border-radius:var(--radius-lg);background:var(--bg-input)}
.system-log-row{display:grid;grid-template-columns:10.5rem 4.2rem max-content minmax(0,1fr);gap:var(--space-3);align-items:start;padding:var(--space-2_5) var(--space-3_5);border-bottom:1px solid var(--border-primary)}
.system-log-row:last-child{border-bottom:0}.system-log-row:hover{background:var(--bg-hover)}
.system-log-row__time,.system-log-row__stage{color:var(--text-tertiary);font-family:var(--font-mono);font-size:var(--text-xs);white-space:nowrap}
.system-log-row__level{display:inline-flex;min-height:1.45rem;align-items:center;justify-content:center;border:1px solid;border-radius:var(--radius-full);font-family:var(--font-mono);font-size:var(--text-xs);font-weight:var(--font-weight-bold)}
.system-log-row__level--info{color:var(--existing);background:var(--existing-soft);border-color:var(--existing-border)}
.system-log-row__level--warn{color:var(--warning);background:var(--warning-soft);border-color:var(--warning-border)}
.system-log-row__level--error{color:var(--danger);background:var(--danger-soft);border-color:var(--danger-border)}
.system-log-row__content{min-width:0}
.system-log-row__summary{display:flex;align-items:center;gap:var(--space-2);flex-wrap:wrap}
.system-log-row__message{min-width:0;margin:0;color:var(--text-secondary);font-size:var(--text-xs);line-height:var(--body-leading);overflow-wrap:anywhere}
.system-log-row__error-code{display:inline-flex;align-items:center;border:1px solid var(--border-primary);border-radius:var(--radius-full);padding:.12rem var(--space-2);color:var(--text-tertiary);background:var(--bg-app);font-size:var(--text-xs);white-space:nowrap}
.system-log-row__detail{margin-top:var(--space-1_5);color:var(--text-tertiary);font-size:var(--text-xs)}.system-log-row__detail summary{cursor:pointer;color:var(--text-secondary)}.system-log-row__detail pre{max-height:16rem;margin:var(--space-1_5) 0 0;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;border-radius:var(--radius-md);background:var(--bg-app);padding:var(--space-2_5)}
.system-logs-panel__state{display:flex;min-height:12rem;align-items:center;justify-content:center;color:var(--text-secondary)}
@media(max-width:760px){.system-log-row{grid-template-columns:1fr;gap:var(--space-1_5)}.system-log-row__level{justify-self:start;padding:0 var(--space-2)}}
</style>
