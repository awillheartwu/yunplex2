<script setup lang="ts">
import { buildPageItems, clampPage, pageCount, pageRangeLabel } from '~/lib/pagination'

const props = withDefaults(defineProps<{
  page: number
  pageSize: number
  total: number
  label: string
  loading?: boolean
}>(), { loading: false })

const emit = defineEmits<{ change: [page: number] }>()

const totalPages = computed(() => pageCount(props.total, props.pageSize))
const currentPage = computed(() => clampPage(props.page, totalPages.value))
const items = computed(() => buildPageItems(currentPage.value, totalPages.value))
const rangeLabel = computed(() => pageRangeLabel(currentPage.value, props.pageSize, props.total))
const jumpValue = ref(String(currentPage.value))

watch(currentPage, value => { jumpValue.value = String(value) })

function select(next: number) {
  if (props.loading) return
  const target = clampPage(next, totalPages.value)
  if (target !== currentPage.value) emit('change', target)
}

/** The input returns to the visible page until the requested page really loads, so a failed jump keeps the old page. */
function submitJump() {
  if (props.loading) return
  const parsed = Number.parseInt(String(jumpValue.value).trim(), 10)
  const target = Number.isFinite(parsed) ? clampPage(parsed, totalPages.value) : currentPage.value
  jumpValue.value = String(currentPage.value)
  if (target !== currentPage.value) emit('change', target)
}
</script>

<template>
  <nav
    v-if="totalPages > 1"
    class="page-navigation"
    :class="{ 'page-navigation--busy': loading }"
    :aria-label="`${label}分页`"
    :aria-busy="loading ? 'true' : undefined"
  >
    <p class="page-navigation__range" role="status">{{ rangeLabel }}</p>
    <div class="page-navigation__controls">
      <button class="btn btn-secondary btn-sm" type="button" :disabled="loading || currentPage <= 1" @click="select(currentPage - 1)">上一页</button>
      <ul class="page-navigation__pages" role="list" :aria-label="`${label}页码列表`">
        <li v-for="item in items" :key="item.type === 'page' ? item.page : item.key">
          <button
            v-if="item.type === 'page'"
            class="btn btn-ghost btn-sm page-navigation__page"
            :class="{ 'page-navigation__page--current': item.page === currentPage }"
            type="button"
            :disabled="loading"
            :aria-current="item.page === currentPage ? 'page' : undefined"
            :aria-label="`第 ${item.page} 页`"
            @click="select(item.page)"
          >
            {{ item.page }}
          </button>
          <span v-else class="page-navigation__ellipsis" aria-hidden="true">…</span>
        </li>
      </ul>
      <button class="btn btn-secondary btn-sm" type="button" :disabled="loading || currentPage >= totalPages" @click="select(currentPage + 1)">下一页</button>
      <span class="page-navigation__compact">{{ currentPage }} / {{ totalPages }}</span>
      <form v-if="totalPages > 7" class="page-navigation__jump" @submit.prevent="submitJump">
        <span aria-hidden="true">跳至</span>
        <input
          v-model="jumpValue"
          class="form-input page-navigation__jump-input"
          type="number"
          inputmode="numeric"
          min="1"
          :max="totalPages"
          :aria-label="`${label}页码`"
          :disabled="loading"
        >
        <span aria-hidden="true">页</span>
        <button class="btn btn-secondary btn-sm" type="submit" :disabled="loading">跳转</button>
      </form>
    </div>
  </nav>
</template>

<style scoped>
.page-navigation{border-top:1px solid var(--border-primary);padding-bottom:var(--space-2);display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:var(--space-3);padding-top:var(--space-3);color:var(--text-secondary);font-size:var(--text-sm)}
.page-navigation__range{margin:0;color:var(--text-tertiary);font-size:var(--text-xs);font-variant-numeric:tabular-nums}
.page-navigation__controls{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-2);min-width:0}
.page-navigation__pages{display:flex;flex-wrap:wrap;align-items:center;gap:var(--space-1);margin:0;padding:0;list-style:none}
.page-navigation__page{min-width:var(--control-height);padding:0 var(--space-2);color:var(--text-secondary);font-variant-numeric:tabular-nums}
.page-navigation__page--current{border-color:var(--accent-border);background:var(--accent-muted);color:var(--accent);font-weight:var(--font-weight-semibold)}
.page-navigation__ellipsis{padding:0 var(--space-1);color:var(--text-tertiary)}
.page-navigation__jump{display:flex;align-items:center;gap:var(--space-1_5);color:var(--text-tertiary);font-size:var(--text-xs)}
.page-navigation__jump-input{width:4.5rem;min-height:var(--control-height);padding:0 var(--space-2);text-align:center;font-variant-numeric:tabular-nums}
.page-navigation--busy{cursor:progress}
.page-navigation__compact{display:none}
@media (max-width:640px){
  .page-navigation{justify-content:flex-start}
  .page-navigation__controls{width:100%;justify-content:space-between}
  .page-navigation__compact{display:inline;color:var(--text-secondary);font-variant-numeric:tabular-nums}
  .page-navigation__jump{display:none}
  .page-navigation__pages{display:none}
}
</style>
