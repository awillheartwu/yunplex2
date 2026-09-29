<script setup lang="ts">
import type { SourceRequestResult } from '~~/server/lib/sync/source-requests'
import { sourceRequestReceipt } from '~/lib/source-request-presentation'
import { useDialogFocus } from '~/composables/useDialogFocus'
const props = withDefaults(defineProps<{ results: SourceRequestResult[]; modal?: boolean }>(), { modal: false })
const emit = defineEmits<{ dismiss: [] }>()
const panel = ref<HTMLElement | null>(null)
const rows = computed(() => props.results.map((result) => ({ ...result, presentation: sourceRequestReceipt(result) })))
const accepted = computed(() => props.results.filter((result) => result.status === 'accepted').length)
const waiting = computed(() => props.results.filter((result) => result.status === 'awaiting_review').length)
useDialogFocus(
  () => props.modal && props.results.length > 0,
  panel,
  () => emit('dismiss'),
)
</script>

<template>
  <Teleport to="body" :disabled="!modal">
    <div v-if="results.length" :class="{ 'source-request-backdrop': modal }" @click.self="modal && emit('dismiss')">
      <section
        ref="panel"
        class="section-card source-request-results"
        :class="{ 'source-request-results--modal': modal }"
        :role="modal ? 'dialog' : 'region'"
        :aria-modal="modal || undefined"
        aria-label="同步请求结果"
        tabindex="-1"
      >
        <header>
          <div>
            <h2>同步请求结果</h2>
            <p>
              已受理 {{ accepted }} 个 · 待确认 {{ waiting }} 个<span v-if="results.length - accepted - waiting">
                · 未受理 {{ results.length - accepted - waiting }} 个</span
              >
            </p>
          </div>
          <button
            class="icon-button"
            :aria-label="modal ? '关闭同步请求结果' : '收起本次请求结果'"
            @click="emit('dismiss')"
          >
            <AppIcon name="close" :size="18" />
          </button>
        </header>
        <p class="source-request-results__hint">这是本次请求的受理情况。任务会在后台继续，实际结果请查看同步进度。</p>
        <ul>
          <li v-for="result in rows" :key="result.sourceId">
            <div class="source-request-results__copy">
              <NuxtLink :to="result.presentation.href">{{ result.sourceName || result.sourceId }}</NuxtLink>
              <p>{{ result.message }}</p>
            </div>
            <StatusBadge
              :status="result.status === 'failed' ? 'error' : result.status === 'accepted' ? 'idle' : 'warning'"
              :label="result.presentation.label"
            />
            <div class="source-request-results__actions">
              <NuxtLink :to="result.presentation.href" class="btn btn-secondary btn-sm"
                ><AppIcon :name="result.status === 'awaiting_review' ? 'checkCircle' : 'arrowRight'" :size="14" />{{
                  result.presentation.action
                }}</NuxtLink
              ><NuxtLink v-if="result.runId" :to="`/task-center/runs/${result.runId}`" class="btn btn-ghost btn-sm"
                ><AppIcon name="activity" :size="14" />查看运行</NuxtLink
              >
            </div>
          </li>
        </ul>
        <footer v-if="modal">
          <button class="btn btn-secondary" @click="emit('dismiss')">返回工作台</button
          ><NuxtLink to="/task-center" class="btn btn-primary"><AppIcon name="activity" :size="16" />查看活动</NuxtLink>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.source-request-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-4);
  background: var(--bg-overlay);
  backdrop-filter: blur(8px);
}
.source-request-results {
  padding: var(--space-5);
  min-width: 0;
}
.source-request-results--modal {
  display: flex;
  flex-direction: column;
  width: min(56rem, 100%);
  max-height: calc(100dvh - 2rem);
  box-shadow: var(--shadow-lg);
}
.source-request-results header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-3);
}
.source-request-results p {
  margin: var(--space-1) 0 0;
  font-size: var(--text-sm);
  line-height: var(--body-leading);
  color: var(--text-secondary);
}
.source-request-results .source-request-results__hint {
  padding: var(--space-3) 0 var(--space-4);
}
.source-request-results ul {
  display: grid;
  margin: 0;
  padding: 0;
  list-style: none;
  min-height: 0;
  max-height: 24rem;
  overflow: auto;
  overscroll-behavior: contain;
}
.source-request-results--modal ul {
  max-height: none;
}
.source-request-results li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto 11rem;
  align-items: start;
  gap: var(--space-4);
  padding: var(--space-4) 0;
  border-top: 1px solid var(--border-primary);
}
.source-request-results__copy {
  min-width: 0;
  overflow-wrap: anywhere;
}
.source-request-results__copy > a {
  color: var(--text-primary);
  font-size: var(--text-base);
  font-weight: var(--font-weight-semibold);
}
.source-request-results__copy > a:hover {
  text-decoration: underline;
}
.source-request-results__actions {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.source-request-results footer {
  display: flex;
  flex: none;
  justify-content: flex-end;
  gap: var(--space-2);
  padding-top: var(--space-4);
  border-top: 1px solid var(--border-primary);
}
@media (max-width: 640px) {
  .source-request-backdrop {
    padding: var(--space-3);
  }
  .source-request-results {
    padding: var(--space-4);
  }
  .source-request-results li {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-3);
  }
  .source-request-results__actions {
    grid-column: 1 / -1;
    flex-direction: row;
    flex-wrap: wrap;
  }
  .source-request-results footer > * {
    flex: 1;
  }
}
</style>
