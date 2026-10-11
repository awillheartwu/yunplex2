<script setup lang="ts">
import { scoreReason } from '../../shared/score-labels'
import type { InitializationReviewItem, PlexSearchResult } from '../../composables/useSourceInitialization'
import type { ScoredCandidate } from '../../composables/useSourceInitialization'
import { evidenceRuleLabel, scoredCandidatesOf, tierLabel } from '../../composables/useSourceInitialization'
import type { CandidateScoreParts } from '../../shared/initialization-scoring'
import { sharedMediaReview } from '../../shared/shared-media'
import { useDialogFocus } from '../../composables/useDialogFocus'

const props = defineProps<{
  item: InitializationReviewItem | null
  searchResults: PlexSearchResult[]
  acting: boolean
  error?: string
}>()
const shared = computed(() => props.item ? sharedMediaReview(props.item.evidence) : null)
const scores = computed(() => props.item ? scoredCandidatesOf(props.item) : [])
const confirmSharing = ref(false)
watch(() => props.item?.neteaseSongId, () => { confirmSharing.value = false })
const panel = ref<HTMLElement | null>(null)

const emit = defineEmits<{
  adopt: [item: InitializationReviewItem]
  confirmShared: [item: InitializationReviewItem]
  close: []
  search: [item: InitializationReviewItem]
  choose: [item: InitializationReviewItem, candidate: { ratingKey: string }]
}>()
useDialogFocus(() => !!props.item, panel, () => emit('close'))

function candidateName(entry: ScoredCandidate): string {
  return entry.candidate.title || entry.candidate.artist || '未命名候选'
}

function formatPart(value: unknown): string {
  return typeof value === 'number' ? value.toFixed(1) : '—'
}

function scoreParts(entry: ScoredCandidate): Array<{ label: string; value: string }> {
  const parts = (entry.score.parts ?? {}) as Partial<CandidateScoreParts>
  return [
    { label: '标题', value: formatPart(parts.title) },
    { label: '艺人', value: formatPart(parts.artists) },
    { label: '时长', value: formatPart(parts.duration) },
    { label: '专辑', value: formatPart(parts.album) },
    { label: '曲号', value: formatPart(parts.track) },
  ]
}

function scoreMeta(entry: ScoredCandidate): string {
  const score = entry.score
  const detail = [score.eligible ? '参与分数线' : '不参与分数线']
  if (typeof score.titleStrength === 'number') detail.push(`标题强度 ${score.titleStrength.toFixed(2)}`)
  if (typeof score.completeArtists === 'boolean') detail.push(`完整艺人 ${score.completeArtists ? '是' : '否'}`)
  detail.push(typeof score.coverage === 'number' ? `覆盖 ${Math.round(score.coverage * 100)}%` : '覆盖未知')
  detail.push(typeof score.durationDeltaMs === 'number' ? `时长差 ${(score.durationDeltaMs / 1000).toFixed(1)} 秒` : '时长差未知')
  return detail.join(' · ')
}
</script>

<template>
  <Teleport to="body"><template v-if="item">
    <div class="source-adoption__drawer-backdrop" aria-hidden="true" @click="emit('close')" />
    <aside ref="panel" tabindex="-1" class="source-adoption__drawer" role="dialog" aria-modal="true" :aria-label="`${item.title} 证据详情`">
      <button class="icon-button source-adoption__drawer-close" aria-label="关闭详情" @click="emit('close')"><AppIcon name="close" :size="16" /></button>
      <span class="source-adoption__eyebrow">网易云 #{{ item.neteaseSongId }}</span><h3>{{ item.title }}</h3>
      <section><h4>网易云目标</h4><dl><div><dt>艺人</dt><dd>{{ item.artists.join('、') || '未知' }}</dd></div><div><dt>专辑</dt><dd>{{ item.album || '未知' }}</dd></div></dl></section>
      <section><h4>{{ item.kind === 'preserved' ? '当前 Plex 绑定' : 'Plex 候选' }}</h4><dl v-if="item.candidate"><div><dt>标题</dt><dd>{{ item.candidate.title }}</dd></div><div><dt>艺人</dt><dd>{{ item.candidate.artist || '未知' }}</dd></div><div><dt>专辑</dt><dd>{{ item.candidate.album || '未知' }}</dd></div><div class="source-adoption__drawer-path"><dt>路径</dt><dd>{{ item.candidate.filePath || '无可读路径' }}</dd></div></dl><p v-else class="source-adoption__drawer-empty">{{ item.kind === 'preserved' ? '这是一份旧审核快照；重新分析后会显示当前绑定详情。' : `尚未选择 Plex 候选；当前共发现 ${item.candidates.length} 个可能项。` }}</p></section>
      <section><h4>匹配证据</h4><div class="source-adoption__evidence-summary"><span class="source-adoption__tier" :class="`source-adoption__tier--${item.tier}`">{{ shared ? (item.evidence.sharedMediaConfirmed ? '共享媒体已确认' : '共享媒体待确认') : tierLabel(item.tier) }}</span><p>{{ evidenceRuleLabel(item) }}</p></div><details><summary>查看原始证据</summary><pre>{{ JSON.stringify(item.evidence, null, 2) }}</pre></details></section>
      <section v-if="scores.length" class="source-adoption__scored"><h4>候选评分</h4><p class="source-adoption__drawer-empty">评分只用于排序和分数线参考（满分 100），不构成媒体身份绑定依据。</p><details><summary>查看 {{ scores.length }} 个候选的评分明细</summary><ol><li v-for="(entry, index) in scores" :key="`${entry.candidate.ratingKey}-${index}`"><div class="source-adoption__scored-head"><strong>{{ candidateName(entry) }}</strong><span class="source-adoption__score">{{ entry.score.total.toFixed(1) }} 分</span></div><p class="source-adoption__scored-meta">{{ entry.candidate.artist || '未知艺人' }} · {{ entry.candidate.album || '未知专辑' }} · {{ scoreMeta(entry) }}</p><dl class="source-adoption__scored-parts"><div v-for="part in scoreParts(entry)" :key="part.label"><dt>{{ part.label }}</dt><dd>{{ part.value }}</dd></div></dl><p v-if="entry.score.risks?.length" class="source-adoption__scored-risks">风险：{{ entry.score.risks.map(scoreReason).join('；') }}</p><p v-if="entry.score.blocked?.length" class="source-adoption__scored-risks">阻止原因：{{ entry.score.blocked.map(scoreReason).join('；') }}</p></li></ol></details></section>
      <p v-if="error" role="alert" class="shared-media-review__error">{{ error }}</p>
      <section v-if="shared" class="shared-media-review">
        <h4>以下歌曲将共用同一媒体</h4><p class="source-adoption__drawer-empty">只共享文件与 Plex 媒体，保留各自歌曲 ID 和歌单条目。请核对是否为同一录音；不同演唱者、现场版或剪辑版不要共用。</p>
        <p class="shared-media-review__path">{{ shared.filePath }}</p>
        <ul><li v-for="song in shared.songs" :key="song.songId"><strong>{{ song.title }} · #{{ song.songId }}</strong><span>{{ song.artists.join('、') }} · {{ song.album }}</span><small v-if="song.albumId">专辑 #{{ song.albumId }}<template v-if="song.publishTime"> · {{ new Date(song.publishTime).toLocaleDateString() }}</template></small><small>{{ song.durationMs == null ? '时长未知' : `${(song.durationMs / 1000).toFixed(3)} 秒` }}</small></li></ul>
        <button v-if="item.kind === 'actionable' && item.canSearch" class="btn btn-secondary" :disabled="acting" @click="confirmSharing = true">确认这 {{ shared.songs.length }} 首共用媒体</button>
        <p v-if="item.evidence.sharedMediaConfirmed" role="status">已记录共享确认，提交接管方案后生效。</p>
      </section>
      <ConfirmDialog :visible="confirmSharing" title="确认共享同一录音" :message="`将所列 ${shared?.songs.length || 0} 首歌曲共同设为使用此 Plex 媒体。不会合并网易云 ID 或歌单条目；仅更新草案，提交后生效。`" confirm-label="确认共用并更新草案" :busy="acting" @confirm="confirmSharing = false; emit('confirmShared', item)" @cancel="confirmSharing = false" />
      <div v-if="!shared && item.kind === 'actionable' && item.candidate && item.allowedDecisions.includes('adopt')" class="source-adoption__direct-confirm">
        <button class="btn btn-primary w-full" :disabled="acting || item.decision === 'adopt'" @click="emit('adopt', item)">{{ item.decision === 'adopt' ? '已选择使用当前候选' : '使用当前候选' }}</button>
        <p class="source-adoption__drawer-empty">仅更新草案，提交接管方案后生效。</p>
      </div>
      <button v-if="item.kind === 'actionable' && item.canSearch" class="btn btn-secondary w-full" :disabled="acting" @click="emit('search', item)">搜索其他 Plex 媒体</button>
      <p v-else-if="item.kind === 'actionable' && item.unavailableReason" class="source-adoption__drawer-empty">{{ item.unavailableReason }}</p>
      <div v-if="searchResults.length" class="source-adoption__search-results"><button v-for="candidate in searchResults" :key="candidate.ratingKey" :disabled="acting" @click="emit('choose', item, candidate)"><strong>{{ candidate.title }}</strong><span>{{ candidate.artist }} · {{ candidate.album }}</span></button></div>
    </aside>
  </template></Teleport>
</template>

<style scoped>
@import '~/assets/css/components/source-initialization-shared.css';
@import '~/assets/css/components/source-initialization-evidence.css';
.source-adoption__direct-confirm { display: grid; gap: var(--space-2); margin: var(--space-3) 0; }
.shared-media-review__error { color: var(--danger); font-size: var(--text-sm); }
.shared-media-review__path { overflow-wrap: anywhere; font-size: var(--text-xs); color: var(--text-secondary); }
.shared-media-review ul { list-style: none; padding: 0; }
.shared-media-review li { padding: var(--space-3) 0; border-bottom: 1px solid var(--border-primary); }
.shared-media-review li span, .shared-media-review li small { display: block; color: var(--text-secondary); font-size: var(--text-xs); }
.source-adoption__scored details { margin-top: var(--space-2); }
.source-adoption__scored summary { width: fit-content; cursor: pointer; color: var(--text-secondary); font-size: var(--text-xs); }
.source-adoption__scored ol { display: grid; gap: var(--space-3); margin: var(--space-2) 0 0; padding: 0; list-style: none; }
.source-adoption__scored li { min-width: 0; padding-top: var(--space-3); border-top: 1px solid var(--border-primary); }
.source-adoption__scored-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-2); min-width: 0; }
.source-adoption__scored-head strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-sm); }
.source-adoption__score { display: inline-flex; width: max-content; flex: 0 0 auto; padding: var(--space-0_5) var(--space-2); border-radius: var(--radius-full); background: var(--accent-muted); color: var(--accent); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
.source-adoption__scored-meta { margin-top: var(--space-1); color: var(--text-tertiary); font-size: var(--text-xs); overflow-wrap: anywhere; }
.source-adoption__drawer .source-adoption__scored-parts { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-3); margin-top: var(--space-2); }
.source-adoption__drawer .source-adoption__scored-parts div { display: flex; align-items: baseline; gap: var(--space-1); padding: 0; border: 0; font-size: var(--text-xs); }
.source-adoption__scored-parts dt { color: var(--text-muted); }
.source-adoption__scored-parts dd { color: var(--text-secondary); font-variant-numeric: tabular-nums; }
.source-adoption__scored-risks { margin-top: var(--space-1); color: var(--warning); font-size: var(--text-xs); overflow-wrap: anywhere; }
</style>
