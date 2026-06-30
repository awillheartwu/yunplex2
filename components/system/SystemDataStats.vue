<template>
  <section class="section-card p-4">
    <p class="mb-3 text-2xs text-muted-deep">数据统计</p>
    <div v-if="rows.length > 0" class="space-y-2 text-xs">
      <div v-for="row in rows" :key="row.name" class="system-table-row">
        <div class="min-w-0">
          <span class="font-mono" style="color:var(--text-primary)">{{ row.name }}</span>
          <span class="ml-2 text-muted-deep">{{ row.desc }}</span>
        </div>
        <div class="system-table-row__actions">
          <span style="color:var(--text-primary)">{{ row.count.toLocaleString() }} 行</span>
          <NuxtLink v-if="row.href" :to="row.href" class="btn btn-ghost btn-xs">查看</NuxtLink>
        </div>
      </div>
    </div>
    <p v-else class="text-2xs text-muted">暂无数据</p>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  rows: Array<{ name: string; count: number; desc: string; href?: string }>
}>()
</script>

<style scoped>
.system-table-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.system-table-row__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 0.5rem;
}

@media (max-width: 640px) {
  .system-table-row {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
