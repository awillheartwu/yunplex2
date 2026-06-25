import type { TaskSemanticTone } from '~~/lib/task-status'

export interface ProcessTimelineDetail {
  id: string
  title: string
  description?: string
  subjectLabel?: string
  tone?: TaskSemanticTone
}

export interface ProcessTimelineAction {
  label: string
  to: string
  icon?: string
  ariaLabel?: string
}

export interface ProcessTimelineItem {
  id: string
  occurredAt: string | null
  timeLabel?: string
  title: string
  description: string
  subjectLabel?: string
  subjectIcon?: string
  tone: TaskSemanticTone
  icon: string
  statusLabel?: string
  durationMs?: number
  details: ProcessTimelineDetail[]
  action?: ProcessTimelineAction
  highlighted?: boolean
}
