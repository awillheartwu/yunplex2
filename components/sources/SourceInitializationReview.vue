<script setup lang="ts">
import { evidenceGroups } from '../../shared/review-filter-groups'
import type { InitializationDecision, InitializationReviewItem } from '../../composables/useSourceInitialization'
import { scoredCandidatesOf } from '../../composables/useSourceInitialization'

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

const selectedGroup = computed(() => evidenceGroups.find(group => group.value === props.tier || group.members.includes(props.tier)))
const detailOptions = computed(() => props.tierOptions.filter(option => !selectedGroup.value || selectedGroup.value.members.includes(option.value)))
const tierSelectOptions = computed(() => [
  { value: selectedGroup.value?.value || '', label: '具体证据（可选）' },
  ...detailOptions.value.map(option => ({ value: option.value, label: option.label })),
])
const decisionSelectOptions = [
  { value: '', label: '全部决定' },
  { value: 'adopt', label: '使用 Plex' },
  { value: 'download', label: '下载并托管' },
  { value: 'defer', label: '暂缓' },
]
const scoredCandidates = computed(() => new Map(props.items.map(item => [item.neteaseSongId, scoredCandidatesOf(item)])))

function selectTier(value: string) {
  emit('update:tier', value)
  emit('reload')
}

function selectDecision(value: string) {
  emit('update:decision', value)
  emit('reload')
}

function topScore(item: InitializationReviewItem): number | null {
  const entry = scoredCandidates.value.get(item.neteaseSongId)?.[0]
  return entry ? entry.score.total : null
}

function scoreTitle(item: InitializationReviewItem): string {
  const entry = scoredCandidates.value.get(item.neteaseSongId)?.[0]
  if (!entry) return ''
  return `候选评分 ${entry.score.total.toFixed(1)}（满分 100）${entry.score.eligible ? '' : ' · 不参与分数线'}`
}

const actionablePageItems = computed(() => props.items.filter(item => props.editable && item.kind === 'actionable' && item.allowedDecisions.length > 0))
const allPageSelected = computed(() => actionablePageItems.value.length > 0 && actionablePageItems.value.every(item => props.selected.has(item.neteaseSongId)))
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
    <template #primary><slot name="actions" /></template>
    <template #filters>
      <ListSelect
        class="source-adoption__filter"
        aria-label="证据等级"
        :model-value="tier"
        :options="tierSelectOptions"
        @change="selectTier"
      />
      <ListSelect
        class="source-adoption__filter"
        aria-label="处理决定"
        :model-value="decision"
        :options="decisionSelectOptions"
        @change="selectDecision"
      />
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
          <td data-label="证据"><span class="source-adoption__tier" :class="`source-adoption__tier--${item.tier}`">{{ item.evidence.sharedMedia ? (item.evidence.sharedMediaConfirmed ? '共享媒体已确认' : '共享媒体待确认') : tierLabel(item.tier) }}</span><small v-if="topScore(item) !== null" class="source-adoption__score" :title="scoreTitle(item)">评分 {{ topScore(item)!.toFixed(1) }}</small></td>
          <td data-label="决定"><span v-if="item.kind === 'preserved'" class="source-adoption__preserved">保留现有绑定</span><select v-else :value="item.decision" class="form-input" :disabled="acting || !canChoose(item)" :aria-label="`${item.title} 的处理决定`" :title="item.unavailableReason || undefined" @change="decisionFromEvent($event) && emit('decide', item.neteaseSongId, decisionFromEvent($event)!)"><option v-for="value in item.allowedDecisions" :key="value" :value="value">{{ value === 'adopt' ? '使用 Plex' : value === 'download' ? '下载并托管' : '暂缓' }}</option></select></td>
          <td data-label="详情"><button class="btn btn-ghost btn-sm" @click="emit('openEvidence', item)">查看证据</button></td>
        </tr>
      </tbody>
    </table>
    <div v-if="!items.length" class="p-8 text-center text-muted">没有符合条件的歌曲</div>
  </div>
  <PageNavigator :page="page" :page-size="pageSize" :total="total" label="接管项" :loading="loading" @change="emit('changePage', $event)" />
</template>

<style scoped>
@import '~/assets/css/components/source-initialization-shared.css';
@import '~/assets/css/components/source-initialization-review.css';
.source-adoption__table td .source-adoption__score { display: inline-flex; width: max-content; margin-top: var(--space-1); padding: var(--space-0_5) var(--space-2); border-radius: var(--radius-full); background: var(--accent-muted); color: var(--accent); white-space: nowrap; overflow: visible; font-variant-numeric: tabular-nums; }
</style>
