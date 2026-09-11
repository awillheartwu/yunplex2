<template>
  <div class="config-savebar" :class="{ 'has-changes': changed }" aria-label="配置操作"><div><span class="config-savebar__dot" /><strong>{{ changed ? '有未保存的修改' : '所有设置已同步' }}</strong><small>修改会在保存后生效</small></div><button v-if="changed" class="btn btn-ghost btn-sm" :disabled="saving" @click="$emit('discard')">放弃修改</button><button class="btn btn-primary" :disabled="disabled || saving" @click="$emit('save')"><AppIcon :name="saving ? 'loader' : 'check'" :size="15" :class="{ 'animate-spin': saving }" />{{ saving ? '保存中…' : '保存配置' }}</button></div>
</template>
<script setup lang="ts">
defineProps<{ changed: boolean; saving: boolean; disabled: boolean }>()
defineEmits<{ save: []; discard: [] }>()
</script>
<style scoped>
.config-savebar {
  position: sticky;
  bottom: var(--floating-bottom);
  z-index: var(--z-dropdown);
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-3_5) var(--space-5);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  box-shadow: var(--shadow-md);
}
.config-savebar.has-changes {
  border-color: var(--accent);
}
.config-savebar > div {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--space-2_5);
  flex-wrap: wrap;
}
.config-savebar strong {
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
}
.config-savebar small {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
.config-savebar__dot {
  width: 0.45rem;
  height: 0.45rem;
  background: var(--success);
  border-radius: 50%;
}
.has-changes .config-savebar__dot {
  background: var(--accent);
}
@media (max-width: 767px) {
  .config-savebar {
    flex-wrap: wrap;
    gap: var(--space-2);
    padding: var(--space-3);
  }
  .config-savebar > div {
    flex-basis: 100%;
  }
  .config-savebar small {
    display: none;
  }
  .config-savebar > .btn {
    flex: 1;
  }
  .config-savebar > div strong {
    font-size: var(--text-xs);
  }
}
</style>
