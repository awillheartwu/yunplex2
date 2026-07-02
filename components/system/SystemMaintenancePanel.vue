<template>
  <section class="section-card p-5">
    <div class="mb-5">
      <h3 class="text-sm font-semibold">运行记录维护</h3>
      <p class="mt-1 text-2xs text-muted">
        主动清理任务中心里的历史运行详情，以及关联的已完成/失败下载明细。不会删除配置、歌单源、同步日志、异常记录或本地媒体文件；异常记录会保留，但被清理运行的详情将无法继续查看。
      </p>
    </div>

    <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
      <label class="space-y-1.5 text-xs text-muted">
        <span>日期范围</span>
        <DateRange
          :model-value="cleanupDateFilter"
          :min-date="null"
          @update:model-value="setCleanupDate"
        />
      </label>
      <label class="space-y-1.5 text-xs text-muted">
        <span>运行类型</span>
        <select :value="cleanupType" class="form-input" @change="$emit('update:cleanupType', ($event.target as HTMLSelectElement).value)">
          <option value="">全部类型</option>
          <option value="sync">同步</option>
          <option value="repair">补全</option>
          <option value="manual_download">手动下载</option>
        </select>
      </label>
      <label class="space-y-1.5 text-xs text-muted">
        <span>运行状态</span>
        <select :value="cleanupStatus" class="form-input" @change="$emit('update:cleanupStatus', ($event.target as HTMLSelectElement).value)">
          <option value="">全部状态</option>
          <option value="success">成功</option>
          <option value="partial">部分成功</option>
          <option value="failed">失败</option>
          <option value="cancelled">已取消</option>
        </select>
      </label>
    </div>

    <div class="system-maintenance-preview" :class="{ 'system-maintenance-preview--error': cleanupPreviewError }">
      <AppIcon :name="cleanupPreviewLoading ? 'loader' : cleanupPreviewError ? 'warn' : 'info'" :size="15" :class="{ 'animate-spin': cleanupPreviewLoading }" />
      <span>{{ cleanupPreviewError || cleanupPreviewMessage }}</span>
    </div>

    <div class="mt-5 flex flex-wrap items-center gap-3">
      <button class="btn btn-danger" type="button" :disabled="!canCleanup" @click="$emit('update:showRunCleanupConfirm', true)">
        <AppIcon :name="cleanupLoading ? 'loader' : 'trash'" :size="14" :class="{ 'animate-spin': cleanupLoading }" />
        清理运行记录
      </button>
      <button class="btn btn-secondary btn-xs" type="button" :disabled="(!cleanupFrom && !cleanupTo) || cleanupPreviewLoading" @click="$emit('preview')">
        <AppIcon :name="cleanupPreviewLoading ? 'loader' : 'refresh'" :size="14" :class="{ 'animate-spin': cleanupPreviewLoading }" />
        重新预估
      </button>
      <span v-if="cleanupMessage" class="text-xs text-muted">{{ cleanupMessage }}</span>
    </div>
  </section>

  <ConfirmDialog
    :visible="showRunCleanupConfirm"
    title="清理运行记录"
    :message="cleanupConfirmMessage"
    confirm-label="确认清理"
    variant="danger"
    @confirm="$emit('confirm-cleanup')"
    @cancel="$emit('update:showRunCleanupConfirm', false)"
  />
</template>

<script setup lang="ts">
const props = defineProps<{
  canCleanup: boolean
  cleanupFrom: string
  cleanupConfirmMessage: string
  cleanupLoading: boolean
  cleanupMessage: string
  cleanupPreviewError: string
  cleanupPreviewLoading: boolean
  cleanupPreviewMessage: string
  cleanupStatus: string
  cleanupTo: string
  cleanupType: string
  showRunCleanupConfirm: boolean
}>()

const emit = defineEmits<{
  'confirm-cleanup': []
  preview: []
  'update:cleanupFrom': [value: string]
  'update:cleanupStatus': [value: string]
  'update:cleanupTo': [value: string]
  'update:cleanupType': [value: string]
  'update:showRunCleanupConfirm': [value: boolean]
}>()

const cleanupDateFilter = computed(() => ({ from: props.cleanupFrom || null, to: props.cleanupTo || null }))

function setCleanupDate(value: { from: string | null; to: string | null }) {
  emit('update:cleanupFrom', value.from || '')
  emit('update:cleanupTo', value.to || '')
}
</script>

<style scoped>
.system-maintenance-preview {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  margin-top: 1rem;
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  padding: 0.75rem;
  color: var(--text-secondary);
  background: var(--bg-muted);
  font-size: 0.78rem;
}

.system-maintenance-preview--error {
  border-color: color-mix(in srgb, var(--danger) 34%, var(--border-primary));
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 9%, var(--bg-muted));
}
</style>
