<script setup lang="ts">
const props = defineProps<{ page: number; pageSize: number; total: number; label: string }>()
defineEmits<{ change: [page: number] }>()
const pages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))
</script>

<template>
  <nav v-if="pages > 1" class="page-navigation" :aria-label="`${label}分页`">
    <span role="status">第 {{ (page - 1) * pageSize + 1 }}–{{ Math.min(page * pageSize, total) }} 项，共 {{ total }} 项</span>
    <div>
      <button class="btn btn-secondary btn-sm" :disabled="page <= 1" @click="$emit('change', page - 1)">上一页</button>
      <label><span>页码</span> <select :value="page" class="form-input" :aria-label="`${label}页码`" @change="$emit('change', Number(($event.target as HTMLSelectElement).value))"><option v-for="n in pages" :key="n" :value="n">{{ n }} / {{ pages }}</option></select></label>
      <button class="btn btn-secondary btn-sm" :disabled="page >= pages" @click="$emit('change', page + 1)">下一页</button>
    </div>
  </nav>
</template>

<style scoped>
.page-navigation { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); color: var(--text-secondary); font-size: var(--text-sm); padding-top: var(--space-3); }
.page-navigation > div, .page-navigation label { display: flex; align-items: center; gap: var(--space-2); }
.page-navigation select { width: auto; }
@media (max-width: 480px) {
  .page-navigation > div { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; width: 100%; }
  .page-navigation label { justify-content: center; min-width: 0; }
  .page-navigation label > span { display: none; }
  .page-navigation select { width: 100%; min-width: 0; }
}
</style>
