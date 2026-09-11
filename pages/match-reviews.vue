<template>
  <main class="orphaned-media-page space-y-5">
    <PageHeader
      title="高级媒体关联"
      description="仅处理未被任何当前同步源引用的全局媒体关联。日常接管与解绑请在同步源的“媒体与歌曲”中完成。"
    >
      <template #actions>
        <NuxtLink class="btn btn-primary btn-sm" to="/sync-sources">
          <AppIcon name="source" :size="14" />
          返回同步源
        </NuxtLink>
      </template>
    </PageHeader>

    <section class="section-card orphaned-media-page__content">
      <SourceMediaDetails source-id="orphaned" />
    </section>
  </main>
</template>

<script setup lang="ts">
import SourceMediaDetails from '~/components/sources/SourceMediaDetails.vue'
</script>

<style scoped>
.orphaned-media-page { width: 100%; min-width: 0; max-width: 1100px; margin: 0 auto; }
.orphaned-media-page__content { padding: var(--space-4); }
</style>
