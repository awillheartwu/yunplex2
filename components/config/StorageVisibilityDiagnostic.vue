<template>
  <section
    class="storage-diagnostic"
    :class="`storage-diagnostic--${diagnostic.status}`"
    role="status"
    aria-live="polite"
    aria-label="音乐目录检查结果"
  >
    <header class="storage-diagnostic__header">
      <span class="storage-diagnostic__icon" aria-hidden="true">
        <AppIcon :name="diagnostic.status === 'warning' ? 'warn' : 'checkCircle'" :size="17" />
      </span>
      <div>
        <strong>{{ diagnostic.summary }}</strong>
      </div>
    </header>

    <dl class="storage-diagnostic__paths">
      <div>
        <dt>YunPlex 下载目录</dt>
        <dd><code>{{ diagnostic.downloadDir }}</code></dd>
      </div>
      <div>
        <dt>Plex 对应目录</dt>
        <dd><code>{{ diagnostic.plexPathPrefix || diagnostic.downloadDir }}</code></dd>
      </div>
    </dl>

    <div class="storage-diagnostic__library">
      <strong>Plex「{{ diagnostic.sectionName }}」的扫描目录</strong>
      <p>由 Plex 音乐库提供，用来核对上面的对应目录。</p>
      <code v-for="location in diagnostic.sectionLocations" :key="location">{{ location }}</code>
      <span v-if="!diagnostic.sectionLocations.length">未读取到</span>
    </div>

    <div class="storage-diagnostic__action" :class="{ 'storage-diagnostic__action--note': diagnostic.status !== 'warning' }">
      <strong v-if="diagnostic.status === 'warning'">如何调整</strong>
      <p>{{ diagnostic.action }}</p>
    </div>

    <div class="storage-diagnostic__sample">
      <strong>同一首歌在两端的位置（示例）</strong>
      <dl>
        <div><dt>YunPlex</dt><dd><code>{{ diagnostic.sample.localPath }}</code></dd></div>
        <div><dt>Plex</dt><dd><code>{{ diagnostic.sample.plexPath || '无法映射' }}</code></dd></div>
      </dl>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { StorageVisibilityDiagnostic } from '~~/server/lib/config/types'

defineProps<{
  diagnostic: StorageVisibilityDiagnostic
}>()
</script>

<style scoped>
.storage-diagnostic {
  display: grid;
  gap: var(--space-3_5);
  padding: var(--space-4);
  border: 1px solid var(--warning-border);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--warning-soft) 48%, var(--bg-surface));
}

.storage-diagnostic--verified,
.storage-diagnostic--configured {
  border-color: var(--success-border);
  background: color-mix(in srgb, var(--success-soft) 48%, var(--bg-surface));
}

.storage-diagnostic__header {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2_5);
}

.storage-diagnostic__icon {
  display: inline-flex;
  flex: 0 0 auto;
  margin-top: 0.05rem;
  color: var(--warning);
}

.storage-diagnostic--verified .storage-diagnostic__icon,
.storage-diagnostic--configured .storage-diagnostic__icon {
  color: var(--success);
}

.storage-diagnostic__header strong,
.storage-diagnostic__action strong,
.storage-diagnostic__library strong {
  color: var(--text-primary);
  font-size: var(--text-sm);
}

.storage-diagnostic__action p,
.storage-diagnostic__library p {
  margin: var(--space-1) 0 0;
  color: var(--text-secondary);
  font-size: var(--text-xs);
  line-height: var(--body-leading);
}

.storage-diagnostic__paths {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-2_5);
}

.storage-diagnostic__paths > div {
  min-width: 0;
  padding: var(--space-2_5);
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
}

.storage-diagnostic dt {
  margin-bottom: var(--space-1);
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-semibold);
}

.storage-diagnostic dd {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--text-xs);
}

.storage-diagnostic code {
  overflow-wrap: anywhere;
  font-family: var(--font-mono);
  color: var(--text-primary);
}

.storage-diagnostic__library { display: grid; gap: var(--space-1); min-width: 0; font-size: var(--text-xs); color: var(--text-secondary); }

.storage-diagnostic__action {
  padding: var(--space-2_5) var(--space-3);
  border-left: 3px solid var(--warning);
  background: var(--bg-surface);
}

.storage-diagnostic__action--note {
  border-left-color: var(--border-secondary);
}

.storage-diagnostic__sample {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}

.storage-diagnostic__sample > strong {
  color: var(--text-secondary);
}

.storage-diagnostic__sample dl {
  display: grid;
  gap: var(--space-1_5);
  margin-top: var(--space-2);
}

.storage-diagnostic__sample dl > div {
  display: grid;
  grid-template-columns: 5rem minmax(0, 1fr);
  gap: var(--space-2);
}

@media (max-width: 760px) {
  .storage-diagnostic__paths {
    grid-template-columns: 1fr;
  }
}
</style>
