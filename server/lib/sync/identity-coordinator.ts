import { getActiveSongIdentityBindings } from './identity-store'

export type BindingVersionSnapshot = Map<number, string | null>

let tail: Promise<void> = Promise.resolve()

/** Fair process-local mutex around the final Plex mutation boundary. */
export async function acquireIdentityMutationLock(): Promise<() => void> {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const previous = tail
  tail = previous.then(() => gate)
  await previous
  let released = false
  return () => {
    if (released) return
    released = true
    release()
  }
}

export function captureBindingVersions(songIds: number[]): BindingVersionSnapshot {
  const bindings = getActiveSongIdentityBindings(songIds)
  return new Map([...new Set(songIds)].map(songId => [songId, bindings.get(songId)?.updatedAt ?? null]))
}

export function assertBindingVersionsUnchanged(snapshot: BindingVersionSnapshot): void {
  const current = getActiveSongIdentityBindings([...snapshot.keys()])
  for (const [songId, version] of snapshot) {
    if ((current.get(songId)?.updatedAt ?? null) !== version) {
      throw new Error(`歌曲 #${songId} 的身份已变化，本轮已安全中止 Plex 写入和删除，请重试同步`)
    }
  }
}
