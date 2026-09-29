<template>
  <ol class="manual-steps" aria-label="添加音乐步骤">
    <li
      v-for="(step, index) in steps"
      :key="step.label"
      :class="`is-${step.state}`"
      :aria-current="index === current ? 'step' : undefined"
    >
      <div class="manual-steps__item">
        <span class="manual-steps__marker" aria-hidden="true"
          ><AppIcon v-if="step.state === 'success'" name="check" :size="16" /><AppIcon
            v-else-if="step.state === 'error' || step.state === 'warning'"
            name="warn"
            :size="16"
          /><AppIcon v-else-if="step.state === 'busy'" name="loader" :size="16" class="animate-spin" /><span v-else>{{
            index + 1
          }}</span></span
        >
        <span class="manual-steps__copy"
          ><strong>{{ step.label }}</strong
          ><span>{{ step.description }}</span></span
        >
      </div>
      <AppIcon v-if="index < 2" name="chevronRight" :size="16" class="manual-steps__arrow" aria-hidden="true" />
    </li>
  </ol>
</template>
<script setup lang="ts">
import type { ParseState } from '~~/composables/useManualDownload'
const props = defineProps<{
  parseState: ParseState
  dirty: boolean
  downloading: boolean
  submitted: boolean
  error: string
  hasWarnings: boolean
  empty: boolean
}>()
const current = computed(() =>
  props.parseState !== 'preview' || props.dirty ? 0 : props.submitted || props.downloading || props.error ? 2 : 1,
)
const steps = computed(() => {
  const items = [
    { label: '输入来源', state: 'pending', description: '等待输入' },
    { label: '确认歌曲', state: 'pending', description: '等待解析' },
    { label: '提交下载', state: 'pending', description: '等待确认' },
  ]
  for (let i = 0; i < current.value; i++)
    items[i] = { ...items[i]!, state: 'success', description: i === 0 ? '解析成功' : '已确认' }
  const item = items[current.value]!
  item.state = 'current'
  item.description = current.value === 0 ? (props.dirty ? '需要重新解析' : '粘贴链接或 ID') : '选择下载歌曲'
  if (props.parseState === 'parsing' || props.downloading) {
    item.state = 'busy'
    item.description = props.downloading ? '正在提交' : '正在解析'
  } else if (props.error && !props.dirty) {
    item.state = 'error'
    item.description = current.value === 0 ? '解析失败' : '提交失败'
  } else if (props.submitted) {
    item.state = props.hasWarnings ? 'warning' : 'success'
    item.description = props.hasWarnings ? '已返回提交结果' : '任务已提交'
  } else if (current.value === 1 && (props.empty || props.hasWarnings)) {
    item.state = 'warning'
    item.description = props.empty ? '没有可下载歌曲' : '部分歌曲不可用'
  }
  return items
})
</script>
<style scoped>
.manual-steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-4);
  list-style: none;
  padding: var(--space-4) 0;
  margin: 0;
  border-block: 1px solid var(--border-primary);
}
.manual-steps li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-width: 0;
  color: var(--text-tertiary);
}
.manual-steps__item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}
.manual-steps__marker {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 2rem;
  height: 2rem;
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-full);
  font-size: var(--text-sm);
  background: var(--bg-surface);
}
.manual-steps__copy {
  display: flex;
  flex-direction: column;
  gap: var(--space-0_5);
}
.manual-steps__copy strong {
  font-size: var(--text-base);
  font-weight: var(--font-weight-medium);
}
.manual-steps__copy > span {
  font-size: var(--text-xs);
}
.manual-steps__arrow {
  flex: none;
  color: var(--text-tertiary);
}
.manual-steps li.is-current,
.manual-steps li.is-busy {
  color: var(--accent);
}
.manual-steps li.is-success {
  color: var(--success);
}
.manual-steps li.is-error {
  color: var(--danger);
}
.manual-steps li.is-warning {
  color: var(--warning);
}
.is-current .manual-steps__marker,
.is-busy .manual-steps__marker {
  background: var(--accent-muted);
  border-color: var(--accent);
}
.is-success .manual-steps__marker {
  background: var(--success-soft);
  border-color: var(--success-border);
}
.is-error .manual-steps__marker {
  background: var(--danger-soft);
  border-color: var(--danger-border);
}
.is-warning .manual-steps__marker {
  background: var(--warning-soft);
  border-color: var(--warning-border);
}
@media (max-width: 720px) {
  .manual-steps {
    gap: var(--space-2);
  }
  .manual-steps li {
    align-items: flex-start;
    gap: var(--space-1);
  }
  .manual-steps__item {
    align-items: flex-start;
    flex-direction: column;
    gap: var(--space-2);
  }
  .manual-steps__copy strong {
    font-size: var(--text-sm);
  }
  .manual-steps__arrow {
    align-self: flex-start;
    margin-top: var(--space-2);
  }
}
</style>
