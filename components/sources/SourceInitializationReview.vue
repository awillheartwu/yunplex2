<script setup lang="ts">
import type { InitializationDecision, InitializationReviewItem } from '../../composables/useSourceInitialization'

const props = defineProps<{
  items: InitializationReviewItem[]
  total: number
  page: number
  pageSize: number
  selected: Set<number>
  loading: boolean
  acting: boolean
  editable: boolean
  search: string
  tier: string
  decision: string
  tierOptions: Array<{ value: string; label: string }>
  tierLabel: (value: string) => string
}>()

const emit = defineEmits<{
  'update:search': [value: string]
  'update:tier': [value: string]
  'update:decision': [value: string]
  clear: []
  reload: []
  toggle: [item: InitializationReviewItem]
  togglePage: []
  decide: [songId: number, decision: InitializationDecision]
  openEvidence: [item: InitializationReviewItem]
  changePage: [page: number]
}>()

const actionablePageItems = computed(() => props.items.filter(item => props.editable && item.kind === 'actionable' && item.allowedDecisions.length > 0))
const allPageSelected = computed(() => actionablePageItems.value.length > 0 && actionablePageItems.value.every(item => props.selected.has(item.neteaseSongId)))
const totalPages = computed(() => Math.ceil(props.total / props.pageSize))

function decisionFromEvent(event: Event): InitializationDecision | null {
  const value = (event.target as HTMLSelectElement).value
  return ['adopt', 'download', 'defer'].includes(value) ? value as InitializationDecision : null
}

function canChoose(item: InitializationReviewItem): boolean {
  return props.editable && item.kind === 'actionable' && item.allowedDecisions.length > 0
}
</script>

<template>
  <FilterBar :search="search" placeholder="搜索歌曲、候选或网易云 ID" search-label="搜索接管项" :active-count="[search, tier, decision].filter(Boolean).length" :can-clear="Boolean(search || tier || decision)" @update:search="emit('update:search', $event)" @clear="emit('clear')">
    <template #filters>
      <select :value="tier" class="form-input source-adoption__filter" aria-label="证据等级" @change="emit('update:tier', ($event.target as HTMLSelectElement).value); emit('reload')">
        <option value="">全部证据</option>
        <option v-for="option in tierOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
      </select>
      <select :value="decision" class="form-input source-adoption__filter" aria-label="处理决定" @change="emit('update:decision', ($event.target as HTMLSelectElement).value); emit('reload')">
        <option value="">全部决定</option>
        <option value="adopt">使用 Plex</option>
        <option value="download">下载并托管</option>
        <option value="defer">暂缓</option>
      </select>
    </template>
    <template #summary><span>共 {{ total }} 首 · 已跨页选择 {{ selected.size }} 首</span></template>
  </FilterBar>

  <div v-if="selected.size" class="section-card source-adoption__bulk"><strong>已选 {{ selected.size }} 首</strong><div><button class="btn btn-secondary btn-sm" :disabled="acting || !editable" @click="emit('decide', 0, 'adopt')">使用候选</button><button class="btn btn-secondary btn-sm" :disabled="acting || !editable" @click="emit('decide', 0, 'download')">下载并托管</button><button class="btn btn-ghost btn-sm" :disabled="acting || !editable" @click="emit('decide', 0, 'defer')">暂缓</button></div></div>
  <div class="section-card source-adoption__table-wrap">
    <table class="source-adoption__table">
      <thead><tr><th><input type="checkbox" :checked="allPageSelected" :disabled="!editable || !actionablePageItems.length" aria-label="选择本页" @change="emit('togglePage')" /></th><th>网易云目标</th><th>Plex 候选</th><th>证据</th><th>决定</th><th><span class="sr-only">操作</span></th></tr></thead>
      <tbody>
        <tr v-for="item in items" :key="item.neteaseSongId">
          <td><input type="checkbox" :checked="selected.has(item.neteaseSongId)" :disabled="!canChoose(item)" :aria-label="`选择 ${item.title || item.neteaseSongId}`" @change="emit('toggle', item)" /></td>
          <td data-label="网易云目标"><strong>{{ item.title || `歌曲 #${item.neteaseSongId}` }}</strong><span>{{ item.artists.join('、') || '元数据缺失' }} · {{ item.album || '未知专辑' }}</span></td>
          <td data-label="Plex 候选"><template v-if="item.candidate"><strong>{{ item.candidate.title }}</strong><span>{{ item.candidate.artist || '未知艺人' }} · {{ item.candidate.album || '未知专辑' }}</span><small :title="item.candidate.filePath || undefined">{{ item.candidate.filePath || '无可读路径' }}</small></template><span v-else>{{ item.kind === 'preserved' ? '当前绑定将在重新分析后显示' : item.candidates.length ? `${item.candidates.length} 个候选` : '没有候选' }}</span></td>
          <td data-label="证据"><span class="source-adoption__tier" :class="`source-adoption__tier--${item.tier}`">{{ tierLabel(item.tier) }}</span></td>
          <td data-label="决定"><span v-if="item.kind === 'preserved'" class="source-adoption__preserved">保留现有绑定</span><select v-else :value="item.decision" class="form-input" :disabled="acting || !canChoose(item)" :aria-label="`${item.title} 的处理决定`" :title="item.unavailableReason || undefined" @change="decisionFromEvent($event) && emit('decide', item.neteaseSongId, decisionFromEvent($event)!)"><option v-for="value in item.allowedDecisions" :key="value" :value="value">{{ value === 'adopt' ? '使用 Plex' : value === 'download' ? '下载并托管' : '暂缓' }}</option></select></td>
          <td data-label="详情"><button class="btn btn-ghost btn-sm" @click="emit('openEvidence', item)">查看证据</button></td>
        </tr>
      </tbody>
    </table>
    <div v-if="!items.length" class="p-8 text-center text-muted">没有符合条件的歌曲</div>
  </div>
  <nav v-if="total > pageSize" class="source-adoption__pagination" aria-label="接管项分页"><button class="btn btn-secondary btn-sm" :disabled="loading || page <= 1" @click="emit('changePage', page - 1)">上一页</button><span>第 {{ page }} / {{ totalPages }} 页</span><button class="btn btn-secondary btn-sm" :disabled="loading || page >= totalPages" @click="emit('changePage', page + 1)">下一页</button></nav>
</template>

<style scoped>
@import '~/assets/css/components/source-initialization-shared.css';
@import '~/assets/css/components/source-initialization-review.css';
</style>
