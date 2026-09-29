<template>
  <section class="section-card system-health">
    <div class="system-health__header">
      <div>
        <div class="system-health__title"><h2>服务状态</h2><span class="system-health__summary" :class="headlineClass"><i aria-hidden="true" />{{ headline }}</span></div>
        <p class="system-health__checked">最近检测 · {{ dependencyCheckedLabel }}</p>
      </div>
      <div class="system-health__actions">
        <NuxtLink to="/system?tab=logs" class="btn btn-secondary btn-xs">
          <AppIcon name="logs" :size="14" />
          查看日志
        </NuxtLink>
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
        <div class="system-health__icon"><AppIcon :name="serviceIcon(item.key)" :size="19" /></div>
        <div class="system-health__identity"><h3>{{ item.label }}</h3><p>{{ item.detail }}</p></div>
        <span class="system-health__value"><AppIcon :name="item.tone === 'ok' ? 'checkCircle' : item.tone === 'idle' ? 'clock' : 'warn'" :size="14" />{{ item.value }}</span>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { SystemHealthItem } from '~~/composables/useSystemMonitor'

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

function serviceIcon(key: string) { return ({ plex: 'source', netease: 'music', 'download-dir': 'folder', sync: 'sync' } as Record<string, string>)[key] || 'info' }

const headline = computed(() => {
  if (props.overallTone === 'error') return '有项目需要处理'
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
.system-health { padding: var(--space-5); }
.system-health__header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-4); margin-bottom: var(--space-4); }
.system-health__title { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
.system-health__title h2 { margin: 0; }
.system-health__summary { display: inline-flex; align-items: center; gap: var(--space-1_5); font-size: var(--text-xs); }
.system-health__summary i { width: .375rem; height: .375rem; border-radius: var(--radius-full); background: currentColor; }
.system-health__checked { margin: var(--space-1) 0 0; color: var(--text-tertiary); font-size: var(--text-xs); }
.system-health__actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.system-health__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-top: 1px solid var(--border-primary); }
.system-health__item { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: var(--space-3); padding: var(--space-4) 0; min-width: 0; }
.system-health__item:nth-child(odd) { padding-right: var(--space-5); }
.system-health__item:nth-child(even) { padding-left: var(--space-5); border-left: 1px solid var(--border-primary); }
.system-health__item:nth-child(n+3) { border-top: 1px solid var(--border-primary); }
.system-health__icon { display: flex; align-items: center; justify-content: center; width: 2.25rem; height: 2.25rem; border-radius: var(--radius-sm); color: var(--text-secondary); background: var(--bg-input); }
.system-health__identity { min-width: 0; }
.system-health__identity h3 { margin: 0; }
.system-health__identity p { margin: var(--space-1) 0 0; font-size: var(--text-xs); color: var(--text-secondary); overflow-wrap: anywhere; }
.system-health__value { display: inline-flex; align-items: center; gap: var(--space-1); font-size: var(--text-xs); white-space: nowrap; color: var(--text-secondary); }
.system-health__item--ok .system-health__value { color: var(--success); }
.system-health__item--warning .system-health__value { color: var(--warning); }
.system-health__item--error .system-health__value { color: var(--danger); }
@media(max-width:900px) {
  .system-health__grid { grid-template-columns: 1fr; }
  .system-health__item:nth-child(odd),.system-health__item:nth-child(even) { padding: var(--space-4) 0; border-left: 0; }
  .system-health__item + .system-health__item { border-top: 1px solid var(--border-primary); }
}
@media(max-width:480px) {
  .system-health { padding: var(--space-4); }
  .system-health__item { gap: var(--space-2); }
}
</style>
