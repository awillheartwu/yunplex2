<template>
  <section class="activity-overview" aria-label="当前活动">
    <header class="activity-overview__toolbar">
      <div><h2>当前活动</h2><p>{{ error ? '暂时无法更新活动状态' : connected ? '实时更新' : '定时更新，每 5 秒刷新' }}</p></div>
      <button type="button" class="btn btn-secondary btn-sm" :disabled="loading" @click="refresh"><AppIcon name="refresh" :size="14" :class="{ 'animate-spin': loading }" />刷新</button>
    </header>
    <div v-if="error" class="activity-overview__error" role="alert"><strong>活动读取失败</strong><span>{{ error }}</span><span v-if="snapshot">以下保留上次读取的内容，可能已变化。</span><button class="btn btn-secondary btn-sm" @click="refresh">重试</button></div>
    <p v-if="!snapshot && loading" role="status" class="activity-overview__notice">正在读取活动…</p>
    <template v-if="snapshot">
      <div v-if="snapshot.downloadControl?.paused || snapshot.downloadControl?.cooldownUntil" class="activity-overview__error" role="status">
        <strong>{{ snapshot.downloadControl.paused ? '下载队列已暂停' : '下载请求冷却中' }}</strong>
        <span>{{ snapshot.downloadControl.message || '请求受到限制，冷却结束后自动继续。' }}</span>
        <button v-if="snapshot.downloadControl.paused" class="btn btn-secondary btn-sm" :disabled="resuming" @click="resumeDownloads">{{ resuming ? '处理中…' : '继续下载队列' }}</button>
      </div>
      <article v-if="snapshot.unlistedLive" class="activity-overview__idle">
        <h3>{{ snapshot.unlistedLive.dryRun ? '同步预演' : '同步正在执行' }}</h3>
        <p>{{ snapshot.unlistedLive.currentSourceName }} · {{ liveStageLabel(snapshot.unlistedLive.currentStage) }}</p>
        <p v-if="!snapshot.unlistedLive.dryRun">正在等待对应的运行记录，稍后将自动更新。</p>
        <button v-if="snapshot.unlistedLive.currentRunId" class="btn btn-secondary btn-sm" :disabled="cancelling || Boolean(error)" @click="cancel(snapshot.unlistedLive.currentRunId)">取消本批同步</button>
      </article>
      <section v-if="snapshot.running.length" class="activity-overview__group" aria-label="执行任务">
        <div class="activity-overview__group-title"><h3>执行任务</h3><span>{{ snapshot.runningTotal }}</span></div>
        <ActivityRunCard v-for="run in snapshot.running" :key="run.id" :run="run" :now="now" :cancelling="cancelling" :stale="Boolean(error)" @cancel="cancel" @refresh="refresh" />
        <NuxtLink v-if="snapshot.runningTotal > snapshot.running.length" to="/task-center?tab=runs&runStatus=running" class="activity-overview__more">已显示最近 {{ snapshot.running.length }} 项，查看全部 {{ snapshot.runningTotal }} 项</NuxtLink>
      </section>
      <p v-else-if="snapshot.waiting.length && !snapshot.unlistedLive && !error" class="activity-overview__notice"><AppIcon name="checkCircle" :size="16" />当前没有正在执行的任务</p>
      <section v-if="snapshot.waiting.length" class="activity-overview__group" aria-label="待你处理">
        <div class="activity-overview__group-title"><h3>待你处理</h3><span>{{ snapshot.waitingTotal }}</span></div>
        <ActivityRunCard v-for="run in snapshot.waiting" :key="run.id" :run="run" :now="now" :cancelling="false" :stale="Boolean(error)" />
        <NuxtLink v-if="snapshot.waitingTotal > snapshot.waiting.length" to="/task-center?tab=runs&runStatus=awaiting_action" class="activity-overview__more">已显示最近 {{ snapshot.waiting.length }} 项，查看全部 {{ snapshot.waitingTotal }} 项</NuxtLink>
      </section>
      <div v-if="!snapshot.running.length && !snapshot.waiting.length && !snapshot.unlistedLive && !error" class="activity-overview__idle">
        <AppIcon name="checkCircle" :size="28" /><h3>当前没有待办任务</h3><p>同步收藏或添加音乐后，可以在这里跟进进度。</p>
        <div><NuxtLink to="/sync-sources" class="btn btn-secondary btn-sm">打开音乐库</NuxtLink><NuxtLink to="/manual-download" class="btn btn-secondary btn-sm">添加音乐</NuxtLink></div>
      </div>
    </template>
  </section>
</template>
<script setup lang="ts">
import { useActivityOverview } from '~~/composables/useActivityOverview'
import { liveStageLabel } from '~~/lib/activity-presentation'
import { useFeedback } from '~~/composables/useFeedback'
const { snapshot, loading, error, now, connected, refresh } = useActivityOverview()
const api = useApi()
const feedback = useFeedback()
const cancelling = ref(false)
const resuming = ref(false)
async function resumeDownloads() {
  if (resuming.value) return
  resuming.value = true
  try { await api.post('/downloads/control', { action: 'resume' }); await refresh() }
  catch (err) { feedback.error('继续下载失败', err instanceof Error ? err.message : '请稍后重试') }
  finally { resuming.value = false }
}
async function cancel(runId: string) {
  if (cancelling.value) return
  cancelling.value = true
  try { await api.post('/sync/cancel', { runId }); feedback.success('已发送批次取消请求'); await refresh() }
  catch (err) { feedback.error('取消失败', err instanceof Error ? err.message : '请稍后重试') }
  finally { cancelling.value = false }
}
</script>
<style scoped>
.activity-overview{display:flex;flex-direction:column;gap:var(--space-5)}
.activity-overview__toolbar{display:flex;align-items:center;justify-content:space-between;gap:var(--space-3)}
.activity-overview__toolbar h2,.activity-overview__group-title h3{margin:0}
.activity-overview__toolbar p{margin:var(--space-1) 0 0;font-size:var(--text-xs);color:var(--text-tertiary)}
.activity-overview__group{display:flex;flex-direction:column;gap:var(--space-3);min-width:0}
.activity-overview__group-title{display:flex;align-items:baseline;gap:var(--space-2)}
.activity-overview__group-title span{font-size:var(--text-xs);color:var(--text-tertiary);font-variant-numeric:tabular-nums}
.activity-overview__notice{display:flex;align-items:center;gap:var(--space-2);margin:0;padding:var(--space-3) 0;font-size:var(--text-sm);color:var(--text-secondary)}
.activity-overview__error{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);padding:var(--space-4);border:1px solid var(--danger);border-radius:var(--radius-md);font-size:var(--text-sm);overflow-wrap:anywhere}
.activity-overview__idle{display:flex;flex-direction:column;align-items:flex-start;gap:var(--space-3);padding:var(--space-6);border:1px solid var(--border-primary);border-radius:var(--radius-md);background:var(--bg-surface)}
.activity-overview__idle>svg{color:var(--text-tertiary)}
.activity-overview__idle h3,.activity-overview__idle p{margin:0}
.activity-overview__idle p{font-size:var(--text-sm);color:var(--text-secondary)}
.activity-overview__idle>div{display:flex;flex-wrap:wrap;gap:var(--space-2)}
.activity-overview__more{color:var(--accent);font-size:var(--text-sm);text-decoration:underline;text-underline-offset:3px}
</style>
