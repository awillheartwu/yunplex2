export type FeedbackType = 'success' | 'error' | 'warning' | 'info'

export interface FeedbackToast {
  id: string
  type: FeedbackType
  title: string
  message?: string
  timeoutMs: number
}

const toasts = ref<FeedbackToast[]>([])
const timers = new Map<string, ReturnType<typeof setTimeout>>()

function dismiss(id: string) {
  const timer = timers.get(id)
  if (timer) clearTimeout(timer)
  timers.delete(id)
  toasts.value = toasts.value.filter((toast) => toast.id !== id)
}

function pushToast(type: FeedbackType, title: string, message?: string, timeoutMs = 4200) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const toast: FeedbackToast = { id, type, title, message, timeoutMs }
  toasts.value = [toast, ...toasts.value].slice(0, 4)
  timers.set(id, setTimeout(() => dismiss(id), timeoutMs))
  return id
}

export function useFeedback() {
  return {
    toasts,
    dismiss,
    info: (title: string, message?: string, timeoutMs?: number) => pushToast('info', title, message, timeoutMs),
    success: (title: string, message?: string, timeoutMs?: number) => pushToast('success', title, message, timeoutMs),
    warning: (title: string, message?: string, timeoutMs?: number) => pushToast('warning', title, message, timeoutMs),
    error: (title: string, message?: string, timeoutMs?: number) => pushToast('error', title, message, timeoutMs),
  }
}
