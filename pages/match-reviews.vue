<template>
  <main class="orphaned-media-page space-y-5">
    <PageHeader
      title="未使用的歌曲关联"
      description="这些歌曲关联已没有收藏在使用。需要更换文件时，请到对应收藏的“歌曲与媒体”。"
    >
      <template #actions>
        <NuxtLink class="btn btn-ghost btn-sm" to="/sync-sources">
          <AppIcon name="source" :size="14" />
          返回音乐库
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
