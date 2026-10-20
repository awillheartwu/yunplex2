<script setup lang="ts">
import type { PlaylistStartMode } from '../../shared/source-onboarding'
defineProps<{ playlist: boolean; busy: boolean; disabled: boolean }>()
const emit = defineEmits<{ start: [mode: PlaylistStartMode]; cancel: [] }>()
</script>

<template>
  <div class="add-playlist-actions">
    <button class="btn btn-ghost" :disabled="busy" @click="emit('cancel')">取消</button>
    <template v-if="playlist">
      <ActionHint text="采用当前排序的第一个候选，没有候选的再下载"><button class="btn btn-secondary" :disabled="busy || disabled" @click="emit('start', 'automatic')">{{ busy ? '添加中…' : '直接开始！' }}</button></ActionHint>
      <ActionHint text="仔细查阅匹配方案并微调，适合对歌单匹配要求高的人"><button class="btn btn-primary" :disabled="busy || disabled" @click="emit('start', 'review')">{{ busy ? '添加中…' : '审批初始化' }}</button></ActionHint>
    </template>
    <button v-else class="btn btn-primary" :disabled="busy || disabled" @click="emit('start', 'automatic')">{{ busy ? '添加中…' : '确认添加' }}</button>
  </div>
</template>

<style scoped>
.add-playlist-actions{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:var(--space-2);width:100%}@media(max-width:640px){.add-playlist-actions{display:grid;grid-template-columns:1fr}.add-playlist-actions .btn{width:100%;justify-content:center}}
</style>
