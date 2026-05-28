<template>
  <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <!-- Dashboard -->
    <template v-if="name === 'dashboard'">
      <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.5" :stroke="color" stroke-width="1.3" />
      <rect x="9" y="1.5" width="5.5" height="5.5" rx="1.5" :stroke="color" stroke-width="1.3" />
      <rect x="1.5" y="9" width="5.5" height="5.5" rx="1.5" :stroke="color" stroke-width="1.3" />
      <rect x="9" y="9" width="5.5" height="5.5" rx="1.5" :stroke="color" stroke-width="1.3" />
    </template>
    <!-- Settings -->
    <template v-else-if="name === 'settings'">
      <circle cx="8" cy="8" r="2.6" :stroke="color" stroke-width="1.3" />
      <path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3" :stroke="color" stroke-width="1.3" stroke-linecap="round" />
    </template>
    <!-- List / Jobs -->
    <template v-else-if="name === 'list'">
      <rect x="2" y="2.5" width="12" height="2.2" rx="1" :stroke="color" stroke-width="1.3" />
      <rect x="2" y="6.9" width="9" height="2.2" rx="1" :stroke="color" stroke-width="1.3" />
      <rect x="2" y="11.3" width="7" height="2.2" rx="1" :stroke="color" stroke-width="1.3" />
    </template>
    <!-- Logs -->
    <template v-else-if="name === 'logs'">
      <rect x="2" y="2" width="12" height="12" rx="1.5" :stroke="color" stroke-width="1.3" />
      <line x1="5" y1="5.5" x2="11" y2="5.5" :stroke="color" stroke-width="1.3" stroke-linecap="round" />
      <line x1="5" y1="8" x2="10" y2="8" :stroke="color" stroke-width="1.3" stroke-linecap="round" />
      <line x1="5" y1="10.5" x2="9" y2="10.5" :stroke="color" stroke-width="1.3" stroke-linecap="round" />
    </template>
    <!-- Activity / Task -->
    <template v-else-if="name === 'activity'">
      <path d="M2 12L5.5 8L8 10L11 6L14 8" :stroke="color" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="3.5" cy="3.5" r="1.3" :stroke="color" stroke-width="1.3" />
    </template>
    <!-- Info -->
    <template v-else-if="name === 'info'">
      <circle cx="8" cy="8" r="5.5" :stroke="color" stroke-width="1.3" />
      <path d="M8 7.2v4M8 4.8v0" :stroke="color" stroke-width="1.5" stroke-linecap="round" />
    </template>
    <!-- Sync / Refresh -->
    <template v-else-if="name === 'sync'">
      <path d="M13.5 8a5.5 5.5 0 00-9.9-3M2.5 8a5.5 5.5 0 009.9 3" :stroke="color" stroke-width="1.3" stroke-linecap="round" />
      <path d="M2.5 2v3.5H6M13.5 14v-3.5H10" :stroke="color" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
    </template>
    <!-- Play / Trigger -->
    <template v-else-if="name === 'play'">
      <path d="M5 2.5l8 5.5-8 5.5V2.5z" :fill="color" />
    </template>
    <!-- Stop / Cancel -->
    <template v-else-if="name === 'stop'">
      <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" :fill="color" />
    </template>
    <!-- External link -->
    <template v-else-if="name === 'external'">
      <path d="M11 2h3v3M14 2L8 8M10 8.5V13H3V6h4.5" :stroke="color" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
    </template>
    <!-- Trash -->
    <template v-else-if="name === 'trash'">
      <path d="M2.5 4.5h11M5.5 4.5V3a1 1 0 011-1h3a1 1 0 011 1v1.5M6.5 7.5v4M9.5 7.5v4M3.5 4.5l1 8.5a1 1 0 001 1h5a1 1 0 001-1l1-8.5" :stroke="color" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
    </template>
    <!-- Download -->
    <template v-else-if="name === 'download'">
      <path d="M8 2v9M4.5 8L8 11.5 11.5 8M2 13.5h12" :stroke="color" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
    </template>
    <!-- Music -->
    <template v-else-if="name === 'music'">
      <circle cx="8" cy="8" r="5.5" :stroke="color" stroke-width="1.3" />
      <path d="M10.5 5.5v3.8a1.8 1.8 0 01-1.8 1.8 1.8 1.8 0 01-1.8-1.8 1.8 1.8 0 013.6 0z" :stroke="color" stroke-width="1.3" stroke-linecap="round" />
    </template>
    <!-- Check -->
    <template v-else-if="name === 'check'">
      <path d="M3 8l3.5 3.5L13 5" :stroke="color" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </template>
    <!-- Warning triangle -->
    <template v-else-if="name === 'warn'">
      <path d="M8 6v3M8 11v0M1.5 13.5h13L8 2.5 1.5 13.5z" :stroke="color" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
    </template>
    <!-- X / Close -->
    <template v-else-if="name === 'x'">
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" :stroke="color" stroke-width="1.5" stroke-linecap="round" />
    </template>
    <!-- Source / playlist source -->
    <template v-else-if="name === 'source'">
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" :stroke="color" stroke-width="1.3" />
      <path d="M5.5 6.5h5M5.5 9h4" :stroke="color" stroke-width="1.3" stroke-linecap="round" />
      <circle cx="10" cy="6.5" r="1.3" :stroke="color" stroke-width="1.3" />
    </template>
    <!-- Retention / Database -->
    <template v-else-if="name === 'database'">
      <ellipse cx="8" cy="3" rx="5" ry="1.5" :stroke="color" stroke-width="1.3" />
      <path d="M3 3v10c0 .8 2.2 1.5 5 1.5s5-.7 5-1.5V3" :stroke="color" stroke-width="1.3" />
      <path d="M3 8c0 .8 2.2 1.5 5 1.5s5-.7 5-1.5" :stroke="color" stroke-width="1.3" />
    </template>
    <!-- Import / Export -->
    <template v-else-if="name === 'import-export'">
      <path d="M11.5 2H13a1 1 0 011 1v10a1 1 0 01-1 1h-1.5M4.5 2H3a1 1 0 00-1 1v10a1 1 0 001 1h1.5" :stroke="color" stroke-width="1.3" stroke-linecap="round" />
      <path d="M5.5 10l2.5 2.5L10.5 10M8 12.5v-9" :stroke="color" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" />
    </template>
  </svg>
</template>

<script setup lang="ts">
const props = defineProps<{
  name: string
  active?: boolean
}>()

const color = computed(() => (props.active ? '#818cf8' : '#71717a'))
</script>
