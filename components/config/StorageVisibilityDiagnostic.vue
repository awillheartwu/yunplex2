<template>
  <section
    class="storage-diagnostic"
    :class="`storage-diagnostic--${diagnostic.status}`"
    role="status"
    aria-live="polite"
    aria-label="Plex 文件发布链路检查结果"
  >
    <header class="storage-diagnostic__header">
      <span class="storage-diagnostic__icon" aria-hidden="true">
        <AppIcon :name="diagnostic.status === 'verified' ? 'checkCircle' : 'warn'" :size="17" />
      </span>
      <div>
        <strong>{{ diagnostic.status === 'verified' ? '文件发布链路已验证' : '文件发布链路待确认' }}</strong>
        <p>{{ diagnostic.summary }}</p>
      </div>
    </header>

    <dl class="storage-diagnostic__paths">
      <div>
        <dt>应用下载目录</dt>
        <dd><code>{{ diagnostic.downloadDir }}</code></dd>
      </div>
      <div>
        <dt>Plex 路径前缀</dt>
        <dd><code>{{ diagnostic.plexPathPrefix || '未配置' }}</code></dd>
      </div>
      <div>
        <dt>Plex「{{ diagnostic.sectionName }}」Location</dt>
        <dd v-if="diagnostic.sectionLocations.length">
          <code v-for="location in diagnostic.sectionLocations" :key="location">{{ location }}</code>
        </dd>
        <dd v-else><span>未读取到</span></dd>
      </div>
    </dl>

    <ul class="storage-diagnostic__checks" aria-label="检查项目">
      <li v-for="check in diagnostic.checks" :key="check.key" :class="`storage-diagnostic__check--${check.status}`">
        <AppIcon :name="check.status === 'pass' ? 'checkCircle' : 'warn'" :size="14" />
        <span>
          <strong>{{ check.label }}</strong>
          <small>{{ check.detail }}</small>
        </span>
      </li>
    </ul>

    <div class="storage-diagnostic__action">
      <strong>建议操作</strong>
      <p>{{ diagnostic.action }}</p>
    </div>

    <details class="storage-diagnostic__sample">
      <summary>查看路径换算样例</summary>
      <dl>
        <div><dt>本地</dt><dd><code>{{ diagnostic.sample.localPath }}</code></dd></div>
        <div><dt>Plex</dt><dd><code>{{ diagnostic.sample.plexPath || '无法映射' }}</code></dd></div>
        <div><dt>反向映射</dt><dd><code>{{ diagnostic.sample.roundTripLocalPath || '无法映射' }}</code></dd></div>
      </dl>
    </details>
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
  gap: 0.9rem;
  padding: 1rem;
  border: 1px solid var(--warning-border);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--warning-soft) 48%, var(--bg-surface));
}

.storage-diagnostic--verified {
  border-color: var(--success-border);
  background: color-mix(in srgb, var(--success-soft) 48%, var(--bg-surface));
}

.storage-diagnostic__header {
  display: flex;
  align-items: flex-start;
  gap: 0.65rem;
}

.storage-diagnostic__icon {
  display: inline-flex;
  flex: 0 0 auto;
  margin-top: 0.05rem;
  color: var(--warning);
}

.storage-diagnostic--verified .storage-diagnostic__icon {
  color: var(--success);
}

.storage-diagnostic__header strong,
.storage-diagnostic__action strong {
  color: var(--text-primary);
  font-size: 0.8rem;
}

.storage-diagnostic__header p,
.storage-diagnostic__action p {
  margin: 0.2rem 0 0;
  color: var(--text-secondary);
  font-size: 0.75rem;
  line-height: 1.55;
}

.storage-diagnostic__paths {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.65rem;
}

.storage-diagnostic__paths > div {
  min-width: 0;
  padding: 0.65rem;
  border: 1px solid var(--border-primary);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
}

.storage-diagnostic dt {
  margin-bottom: 0.25rem;
  color: var(--text-muted-deep);
  font-size: 0.66rem;
  font-weight: 650;
}

.storage-diagnostic dd {
  display: grid;
  gap: 0.2rem;
  min-width: 0;
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.72rem;
}

.storage-diagnostic code {
  overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  color: var(--text-primary);
}

.storage-diagnostic__checks {
  display: grid;
  gap: 0.45rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.storage-diagnostic__checks li {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  color: var(--text-secondary);
}

.storage-diagnostic__checks li > .app-icon {
  flex: 0 0 auto;
  margin-top: 0.08rem;
  color: var(--warning);
}

.storage-diagnostic__checks .storage-diagnostic__check--pass > .app-icon {
  color: var(--success);
}

.storage-diagnostic__checks span {
  display: grid;
  gap: 0.12rem;
  min-width: 0;
}

.storage-diagnostic__checks strong {
  color: var(--text-primary);
  font-size: 0.72rem;
}

.storage-diagnostic__checks small {
  overflow-wrap: anywhere;
  color: var(--text-muted-deep);
  font-size: 0.68rem;
  line-height: 1.45;
}

.storage-diagnostic__action {
  padding: 0.65rem 0.75rem;
  border-left: 3px solid var(--warning);
  background: var(--bg-surface);
}

.storage-diagnostic--verified .storage-diagnostic__action {
  border-left-color: var(--success);
}

.storage-diagnostic__sample {
  color: var(--text-muted-deep);
  font-size: 0.7rem;
}

.storage-diagnostic__sample summary {
  width: max-content;
  cursor: pointer;
  color: var(--text-secondary);
}

.storage-diagnostic__sample dl {
  display: grid;
  gap: 0.35rem;
  margin-top: 0.55rem;
}

.storage-diagnostic__sample dl > div {
  display: grid;
  grid-template-columns: 5rem minmax(0, 1fr);
  gap: 0.5rem;
}

@media (max-width: 760px) {
  .storage-diagnostic__paths {
    grid-template-columns: 1fr;
  }
}
</style>
