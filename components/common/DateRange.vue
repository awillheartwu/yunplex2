<template>
  <div class="relative" ref="containerRef">
    <!-- Trigger -->
    <button
      class="flex items-center gap-1.5 text-xs px-3 rounded-lg border transition-colors cursor-pointer shrink-0 h-8 overflow-hidden"
      :style="{
        background: open ? 'var(--bg-surface)' : 'var(--bg-app)',
        borderColor: hasFilter ? 'var(--accent)' : 'var(--border-primary)',
        color: hasFilter ? 'var(--accent)' : 'var(--text-secondary)',
      }"
      ref="triggerEl"
      @click="open ? closePanel() : openPanel()"
    >
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
        <rect x="2.5" y="3" width="11" height="10.5" rx="1.5" stroke="currentColor" stroke-width="1.2" />
        <path d="M2.5 6h11" stroke="currentColor" stroke-width="1.2" />
        <path d="M5.5 1.5v3M10.5 1.5v3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
      </svg>
      <span class="max-w-[160px] truncate">{{ triggerLabel }}</span>
      <span v-if="hasFilter" class="text-2xs px-1 py-0 rounded-full shrink-0" style="background:var(--accent-glow);color:var(--accent)">●</span>
    </button>

    <!-- Popover (Teleport to body to avoid stacking-context traps) -->
    <Teleport to="body">
      <div v-if="open" class="fixed inset-0 z-50" @click.self="closePanel()" />
      <div v-if="open" class="fixed z-[51] rounded-xl shadow-xl border overflow-hidden"
        :style="{ top: panelTop + 'px', left: panelLeft + 'px', background: 'var(--bg-surface)', borderColor: 'var(--border-primary)', minWidth: '420px' }"
      >
        <!-- Calendar grids -->
        <div class="flex">
          <div v-for="(cal, ci) in [leftMonth, rightMonth]" :key="ci" class="flex-1 p-3" :class="ci === 0 ? '' : ''" :style="ci === 0 ? { borderRight: '1px solid var(--border-primary)' } : {}">
          <!-- Month header -->
          <div class="flex items-center justify-between mb-2">
            <button
              v-if="ci === 0"
              class="w-5 h-5 flex items-center justify-center rounded cursor-pointer hover:bg-[var(--bg-hover)] transition-colors"
              style="color:var(--text-tertiary)"
              @click="shiftMonth(-1)"
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <span class="text-xs font-medium" style="color:var(--text-primary)">{{ monthLabel(cal.year, cal.month) }}</span>
            <button
              v-if="ci === 1"
              class="w-5 h-5 flex items-center justify-center rounded cursor-pointer hover:bg-[var(--bg-hover)] transition-colors"
              style="color:var(--text-tertiary)"
              @click="shiftMonth(1)"
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>

          <!-- Day-of-week headers -->
          <div class="grid grid-cols-7 mb-1">
            <span v-for="d in dowLabels" :key="d" class="text-2xs text-center py-0.5" style="color:var(--text-tertiary)">{{ d }}</span>
          </div>

          <!-- Day cells -->
          <div class="grid grid-cols-7 gap-y-0.5">
            <button
              v-for="(day, di) in cal.days" :key="di"
              class="aspect-square rounded text-xs flex items-center justify-center transition-colors"
              :class="isDayDisabled(day) ? 'pointer-events-none opacity-20' : 'cursor-pointer'"
              :style="dayCellStyle(day)"
              @click="onDayClick(day)"
            >{{ day.label }}</button>
          </div>
        </div>
      </div>

      <!-- Presets + Apply -->
      <div class="px-3 pb-3 flex items-center gap-1.5" style="border-top:1px solid var(--border-primary);padding-top:10px">
        <button
          v-for="p in presets" :key="p.label"
          class="text-2xs px-2 py-1 rounded transition-colors cursor-pointer"
          :style="isPresetActive(p) ? { background: 'var(--accent-glow)', color: 'var(--accent)' } : { color: 'var(--text-tertiary)' }"
          :class="isPresetActive(p) ? '' : 'hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'"
          @click="applyPreset(p); closePanel()"
        >{{ p.label }}</button>
        <button
          v-if="hasFilter"
          class="text-2xs px-2 py-1 rounded cursor-pointer hover:bg-[var(--bg-hover)] transition-colors text-muted ml-auto"
          @click="clearFilter(); closePanel()"
        >清除</button>
      </div>
    </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
export interface DateRangeValue {
  from: string | null
  to: string | null
}

const props = defineProps<{ modelValue: DateRangeValue; minDate?: string | null }>()
const emit = defineEmits<{ 'update:modelValue': [value: DateRangeValue] }>()

const open = ref(false)
const triggerEl = ref<HTMLElement | null>(null)
const panelTop = ref(0)
const panelLeft = ref(0)
const baseDate = ref(new Date())

function openPanel() {
  if (triggerEl.value) {
    const rect = triggerEl.value.getBoundingClientRect()
    const panelW = 420
    panelTop.value = rect.bottom + 6
    // Align right edge of panel with right edge of button
    let left = rect.right - panelW
    // Clamp: don't go beyond viewport edges
    if (left < 8) left = 8
    if (left + panelW > window.innerWidth - 8) left = window.innerWidth - panelW - 8
    panelLeft.value = left
  }
  open.value = true
}

function closePanel() {
  open.value = false
  pickingFrom.value = null
}

// Track the selection steps: 0=none, 1=picked from, 2=picked range
const pickingFrom = ref<string | null>(null)

const hasFilter = computed(() => !!(props.modelValue?.from || props.modelValue?.to))

const triggerLabel = computed(() => {
  const v = props.modelValue
  if (v?.from && v?.to) {
    if (v.from === v.to) return v.from
    return `${v.from} ~ ${v.to}`
  }
  if (v?.from) return `${v.from} 起`
  if (v?.to) return `至 ${v.to}`
  return '日期筛选'
})

// ── Calendar building ──

interface DayCell {
  label: number
  year: number
  month: number
  day: number
  date: string // YYYY-MM-DD
  isOtherMonth: boolean
}

const leftMonth = computed(() => buildCalendar(baseDate.value.getFullYear(), baseDate.value.getMonth()))
const rightMonth = computed(() => {
  const d = new Date(baseDate.value)
  d.setMonth(d.getMonth() + 1)
  return buildCalendar(d.getFullYear(), d.getMonth())
})

function buildCalendar(year: number, month: number): { year: number; month: number; days: DayCell[] } {
  const days: DayCell[] = []
  const firstDay = new Date(year, month, 1)
  const startDow = firstDay.getDay() // 0=Sun

  // Pad previous month
  const prevMonth = new Date(year, month, 0)
  for (let i = startDow - 1; i >= 0; i--) {
    const d = prevMonth.getDate() - i
    days.push(makeCell(prevMonth.getFullYear(), prevMonth.getMonth(), d, true))
  }

  // Current month
  const lastDay = new Date(year, month + 1, 0)
  for (let d = 1; d <= lastDay.getDate(); d++) {
    days.push(makeCell(year, month, d, false))
  }

  // Pad next month to fill 6 rows
  const remaining = 42 - days.length
  const nextMonth = new Date(year, month + 1, 1)
  for (let d = 1; d <= remaining; d++) {
    days.push(makeCell(nextMonth.getFullYear(), nextMonth.getMonth(), d, true))
  }

  return { year, month, days }
}

function makeCell(year: number, month: number, day: number, isOtherMonth: boolean): DayCell {
  const m = String(month + 1).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return { label: day, year, month, day, date: `${year}-${m}-${dd}`, isOtherMonth }
}

// ── Interaction ──

function onDayClick(day: DayCell) {
  if (day.isOtherMonth) {
    baseDate.value = new Date(day.year, day.month, 1)
    return
  }

  if (!pickingFrom.value || (pickingFrom.value && props.modelValue?.to)) {
    // Start a new range
    pickingFrom.value = day.date
    emit('update:modelValue', { from: day.date, to: null })
  } else if (pickingFrom.value === day.date) {
    // Same day clicked twice → entire day
    emit('update:modelValue', { from: day.date, to: day.date })
    closePanel()
  } else {
    // Complete the range
    const from = pickingFrom.value!
    const to = day.date
    if (from <= to) {
      emit('update:modelValue', { from, to })
    } else {
      emit('update:modelValue', { from: to, to: from })
    }
    closePanel()
  }
}

const todayStr = today()
function isDayDisabled(day: DayCell): boolean {
  if (day.isOtherMonth) return true
  if (day.date > todayStr) return true
  if (props.minDate && day.date < props.minDate) return true
  if (pickingFrom.value && day.date < pickingFrom.value) return true
  return false
}

function dayCellStyle(day: DayCell): Record<string, string> {
  const v = props.modelValue
  const s: Record<string, string> = { color: 'var(--text-primary)' }

  if (day.isOtherMonth) {
    s.color = 'var(--text-tertiary)'
    s.opacity = '0.25'
  }

  // Highlight range
  if (v?.from && v?.to && day.date >= v.from && day.date <= v.to) {
    s.background = 'var(--accent-glow)'
    s.color = 'var(--accent)'
  }

  // Highlight from/to endpoints
  if (day.date === v?.from || day.date === v?.to) {
    s.background = 'var(--accent)'
    s.color = '#fff'
    s.borderRadius = '6px'
  }

  // Highlight picking-from
  if (pickingFrom.value && day.date === pickingFrom.value) {
    s.background = 'var(--accent)'
    s.color = '#fff'
    s.borderRadius = '6px'
  }

  // Hover effect (managed by CSS class)

  return s
}

// ── Month nav ──

function shiftMonth(delta: number) {
  const d = new Date(baseDate.value)
  d.setMonth(d.getMonth() + delta)
  baseDate.value = d
}

function monthLabel(year: number, month: number): string {
  return `${year}年${month + 1}月`
}

// ── Presets ──

interface Preset { label: string; from: string | null; to: string | null }

const presets: Preset[] = [
  { label: '全部', from: null, to: null },
  { label: '今天', from: today(), to: today() },
  { label: '近7天', from: daysAgo(6), to: today() },
  { label: '近30天', from: daysAgo(29), to: today() },
]

function today(): string {
  return new Date().toISOString().slice(0, 10)
}
function daysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86400000)
  return d.toISOString().slice(0, 10)
}

function isPresetActive(p: Preset): boolean {
  return props.modelValue?.from === p.from && props.modelValue?.to === p.to
}

function applyPreset(p: Preset) {
  emit('update:modelValue', { from: p.from, to: p.to })
}

function clearFilter() {
  emit('update:modelValue', { from: null, to: null })
}

const dowLabels = ['日', '一', '二', '三', '四', '五', '六']
</script>
