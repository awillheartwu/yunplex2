<template>
  <div class="extra-tracks-policy">
    <FormField setting="sync.extraTrackRemovalPolicy" label="Plex 多余歌曲" search-section="sync" search-keywords="删除 清理 严格保护 平衡清理 精确对齐 保留" hint="只清理歌单条目，保留音乐文件。">
      <select :value="selection" class="form-input" :aria-label="settingLabel('sync.extraTrackRemovalPolicy')" @change="updateSelection">
        <option v-if="inherit" value="inherit">使用全局设置</option>
        <option value="keep">保留全部</option>
        <template v-if="inherit"><option value="cleanup">按全局策略清理{{ policyLabel ? `（${policyLabel}）` : '' }}</option></template>
        <template v-else><option v-for="option in policies" :key="option.value" :value="option.value">{{ option.label }}</option></template>
      </select>
    </FormField>
    <p class="extra-tracks-policy__description">{{ description }}</p>
  </div>
</template>

<script setup lang="ts">
import type { ExtraTrackRemovalPolicy } from '~~/server/lib/config/types'
import { settingLabel } from '~/lib/settings-catalog'

const props = withDefaults(defineProps<{
  modelValue: boolean | null
  policy: ExtraTrackRemovalPolicy | null
  inherit?: boolean
  globalSkip?: boolean | null
}>(), { inherit: false, globalSkip: null })
const emit = defineEmits<{
  'update:modelValue': [value: boolean | null]
  'update:policy': [value: ExtraTrackRemovalPolicy]
}>()
const policies = [
  { value: 'strict', label: '严格保护', description: '只移除能确认归属的多余条目。' },
  { value: 'balanced', label: '平衡清理', description: '已确认归属的多余条目直接移除，其余条目连续两次确认为多余后移除。' },
  { value: 'exact', label: '精确对齐', description: '目标完整时立即移除所有多余条目，包含无法确认归属的条目。' },
] as const
const policyLabel = computed(() => policies.find(option => option.value === props.policy)?.label)
const selection = computed(() => {
  if (props.inherit) return props.modelValue === null ? 'inherit' : props.modelValue ? 'keep' : 'cleanup'
  return props.modelValue ? 'keep' : props.policy
})
const description = computed(() => {
  const skip = props.modelValue ?? props.globalSkip
  if (skip === null) return '全局设置尚未读取。'
  if (skip) return '保留 Plex 歌单中网易云已移除的歌曲。'
  const option = policies.find(item => item.value === props.policy)
  if (!option) return '清理策略尚未读取。'
  return props.inherit ? `当前使用${option.label}：${option.description}` : option.description
})
function updateSelection(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (value === 'inherit') emit('update:modelValue', null)
  else if (value === 'keep') emit('update:modelValue', true)
  else {
    emit('update:modelValue', false)
    const policy = policies.find(option => option.value === value)
    if (policy) emit('update:policy', policy.value)
  }
}
</script>

<style scoped>
.extra-tracks-policy { display: grid; gap: var(--space-2); }
.extra-tracks-policy__description {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  line-height: var(--body-leading);
}
</style>
