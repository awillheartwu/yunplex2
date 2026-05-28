<template>
  <div v-if="hasMore" class="flex justify-center pt-2">
    <button
      class="btn btn-ghost btn-sm"
      :disabled="loading"
      @click="$emit('load-more')"
    >
      {{ loading ? '加载中...' : `加载更多 (${currentCount} / ${total})` }}
    </button>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  hasMore: boolean
  loading: boolean
  currentCount: number
  total: number
}>()

defineEmits<{
  'load-more': []
}>()
</script>
