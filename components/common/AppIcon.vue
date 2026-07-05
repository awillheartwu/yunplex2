<template>
  <component
    :is="iconComponent"
    :aria-hidden="decorative ? 'true' : undefined"
    :aria-label="decorative ? undefined : label"
    :size="size"
    :stroke-width="strokeWidth"
    class="app-icon"
  />
</template>

<script setup lang="ts">
import type { Component } from 'vue'
import {
  Activity,
  Album,
  AlertTriangle,
  Archive,
  ArrowDownUp,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  CircleCheck,
  CircleHelp,
  CircleMinus,
  CircleOff,
  CircleX,
  Clock3,
  Copy,
  Database,
  Download,
  ExternalLink,
  Folder,
  GitBranch,
  GripVertical,
  Info,
  Keyboard,
  LayoutDashboard,
  List,
  ListCollapse,
  ListMusic,
  LogOut,
  LoaderCircle,
  Menu,
  Minus,
  Moon,
  MoreHorizontal,
  Music,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ScrollText,
  Search,
  Settings,
  Shield,
  SlidersHorizontal,
  Square,
  Sun,
  Trash2,
  TriangleAlert,
  Upload,
  User,
  Wrench,
  X,
} from '@lucide/vue'
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  name: string
  label?: string
  size?: number | string
  strokeWidth?: number | string
  decorative?: boolean
}>(), {
  label: '',
  size: 18,
  strokeWidth: 1.8,
  decorative: true,
})

const iconMap: Record<string, Component> = {
  activity: Activity,
  album: Album,
  alert: AlertTriangle,
  archive: Archive,
  arrowLeft: ArrowLeft,
  arrowRight: ArrowRight,
  calendar: CalendarDays,
  check: Check,
  checkCircle: CircleCheck,
  chevronDown: ChevronDown,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  chevronsDown: ChevronsDown,
  chevronsUp: ChevronsUp,
  clock: Clock3,
  close: X,
  copy: Copy,
  database: Database,
  dashboard: LayoutDashboard,
  download: Download,
  edit: Pencil,
  existing: CircleMinus,
  external: ExternalLink,
  failure: CircleX,
  filter: SlidersHorizontal,
  folder: Folder,
  github: GitBranch,
  grip: GripVertical,
  importExport: ArrowDownUp,
  info: Info,
  ignored: CircleOff,
  keyboard: Keyboard,
  list: List,
  listCollapse: ListCollapse,
  logs: ScrollText,
  logOut: LogOut,
  loader: LoaderCircle,
  menu: Menu,
  minus: Minus,
  minusCircle: CircleMinus,
  more: MoreHorizontal,
  moon: Moon,
  music: Music,
  pause: Pause,
  play: Play,
  plus: Plus,
  refresh: RefreshCw,
  repair: Wrench,
  rotateCcw: RotateCcw,
  save: Save,
  search: Search,
  settings: Settings,
  shield: Shield,
  source: ListMusic,
  stop: Square,
  sun: Sun,
  sync: RefreshCw,
  trash: Trash2,
  upload: Upload,
  user: User,
  warn: TriangleAlert,
  x: X,
}

const normalizedName = computed(() => props.name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()))

const iconComponent = computed(() => {
  const mapped = iconMap[normalizedName.value] ?? iconMap[props.name]
  return mapped ?? CircleHelp
})

const label = computed(() => props.label || props.name)
</script>
