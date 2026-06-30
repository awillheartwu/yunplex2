<template>
  <section class="section-card system-health">
    <div class="system-health__header">
      <div>
        <p class="text-2xs text-muted-deep">健康概览</p>
        <h3 :class="headlineClass">{{ headline }}</h3>
        <p class="text-2xs text-muted">依赖检测于 {{ dependencyCheckedLabel }}</p>
      </div>
      <div class="system-health__actions">
        <button class="btn btn-secondary btn-xs" type="button" :disabled="refreshing" @click="$emit('refresh')">
          <AppIcon :name="refreshing ? 'loader' : 'refresh'" :size="14" :class="{ 'animate-spin': refreshing }" />
          重新检测
        </button>
        <button class="btn btn-secondary btn-xs" type="button" @click="$emit('copy-diagnostics')">
          <AppIcon name="copy" :size="14" />
          复制诊断信息
        </button>
      </div>
    </div>

    <div class="system-health__grid">
      <article v-for="item in items" :key="item.key" class="system-health__item" :class="`system-health__item--${item.tone}`">
        <div class="system-health__icon">
          <AppIcon :name="item.tone === 'ok' ? 'checkCircle' : item.tone === 'warning' ? 'warn' : item.tone === 'error' ? 'failure' : 'info'" :size="15" />
        </div>
        <div>
          <p>{{ item.label }}</p>
          <strong>{{ item.value }}</strong>
          <span>{{ item.detail }}</span>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { SystemHealthItem } from '~~/composables/useSystemPage'

const props = defineProps<{
  items: SystemHealthItem[]
  overallTone: 'ok' | 'warning' | 'error' | 'idle'
  dependencyCheckedLabel: string
  refreshing: boolean
}>()

defineEmits<{
  refresh: []
  'copy-diagnostics': []
}>()

const headline = computed(() => {
  if (props.overallTone === 'error') return '有依赖需要处理'
  if (props.overallTone === 'warning') return '系统运行中，建议关注'
  if (props.overallTone === 'ok') return '系统状态正常'
  return '等待健康检查'
})
const headlineClass = computed(() => ({
  'text-success': props.overallTone === 'ok',
  'text-warning': props.overallTone === 'warning',
  'text-danger': props.overallTone === 'error',
}))
</script>

<style scoped>
.system-health {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1rem;
}

.system-health__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.system-health__header h3 {
  margin-top: 0.15rem;
  font-size: 1rem;
  font-weight: 700;
}

.system-health__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
}

.system-health__grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.75rem;
}

.system-health__item {
  display: flex;
  min-width: 0;
  gap: 0.65rem;
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  padding: 0.8rem;
  background: var(--bg-elevated);
}

.system-health__item p,
.system-health__item span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.system-health__item p {
  color: var(--text-tertiary);
  font-size: 0.7rem;
}

.system-health__item strong {
  display: block;
  margin-block: 0.1rem;
  color: var(--text-primary);
  font-size: 0.88rem;
}

.system-health__item span {
  display: block;
  color: var(--text-tertiary);
  font-size: 0.68rem;
}

.system-health__icon {
  display: flex;
  width: 1.75rem;
  height: 1.75rem;
  flex: 0 0 1.75rem;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
}

.system-health__item--ok .system-health__icon { color: var(--success); background: rgba(34, 197, 94, 0.12); }
.system-health__item--warning .system-health__icon { color: var(--warning); background: rgba(245, 158, 11, 0.12); }
.system-health__item--error .system-health__icon { color: var(--danger); background: rgba(239, 68, 68, 0.12); }
.system-health__item--idle .system-health__icon { color: var(--text-tertiary); background: var(--bg-muted); }

@media (max-width: 1024px) {
  .system-health__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 640px) {
  .system-health__header { flex-direction: column; }
  .system-health__actions { width: 100%; justify-content: stretch; }
  .system-health__actions .btn { flex: 1; }
  .system-health__grid { grid-template-columns: 1fr; }
}
</style>
