<script setup lang="ts">
import type { InitializationReviewItem, PlexSearchResult } from '../../composables/useSourceInitialization'
import { evidenceRuleLabel, tierLabel } from '../../composables/useSourceInitialization'
import { useDialogFocus } from '../../composables/useDialogFocus'

const props = defineProps<{
  item: InitializationReviewItem | null
  searchResults: PlexSearchResult[]
  acting: boolean
}>()
const panel = ref<HTMLElement | null>(null)

const emit = defineEmits<{
  close: []
  search: [item: InitializationReviewItem]
  choose: [item: InitializationReviewItem, candidate: { ratingKey: string }]
}>()
useDialogFocus(() => !!props.item, panel, () => emit('close'))
</script>

<template>
  <Teleport to="body"><template v-if="item">
    <div class="source-adoption__drawer-backdrop" aria-hidden="true" @click="emit('close')" />
    <aside ref="panel" tabindex="-1" class="source-adoption__drawer" role="dialog" aria-modal="true" :aria-label="`${item.title} 证据详情`">
      <button class="icon-button source-adoption__drawer-close" aria-label="关闭详情" @click="emit('close')"><AppIcon name="close" :size="16" /></button>
      <span class="source-adoption__eyebrow">网易云 #{{ item.neteaseSongId }}</span><h3>{{ item.title }}</h3>
      <section><h4>网易云目标</h4><dl><div><dt>艺人</dt><dd>{{ item.artists.join('、') || '未知' }}</dd></div><div><dt>专辑</dt><dd>{{ item.album || '未知' }}</dd></div></dl></section>
      <section><h4>{{ item.kind === 'preserved' ? '当前 Plex 绑定' : 'Plex 候选' }}</h4><dl v-if="item.candidate"><div><dt>标题</dt><dd>{{ item.candidate.title }}</dd></div><div><dt>艺人</dt><dd>{{ item.candidate.artist || '未知' }}</dd></div><div><dt>专辑</dt><dd>{{ item.candidate.album || '未知' }}</dd></div><div class="source-adoption__drawer-path"><dt>路径</dt><dd>{{ item.candidate.filePath || '无可读路径' }}</dd></div></dl><p v-else class="source-adoption__drawer-empty">{{ item.kind === 'preserved' ? '这是一份旧审核快照；重新分析后会显示当前绑定详情。' : `尚未选择 Plex 候选；当前共发现 ${item.candidates.length} 个可能项。` }}</p></section>
      <section><h4>匹配证据</h4><div class="source-adoption__evidence-summary"><span class="source-adoption__tier" :class="`source-adoption__tier--${item.tier}`">{{ tierLabel(item.tier) }}</span><p>{{ evidenceRuleLabel(item) }}</p></div><details><summary>查看原始证据</summary><pre>{{ JSON.stringify(item.evidence, null, 2) }}</pre></details></section>
      <button v-if="item.kind === 'actionable' && item.canSearch" class="btn btn-secondary w-full" :disabled="acting" @click="emit('search', item)">搜索其他 Plex 媒体</button>
      <p v-else-if="item.kind === 'actionable' && item.unavailableReason" class="source-adoption__drawer-empty">{{ item.unavailableReason }}</p>
      <div v-if="searchResults.length" class="source-adoption__search-results"><button v-for="candidate in searchResults" :key="candidate.ratingKey" :disabled="acting" @click="emit('choose', item, candidate)"><strong>{{ candidate.title }}</strong><span>{{ candidate.artist }} · {{ candidate.album }}</span></button></div>
    </aside>
  </template></Teleport>
</template>

<style scoped>
@import '~/assets/css/components/source-initialization-shared.css';
@import '~/assets/css/components/source-initialization-evidence.css';
</style>
