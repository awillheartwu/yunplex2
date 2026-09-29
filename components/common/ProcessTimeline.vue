<template>
  <ol class="process-timeline" :class="{ 'process-timeline--compact': compact, 'process-timeline--wide-time': wideTime }" :aria-label="ariaLabel">
    <li
      v-for="(item, index) in items"
      :id="item.id"
      :key="item.id"
      class="process-timeline__item"
      :class="{ 'is-last': index === items.length - 1, 'is-highlighted': item.highlighted }"
    >
      <time class="process-timeline__time" :datetime="item.occurredAt || undefined">
        {{ item.timeLabel || formatTimelineTime(item.occurredAt) }}
      </time>

      <div class="process-timeline__rail" aria-hidden="true">
        <span class="process-timeline__dot" :class="semanticToneClass(item.tone)">
          <AppIcon
            :name="item.icon"
            :size="14"
            :class="{ 'animate-spin': item.tone === 'running' && item.icon === 'loader' }"
          />
        </span>
      </div>

      <article class="process-timeline__content">
        <div class="process-timeline__heading">
          <div>
            <div class="process-timeline__title-row">
              <h4>{{ item.title }}</h4>
              <span v-if="item.subjectLabel" class="process-timeline__subject" :title="item.subjectLabel">
                <AppIcon :name="item.subjectIcon || 'source'" :size="12" />
                {{ item.subjectLabel }}
              </span>
            </div>
            <p>{{ item.description }}</p>
          </div>
          <div class="process-timeline__meta">
            <span v-if="item.durationMs" class="process-timeline__duration">{{ formatDuration(item.durationMs) }}</span>
            <NuxtLink
              v-if="item.action"
              class="process-timeline__action"
              :to="item.action.to"
              :aria-label="item.action.ariaLabel || item.action.label"
            >
              <AppIcon v-if="item.action.icon" :name="item.action.icon" :size="13" />
              {{ item.action.label }}
            </NuxtLink>
            <span v-if="item.statusLabel" class="process-timeline__status" :class="semanticToneClass(item.tone)">
              {{ item.statusLabel }}
            </span>
          </div>
        </div>

        <button
          v-if="item.details.length > 0"
          type="button"
          class="btn btn-secondary process-timeline__toggle"
          :aria-expanded="expanded.has(item.id)"
          @click="toggle(item.id)"
        >
          <AppIcon
            name="chevronRight"
            :size="13"
            class="process-timeline__toggle-icon"
            :class="{ 'is-expanded': expanded.has(item.id) }"
          />
          {{ expanded.has(item.id) ? '收起明细' : `展开查看 ${item.details.length} 项` }}
        </button>

        <div v-if="expanded.has(item.id)" class="process-timeline__details">
          <div
            v-for="detail in item.details"
            :key="detail.id"
            class="process-timeline__detail"
            :class="semanticToneClass(detail.tone || 'neutral')"
          >
            <span class="process-timeline__detail-dot" :class="semanticToneClass(detail.tone || 'neutral')" />
            <div>
              <div class="process-timeline__detail-title">
                <strong>{{ detail.title }}</strong>
                <span v-if="detail.subjectLabel" class="process-timeline__detail-subject" :title="detail.subjectLabel">
                  {{ detail.subjectLabel }}
                </span>
              </div>
              <p v-if="detail.description">{{ detail.description }}</p>
            </div>
          </div>
        </div>
      </article>
    </li>
  </ol>
</template>

<script setup lang="ts">
import type { ProcessTimelineItem } from '~~/lib/process-timeline'
import { semanticToneClass } from '~~/lib/task-status'

withDefaults(defineProps<{
  items: ProcessTimelineItem[]
  ariaLabel?: string
  compact?: boolean
  wideTime?: boolean
}>(), {
  ariaLabel: '过程时间线',
  compact: false,
  wideTime: false,
})

const expanded = reactive(new Set<string>())

function toggle(id: string) {
  if (expanded.has(id)) expanded.delete(id)
  else expanded.add(id)
}

function formatTimelineTime(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
</script>

<style scoped>
.process-timeline{display:flex;flex-direction:column;margin:0;padding:0;list-style:none}
.process-timeline__item{display:grid;grid-template-columns:4.75rem 2rem minmax(0,1fr);column-gap:var(--space-3);position:relative;padding-bottom:var(--space-5);border-radius:var(--radius-md);transition:background var(--duration-fast) ease,box-shadow var(--duration-fast) ease}
.process-timeline__item.is-highlighted{background:color-mix(in srgb,var(--accent-muted) 52%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 22%,transparent)}
.process-timeline__time{padding-top:var(--space-1_5);color:var(--text-tertiary);font-family:var(--font-mono);font-size:var(--text-xs);font-variant-numeric:tabular-nums;white-space:nowrap}
.process-timeline__rail{display:flex;justify-content:center;position:relative}
.process-timeline__rail::after{content:"";position:absolute;top:2rem;bottom:-1.15rem;width:2px;border-radius:var(--radius-full);background:var(--border-primary)}
.process-timeline__item.is-last .process-timeline__rail::after{display:none}
.process-timeline__dot{display:flex;width:2rem;height:2rem;align-items:center;justify-content:center;position:relative;z-index:1;border:1px solid;border-radius:var(--radius-full)}
.process-timeline__content{min-width:0;padding:.1rem 0 var(--space-3_5);border-bottom:1px solid var(--border-primary)}
.process-timeline__item.is-last .process-timeline__content{border-bottom:0}
.process-timeline__heading{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--space-4)}
.process-timeline__heading>div:first-child{min-width:0}
.process-timeline__title-row{display:flex;align-items:center;gap:var(--space-2);min-width:0}
.process-timeline__heading h4{min-width:0;margin:0;color:var(--text-primary);overflow-wrap:anywhere}
.process-timeline__heading p{margin:var(--space-1) 0 0;color:var(--text-secondary);font-size:var(--text-xs);line-height:var(--body-leading)}
.process-timeline__subject{display:inline-flex;max-width:min(28rem,52vw);min-height:1.45rem;align-items:center;gap:var(--space-1);overflow:hidden;padding:.12rem var(--space-2);border:1px solid var(--border-primary);border-radius:var(--radius-full);background:var(--bg-input);color:var(--text-secondary);font-size:var(--text-xs);font-weight:var(--font-weight-bold);line-height:1;text-overflow:ellipsis;white-space:nowrap}
.process-timeline__meta{display:flex;align-items:center;justify-content:flex-end;gap:var(--space-2);flex:none}
.process-timeline__duration{color:var(--text-tertiary);font-family:var(--font-mono);font-size:var(--text-xs)}
.process-timeline__status{display:inline-flex;align-items:center;padding:var(--space-0_5) var(--space-2);border:1px solid;border-radius:var(--radius-full);font-size:var(--text-xs);font-weight:var(--font-weight-bold)}
.process-timeline__status{background:transparent!important;color:var(--text-tertiary);opacity:.82}
.process-timeline__action{display:inline-flex;min-height:2.25rem;align-items:center;gap:var(--space-1);padding:0 var(--space-3);border:1px solid color-mix(in srgb,var(--accent) 34%,var(--border-secondary));border-radius:var(--radius-full);background:var(--accent-muted);color:var(--accent);font-size:var(--text-xs);font-weight:var(--font-weight-bold);text-decoration:none;transition:background var(--duration-fast) ease,border-color var(--duration-fast) ease,color var(--duration-fast) ease,transform var(--duration-fast) ease}
.process-timeline__action:hover{border-color:color-mix(in srgb,var(--accent) 42%,var(--border-secondary));background:var(--accent-muted);color:var(--accent-strong)}
.process-timeline__action:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.process-timeline__toggle{margin-top:var(--space-2);}
.process-timeline__toggle:hover{color:var(--accent-strong)}
.process-timeline__toggle:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:var(--radius-sm)}
.process-timeline__toggle-icon{transition:transform var(--duration-fast) ease}
.process-timeline__toggle-icon.is-expanded{transform:rotate(90deg)}
.process-timeline__details{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--space-2) var(--space-3);margin-top:var(--space-2);padding:var(--space-3);border:1px solid var(--border-primary);border-radius:var(--radius-md);background:var(--bg-input)}
.process-timeline__detail{display:grid;grid-template-columns:.55rem minmax(0,1fr);gap:var(--space-2);align-items:start;min-width:0;padding:var(--space-2);border:1px solid;border-radius:var(--radius-md)}
.process-timeline__detail-dot{width:.5rem;height:.5rem;margin-top:var(--space-1);border-radius:var(--radius-full);border:0;background:currentColor}
.process-timeline__detail-title{display:flex;align-items:center;gap:var(--space-1_5);min-width:0}
.process-timeline__detail strong{display:block;overflow:hidden;color:var(--text-primary);font-size:var(--text-xs);font-weight:var(--font-weight-semibold);text-overflow:ellipsis;white-space:nowrap}
.process-timeline__detail-subject{display:inline-flex;max-width:45%;overflow:hidden;padding:.08rem var(--space-1_5);border-radius:var(--radius-full);background:var(--bg-input);color:var(--text-tertiary);font-size:var(--text-xs);font-weight:var(--font-weight-bold);text-overflow:ellipsis;white-space:nowrap}
.process-timeline__detail p{margin:.12rem 0 0;overflow:hidden;color:var(--text-tertiary);font-size:var(--text-xs);line-height:var(--body-leading);text-overflow:ellipsis;white-space:nowrap}
.process-timeline--wide-time .process-timeline__item{grid-template-columns:8.9rem 2rem minmax(0,1fr)}
.process-timeline--compact .process-timeline__item{grid-template-columns:3.65rem 1.85rem minmax(0,1fr);column-gap:var(--space-2_5);padding-bottom:var(--space-3)}
.process-timeline--compact .process-timeline__time{font-size:var(--text-xs)}
.process-timeline--compact .process-timeline__rail::after{top:1.85rem;bottom:-.7rem;width:2px}
.process-timeline--compact .process-timeline__dot{width:1.85rem;height:1.85rem}
.process-timeline--compact .process-timeline__content{padding:.05rem 0 var(--space-2)}
.process-timeline--compact .process-timeline__heading{gap:var(--space-2_5)}
.process-timeline--compact .process-timeline__heading p{display:-webkit-box;overflow:hidden;-webkit-line-clamp:1;-webkit-box-orient:vertical;font-size:var(--text-xs)}
.process-timeline--compact .process-timeline__subject{display:none}
.process-timeline--compact .process-timeline__status{display:none}
.process-timeline--compact .process-timeline__action{min-height:2rem;padding:0 var(--space-2);font-size:var(--text-xs)}
@media(max-width:720px){
  .process-timeline__item,
  .process-timeline--compact .process-timeline__item,
  .process-timeline--wide-time .process-timeline__item{grid-template-columns:2rem minmax(0,1fr);column-gap:var(--space-2_5);padding-bottom:var(--space-4)}
  .process-timeline__time,
  .process-timeline--compact .process-timeline__time{grid-column:2;grid-row:1;margin-bottom:var(--space-1);padding:0;font-size:var(--text-xs)}
  .process-timeline__rail,
  .process-timeline--compact .process-timeline__rail{grid-column:1;grid-row:1 / span 2}
  .process-timeline__content,
  .process-timeline--compact .process-timeline__content{grid-column:2;grid-row:2;padding:.05rem 0 var(--space-3)}
  .process-timeline__heading{display:block}
  .process-timeline__title-row{align-items:flex-start;flex-direction:column;gap:var(--space-1_5)}
  .process-timeline--compact .process-timeline__heading p{display:block;overflow:visible;-webkit-line-clamp:unset;font-size:var(--text-xs)}
  .process-timeline__subject{max-width:100%}
  .process-timeline__meta{justify-content:flex-start;flex-wrap:wrap;margin-top:var(--space-2)}
  .process-timeline__action,
  .process-timeline--compact .process-timeline__action{min-height:2.35rem;padding:0 var(--space-3);font-size:var(--text-xs)}
  .process-timeline__details{grid-template-columns:1fr}
}
</style>
