<template>
  <div class="matching-alias-editor">
    <div class="matching-alias-editor__toolbar">
      <p class="matching-alias-editor__hint">
        {{ kind === 'title' ? '把标题中的旧写法归一到同一个标题。' : '把艺人的旧写法归一到同一个艺人。' }}支持一个规则包含多个别名，匹配时只作为候选建议。
      </p>
      <button type="button" class="btn btn-secondary btn-sm" @click="addRule">
        <AppIcon name="plus" :size="14" />添加规则
      </button>
    </div>

    <div v-if="modelValue.length" class="matching-alias-table" role="table" :aria-label="`${kind === 'title' ? '标题' : '艺人'}别名规则`">
      <div class="matching-alias-table__head" role="row">
        <span role="columnheader">状态</span>
        <span role="columnheader">标准名称</span>
        <span role="columnheader">可识别的别名</span>
        <span role="columnheader">操作</span>
      </div>
      <div v-for="(rule, index) in modelValue" :key="index" class="matching-alias-table__row" role="row">
        <label class="matching-alias-table__enabled" :for="`matching-alias-enabled-${kind}-${index}`">
          <input
            :id="`matching-alias-enabled-${kind}-${index}`"
            type="checkbox"
            :checked="rule.enabled"
            :aria-label="`${rule.name || '未命名规则'}：启用`"
            @change="updateRule(index, { enabled: ($event.target as HTMLInputElement).checked })"
          >
          <span>{{ rule.enabled ? '启用' : '停用' }}</span>
        </label>
        <label class="matching-alias-table__field">
          <span class="sr-only">第 {{ index + 1 }} 条规则的标准名称</span>
          <input
            :value="rule.name"
            class="form-input"
            type="text"
            :placeholder="kind === 'title' ? '标准标题' : '标准艺人名'"
            :aria-label="`第 ${index + 1} 条规则的标准名称`"
            @input="updateRule(index, { name: ($event.target as HTMLInputElement).value })"
          >
        </label>
        <label class="matching-alias-table__field">
          <span class="sr-only">第 {{ index + 1 }} 条规则的别名</span>
          <textarea
            :value="rule.aliases.join('\n')"
            class="form-input matching-alias-table__aliases"
            rows="2"
            :placeholder="'每行一个别名，保留名称中的逗号'"
            :aria-label="`第 ${index + 1} 条规则的别名`"
            @change="updateRule(index, { aliases: parseAliases(($event.target as HTMLTextAreaElement).value) })"
          />
          <span class="matching-alias-table__count">{{ rule.aliases.length }} 个别名</span>
        </label>
        <button type="button" class="icon-button matching-alias-table__remove" :aria-label="`删除第 ${index + 1} 条规则`" @click="removeRule(index)">
          <AppIcon name="trash" :size="15" />
        </button>
      </div>
    </div>
    <p v-else class="matching-alias-editor__empty">还没有{{ kind === 'title' ? '标题' : '艺人' }}别名规则。只有明确添加或导入后才会参与预览。</p>
  </div>
</template>

<script setup lang="ts">
import type { MatchingAlias } from '~~/shared/initialization-matching'

const props = withDefaults(defineProps<{
  modelValue: MatchingAlias[]
  kind?: 'artist' | 'title'
}>(), { kind: 'artist' })

const emit = defineEmits<{
  'update:modelValue': [value: MatchingAlias[]]
}>()

function cloneRules(rules: MatchingAlias[]): MatchingAlias[] {
  return rules.map(rule => ({ ...rule, aliases: [...rule.aliases] }))
}

function updateRules(next: MatchingAlias[]) {
  emit('update:modelValue', cloneRules(next))
}

function addRule() {
  updateRules([...props.modelValue, { name: '', aliases: [], enabled: true }])
}

function updateRule(index: number, patch: Partial<MatchingAlias>) {
  const next = cloneRules(props.modelValue)
  const current = next[index]
  if (!current) return
  next[index] = { ...current, ...patch, aliases: patch.aliases ? [...patch.aliases] : current.aliases }
  updateRules(next)
}

function removeRule(index: number) {
  updateRules(props.modelValue.filter((_, currentIndex) => currentIndex !== index))
}

function parseAliases(value: string): string[] {
  return [...new Set(value.split(/\n/).map(alias => alias.trim()).filter(Boolean))]
}

</script>

<style scoped>
.matching-alias-editor {
  display: grid;
  gap: var(--space-3);
}

.matching-alias-editor__toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.matching-alias-editor__hint,
.matching-alias-editor__empty {
  margin: 0;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  line-height: var(--body-leading);
}

.matching-alias-table {
  overflow: hidden;
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  background: var(--bg-input);
}

.matching-alias-table__head,
.matching-alias-table__row {
  display: grid;
  grid-template-columns: 5.5rem minmax(9rem, 0.8fr) minmax(12rem, 1.6fr) 2.75rem;
  align-items: start;
  gap: var(--space-3);
  padding: var(--space-3);
}

.matching-alias-table__head {
  border-bottom: 1px solid var(--border-primary);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-semibold);
}

.matching-alias-table__row + .matching-alias-table__row {
  border-top: 1px solid var(--border-primary);
}

.matching-alias-table__enabled {
  display: flex;
  min-height: 2.5rem;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-secondary);
  font-size: var(--text-xs);
}

.matching-alias-table__enabled input {
  width: 1rem;
  height: 1rem;
  accent-color: var(--accent);
}

.matching-alias-table__field {
  display: grid;
  min-width: 0;
  gap: var(--space-1);
}

.matching-alias-table__aliases {
  min-height: 4.1rem;
  resize: vertical;
}

.matching-alias-table__count {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.matching-alias-table__remove {
  color: var(--danger);
}

@media (max-width: 767px) {
  .matching-alias-editor__toolbar {
    flex-direction: column;
  }

  .matching-alias-editor__toolbar .btn {
    width: 100%;
    justify-content: center;
  }

  .matching-alias-table__head {
    display: none;
  }

  .matching-alias-table__row {
    grid-template-columns: minmax(0, 1fr) 2.75rem;
    gap: var(--space-2);
  }

  .matching-alias-table__enabled {
    grid-column: 1;
    min-height: 2rem;
  }

  .matching-alias-table__field {
    grid-column: 1;
  }

  .matching-alias-table__remove {
    grid-column: 2;
    grid-row: 1;
  }
}
</style>
