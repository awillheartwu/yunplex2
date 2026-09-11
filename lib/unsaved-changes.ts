// Client-only editor callbacks; drafts and credentials are never persisted here.
const guards = new Set<() => boolean | Promise<boolean>>()

export function registerUnsavedChangesGuard(guard: () => boolean | Promise<boolean>) {
  guards.add(guard)
  return () => { guards.delete(guard) }
}

export async function confirmUnsavedChanges() {
  for (const guard of guards) if (!await guard()) return false
  return true
}
