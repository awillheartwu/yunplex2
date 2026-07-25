<template>
  <section class="system-runtime" aria-labelledby="system-runtime-title">
    <div class="system-runtime__heading">
      <h2 id="system-runtime-title">运行环境</h2>
      <p>用于诊断的辅助信息</p>
    </div>
    <dl class="system-runtime__items">
      <div v-for="item in runtimeItems" :key="item.label" class="system-runtime__item">
        <dt>{{ item.label }}</dt>
        <dd :class="{ 'font-mono': item.mono }">{{ item.value }}</dd>
      </div>
    </dl>
  </section>
</template>

<script setup lang="ts">
import type { SystemInfo, SystemStats } from '~~/composables/useSystemPage'

const props = defineProps<{
  info: SystemInfo | null
  stats: SystemStats | null
  dependencyCheckedLabel: string
  formatUptime: (seconds: number) => string
}>()

const runtimeItems = computed(() => [
  { label: '版本', value: `YunPlex2 v${props.info?.version ?? '-'}` },
  { label: props.info?.docker ? 'Docker' : '平台', value: props.info?.platform ?? '-' },
  { label: 'Node.js', value: props.info?.nodeVersion ?? '-', mono: true },
  { label: 'PID', value: props.stats?.pid ? String(props.stats.pid) : '-', mono: true },
  { label: '运行时间', value: props.formatUptime(props.stats?.uptime || 0) },
  { label: '依赖检测', value: props.dependencyCheckedLabel },
])
</script>

<style scoped>
.system-runtime {
  display: grid;
  grid-template-columns: minmax(10rem, 0.7fr) minmax(0, 4.3fr);
  align-items: center;
  gap: 1.5rem;
  padding: 0.25rem 0.25rem 0;
  border-top: 1px solid var(--border-primary);
}

.system-runtime__heading {
  padding: 1rem 0.75rem;
}

.system-runtime__heading h2 {
  color: var(--text-secondary);
  font-size: 0.78rem;
  font-weight: 650;
}

.system-runtime__heading p {
  margin-top: 0.2rem;
  color: var(--text-muted);
  font-size: 0.68rem;
}

.system-runtime__items {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  margin: 0;
}

.system-runtime__item {
  min-width: 0;
  padding: 0.85rem 1rem;
  border-left: 1px solid var(--border-primary);
}

.system-runtime__item dt {
  color: var(--text-muted);
  font-size: 0.68rem;
  line-height: 1.3;
}

.system-runtime__item dd {
  overflow: hidden;
  margin: 0.3rem 0 0;
  color: var(--text-primary);
  font-size: 0.78rem;
  font-weight: 550;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 1100px) {
  .system-runtime {
    grid-template-columns: 1fr;
    gap: 0;
  }

  .system-runtime__heading {
    padding-bottom: 0.5rem;
  }

  .system-runtime__items {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .system-runtime__item:first-child,
  .system-runtime__item:nth-child(4) {
    border-left: 0;
  }
}

@media (max-width: 640px) {
  .system-runtime__items {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .system-runtime__item:nth-child(odd) {
    border-left: 0;
  }

  .system-runtime__item:nth-child(4) {
    border-left: 1px solid var(--border-primary);
  }
}
</style>
