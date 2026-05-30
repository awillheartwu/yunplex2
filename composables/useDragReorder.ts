export function useDragReorder<T>(items: Ref<T[]>, onReorder: (orderedIds: string[]) => Promise<void>, getId: (item: T) => string) {
  const dragIdx = ref<number | null>(null)
  const dragOverIdx = ref<number | null>(null)

  function onDragStart(idx: number, e: DragEvent) {
    dragIdx.value = idx
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
  }

  function onDragOver(idx: number) {
    if (dragIdx.value === null || dragIdx.value === idx) return
    dragOverIdx.value = idx
  }

  function onDragLeave() {
    dragOverIdx.value = null
  }

  async function onDrop(idx: number) {
    if (dragIdx.value === null || dragIdx.value === idx) return
    const arr = [...items.value]
    const [moved] = arr.splice(dragIdx.value, 1)
    if (!moved) return
    arr.splice(idx, 0, moved)
    items.value = arr
    dragIdx.value = null
    dragOverIdx.value = null
    try {
      await onReorder(arr.map(getId))
    } catch { /* ignore */ }
  }

  function onDragEnd() {
    dragIdx.value = null
    dragOverIdx.value = null
  }

  return { dragIdx, dragOverIdx, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd }
}
