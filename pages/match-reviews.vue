<template>
  <main class="media-links-page space-y-5">
    <PageHeader
      title="媒体复用"
      description="系统只自动复用 YunPlex 托管文件；外部 Plex 媒体需要你明确接管一次。无法确认时会自动下载独立副本。"
    >
      <template #actions>
        <button class="btn btn-secondary btn-sm" :disabled="refreshing" @click="refresh">
          <AppIcon :name="refreshing ? 'loader' : 'refresh'" :size="14" :class="{ 'animate-spin': refreshing }" />
          {{ refreshing ? '刷新中' : '刷新' }}
        </button>
      </template>
    </PageHeader>

    <section class="reuse-rules" aria-label="自动复用规则">
      <article>
        <AppIcon name="checkCircle" :size="16" />
        <div><strong>托管文件自动复用</strong><span>只认 Plex 返回的精确文件路径，不受刮削器元数据影响。</span></div>
      </article>
      <article>
        <AppIcon name="link" :size="16" />
        <div><strong>外部媒体明确接管</strong><span>搜索 Plex 后选择一次，后续按 ratingKey 与路径自动验证。</span></div>
      </article>
      <article>
        <AppIcon name="download" :size="16" />
        <div><strong>无法确认就下载</strong><span>不再用标题、艺人或 MusicBrainz 猜测身份。</span></div>
      </article>
    </section>

    <OverviewTab
      :key="refreshKey"
      :initial-source-id="sourceId"
      @source-change="setSource"
    />
  </main>
</template>

<script setup lang="ts">
const route = useRoute()
const router = useRouter()
const sourceId = ref(typeof route.query.source === 'string' ? route.query.source : '')
const refreshKey = ref(0)
const refreshing = ref(false)

function setSource(value: string) {
  sourceId.value = value
  void router.replace({ query: { ...route.query, source: value || undefined } })
}

async function refresh() {
  refreshing.value = true
  refreshKey.value++
  await nextTick()
  refreshing.value = false
}
</script>

<style scoped>
.media-links-page { width: 100%; min-width: 0; max-width: 1440px; margin: 0 auto; }
.reuse-rules { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .75rem; }
.reuse-rules article {
  display: flex;
  gap: .7rem;
  padding: .9rem 1rem;
  border: 1px solid var(--border-primary);
  border-radius: .75rem;
  background: var(--bg-surface);
  color: var(--accent);
}
.reuse-rules div { display: grid; gap: .2rem; }
.reuse-rules strong { color: var(--text-primary); font-size: .82rem; }
.reuse-rules span { color: var(--text-muted); font-size: .72rem; line-height: 1.45; }
@media (max-width: 900px) { .reuse-rules { grid-template-columns: 1fr; } }
</style>
