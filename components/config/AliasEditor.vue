<template>
  <div class="alias-editor">
    <!-- ═══ Table mode ═══ -->
    <div class="border border-[var(--border-primary)] rounded-lg overflow-hidden" :class="{ 'opacity-60 pointer-events-none': jsonExpanded }">
      <!-- Header -->
      <div class="grid grid-cols-[1fr,1fr,auto] gap-2 px-3 py-2 text-2xs text-muted-deep font-medium border-b border-[var(--border-primary)] bg-[var(--bg-surface)]">
        <span>原艺人名</span>
        <span>替换为</span>
        <span class="w-8" />
      </div>

      <!-- Scrollable rows -->
      <div class="max-h-48 overflow-y-auto">
        <div
          v-for="(row, i) in rows"
          :key="row.id"
          class="grid grid-cols-[1fr,1fr,auto] gap-2 px-3 py-1.5 border-b border-[var(--border-primary)] last:border-b-0 items-center"
        >
        <input
          :value="row.key"
          type="text"
          placeholder="旧名"
          class="form-input text-xs py-1 px-2"
          :class="{ '!border-danger': row.key && duplicateKeys.has(row.key) }"
          :title="row.key && duplicateKeys.has(row.key) ? '此名称已存在，保存时将覆盖前面的映射' : undefined"
          @input="updateRow(row.id, 'key', ($event.target as HTMLInputElement).value)"
        />
        <input
          :value="row.value"
          type="text"
          placeholder="新名"
          class="form-input text-xs py-1 px-2"
          @input="updateRow(row.id, 'value', ($event.target as HTMLInputElement).value)"
        />
        <button
          class="w-7 h-7 flex items-center justify-center rounded text-muted-deep hover:text-danger hover:bg-[var(--danger-bg)] transition-colors"
          title="删除映射"
          type="button"
          @click="removeRow(i)"
        >
          <AppIcon name="trash" :size="14" />
        </button>
      </div>

      <!-- Empty state -->
      <div v-if="rows.length === 0" class="px-3 py-4 text-center text-2xs text-muted-deep">
        暂无映射，点击下方按钮添加
      </div>
      </div>

      <!-- Add button -->
      <div class="px-3 py-2 border-t border-[var(--border-primary)] bg-[var(--bg-surface)]">
        <button class="text-xs text-accent hover:underline flex items-center gap-1" @click="addRow">
          <AppIcon name="plus" :size="12" />
          添加映射
        </button>
      </div>
    </div>

    <!-- Duplicate key warning -->
    <p v-if="duplicateKeys.size > 0 && !jsonExpanded" class="mt-1 inline-flex items-center gap-1 text-2xs text-warning">
      <AppIcon name="warn" :size="12" />
      以下名称重复出现，保存时将使用最后一行的值：{{ [...duplicateKeys].join('、') }}
    </p>

    <!-- ═══ JSON editor toggle ═══ -->
    <button
      class="text-2xs text-muted hover:text-[var(--text-primary)] mt-2 flex items-center gap-1 transition-colors"
      @click="toggleJson"
    >
      <AppIcon name="chevronRight" :size="10" class="transition-transform" :class="{ 'rotate-90': jsonExpanded }" />
      高级 JSON 编辑器
    </button>

    <!-- ═══ JSON editor ═══ -->
    <div v-if="jsonExpanded" class="mt-2">
      <textarea
        v-model="jsonText"
        class="form-input font-mono text-xs h-28"
        :class="{ '!border-danger': jsonError }"
        placeholder='{ "旧名": "新名" }'
        @input="onJsonInput"
      />
      <p v-if="jsonError" class="text-xs text-danger mt-1">{{ jsonError }}</p>
      <p class="text-2xs text-muted-deep mt-1">
        编辑完成后点击上方「高级 JSON 编辑器」按钮折叠，系统将自动校验格式
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
interface AliasRow {
  id: string
  key: string
  value: string
}

const props = defineProps<{
  modelValue: Record<string, string>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, string>]
}>()

// ── State ──
const rows = ref<AliasRow[]>([])
const jsonText = ref('')
const jsonError = ref('')
const jsonExpanded = ref(false)

// ── Derived: detect duplicate keys ──
const duplicateKeys = computed(() => {
  const seen = new Map<string, number>()
  const dups = new Set<string>()
  for (const r of rows.value) {
    if (!r.key) continue
    const count = (seen.get(r.key) ?? 0) + 1
    seen.set(r.key, count)
    if (count > 1) dups.add(r.key)
  }
  return dups
})

// ── Build Record from rows (later rows override earlier — Object.assign semantics) ──
function rowsToRecord(r: AliasRow[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const row of r) {
    if (row.key) result[row.key] = row.value
  }
  return result
}

function recordToRows(rec: Record<string, string>): AliasRow[] {
  // Preserve existing row order and IDs. Object.entries on a plain object
  // re-orders integer-like keys (e.g. "123") before string keys, so we must
  // iterate the current rows first to keep the user's visible order stable.
  const existingId = new Map<string, string>()
  for (const r of rows.value) {
    if (r.key) existingId.set(r.key, r.id)
  }

  const result: AliasRow[] = []
  const seen = new Set<string>()

  // Pass 1: keep existing rows in their current order, update values from rec
  for (const r of rows.value) {
    if (Object.hasOwn(rec, r.key)) {
      result.push({ id: r.id, key: r.key, value: rec[r.key]! })
      seen.add(r.key)
    }
  }

  // Pass 2: append new keys (not in current rows) at the end
  for (const [key, value] of Object.entries(rec)) {
    if (!seen.has(key)) {
      result.push({ id: crypto.randomUUID(), key, value })
    }
  }

  return result
}

function rowsToJson(r: AliasRow[]): string {
  const rec = rowsToRecord(r)
  return Object.keys(rec).length > 0 ? JSON.stringify(rec, null, 2) : ''
}

// ── Sync: modelValue → rows (external changes only, e.g. loadConfig / import / reset) ──
watch(() => props.modelValue, (val) => {
  const newRows = recordToRows(val ?? {})
  if (isRowsSame(newRows, rows.value)) return
  rows.value = newRows
  if (!jsonExpanded.value) {
    jsonText.value = rowsToJson(rows.value)
  }
  jsonError.value = ''
}, { immediate: true })

// ── Sync: rows → modelValue (called explicitly from row operations, not via watcher) ──
function syncToParent() {
  const rec = rowsToRecord(rows.value)
  if (isRecordSame(rec, props.modelValue)) return
  emit('update:modelValue', rec)
  if (!jsonExpanded.value) {
    jsonText.value = rowsToJson(rows.value)
  }
}

// ── Equality helpers ──
function isRecordSame(a: Record<string, string>, b: Record<string, string>): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function isRowsSame(a: AliasRow[], b: AliasRow[]): boolean {
  // Order-independent comparison — Object.entries on plain objects reorders
  // integer-like keys (e.g. "123") before string keys, so index-based
  // comparison would falsely report a difference and trigger DOM rebuild.
  if (a.length !== b.length) return false
  const bMap = new Map(b.map((r) => [r.key, r.value] as const))
  for (const row of a) {
    if (bMap.get(row.key) !== row.value) return false
  }
  return true
}

// ── Row operations ──
function addRow() {
  rows.value = [...rows.value, { id: crypto.randomUUID(), key: '', value: '' }]
  // Don't sync empty-key rows — they'll sync when the user types a key
}

function removeRow(index: number) {
  const next = [...rows.value]
  next.splice(index, 1)
  rows.value = next
  syncToParent()
}

function updateRow(id: string, field: 'key' | 'value', newVal: string) {
  rows.value = rows.value.map((r) =>
    r.id === id ? { ...r, [field]: newVal } : r,
  )
  syncToParent()
}

// ── JSON editor ──
function onJsonInput() {
  jsonError.value = ''
}

function toggleJson() {
  if (jsonExpanded.value) {
    // Collapsing: validate JSON first
    const trimmed = jsonText.value.trim()
    if (!trimmed) {
      // Empty → clear all rows
      jsonExpanded.value = false
      rows.value = []
      jsonError.value = ''
      syncToParent()
      return
    }
    try {
      const parsed = JSON.parse(trimmed)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        jsonError.value = '请输入 JSON 对象，例如 { "旧名": "新名" }'
        return
      }
      for (const [key, val] of Object.entries(parsed)) {
        if (typeof val !== 'string') {
          jsonError.value = `"${key}" 的值必须是字符串`
          return
        }
      }
      // Valid — sync to rows
      jsonExpanded.value = false
      rows.value = recordToRows(parsed as Record<string, string>)
      jsonError.value = ''
      syncToParent()
    } catch (err) {
      jsonError.value = 'JSON 格式错误: ' + (err instanceof Error ? err.message : '无法解析')
    }
  } else {
    // Expanding: rebuild JSON from current rows
    jsonText.value = rowsToJson(rows.value)
    jsonError.value = ''
    jsonExpanded.value = true
  }
}
</script>

<style scoped>
.alias-editor ::-webkit-scrollbar {
  width: 6px;
}
.alias-editor ::-webkit-scrollbar-track {
  background: transparent;
}
.alias-editor ::-webkit-scrollbar-thumb {
  background: var(--accent, #818cf8);
  border-radius: 3px;
}
.alias-editor ::-webkit-scrollbar-thumb:hover {
  background: var(--accent-hover, #6366f1);
}
/* Firefox */
.alias-editor .max-h-48 {
  scrollbar-width: thin;
  scrollbar-color: var(--accent, #818cf8) transparent;
}
</style>
