<template>
  <section class="section-card p-4" aria-labelledby="system-data-stats-title">
    <header class="system-data-stats__header">
      <div>
        <h2 id="system-data-stats-title" class="text-2xs text-muted-deep">数据统计</h2>
        <p class="system-data-stats__summary">
          {{ rows.length }} 张表 · {{ totalRowCount.toLocaleString() }} 行
        </p>
      </div>
      <span class="system-data-stats__hint">按数据域分类</span>
    </header>

    <div v-if="groups.length > 0" class="system-data-groups">
      <section
        v-for="group in groups"
        :key="group.key"
        class="system-data-group"
        :class="`system-data-group--${group.key}`"
        :aria-labelledby="`system-data-group-${group.key}`"
      >
        <div class="system-data-group__header">
          <h3 :id="`system-data-group-${group.key}`">{{ group.label }}</h3>
          <span>{{ group.rows.length }} 张表</span>
        </div>
        <ul class="system-data-group__rows">
          <li v-for="row in group.rows" :key="row.name" class="system-table-row">
            <div class="system-table-row__identity">
              <span class="font-mono" style="color:var(--text-primary)">{{ row.name }}</span>
              <span class="system-table-row__desc text-muted-deep">{{ row.desc }}</span>
            </div>
            <div class="system-table-row__meta">
              <span class="system-table-row__count">{{ row.count.toLocaleString() }} 行</span>
              <NuxtLink
                v-if="row.href"
                :to="row.href"
                class="btn btn-ghost btn-xs"
                :aria-label="`查看${row.desc}`"
              >
                查看
              </NuxtLink>
            </div>
          </li>
        </ul>
      </section>
    </div>
    <p v-else class="text-2xs text-muted">暂无数据</p>
  </section>
</template>

<script setup lang="ts">
import type { SystemDataTableRow } from '~~/lib/system-data-catalog'

const props = defineProps<{
  rows: SystemDataTableRow[]
}>()

const totalRowCount = computed(() => props.rows.reduce((sum, row) => sum + row.count, 0))
const groups = computed(() => {
  const grouped = new Map<string, { key: string; label: string; rows: SystemDataTableRow[] }>()
  for (const row of props.rows) {
    const current = grouped.get(row.group)
    if (current) current.rows.push(row)
    else grouped.set(row.group, { key: row.group, label: row.groupLabel, rows: [row] })
  }
  return [...grouped.values()]
})
</script>

<style scoped>
.system-data-stats__header,
.system-data-group__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.system-data-stats__header {
  margin-bottom: 1rem;
}

.system-data-stats__summary {
  margin-top: 0.25rem;
  color: var(--text-primary);
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
}

.system-data-stats__hint,
.system-data-group__header span {
  color: var(--text-muted);
  font-size: 0.68rem;
  white-space: nowrap;
}

.system-data-groups {
  display: grid;
  gap: 0.75rem;
}

.system-data-group {
  min-width: 0;
  padding: 0.9rem;
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--bg-muted) 48%, transparent);
}

.system-data-group + .system-data-group {
  padding-top: 0.9rem;
}

.system-data-group__header {
  margin-bottom: 0.55rem;
}

.system-data-group__header h3 {
  color: var(--text-secondary);
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.system-data-group__rows {
  display: grid;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.system-table-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}

.system-table-row__meta {
  display: contents;
}

.system-table-row__desc {
  display: block;
  margin-top: 0.12rem;
  line-height: 1.35;
}

.system-table-row__count {
  color: var(--text-primary);
  text-align: right;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}

.system-table-row__meta .btn {
  justify-self: end;
  min-width: 3.5rem;
}

@media (min-width: 1180px) {
  .system-data-groups {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    align-items: start;
  }

  .system-data-group--matching {
    grid-column: 1 / -1;
  }

  .system-data-group--matching .system-data-group__rows {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: 2rem;
  }
}

@media (max-width: 640px) {
  .system-data-stats__hint {
    display: none;
  }

  .system-table-row {
    grid-template-columns: minmax(0, 1fr);
    gap: 0.45rem;
    padding: 0.7rem 0;
    border-bottom: 1px solid var(--border-primary);
  }

  .system-table-row:last-child {
    border-bottom: 0;
  }

  .system-table-row__identity {
    display: grid;
    gap: 0.18rem;
  }

  .system-table-row__desc {
    margin-top: 0;
    line-height: 1.45;
  }

  .system-table-row__meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .system-table-row__count { text-align: left; }
  .system-table-row__meta .btn { justify-self: start; }
}
</style>
