import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enqueueTask: vi.fn(),
  getDownloadTask: vi.fn(),
  waitForDownloadTasks: vi.fn(async () => undefined),
  requestDownloadProcessing: vi.fn(async () => undefined),
}))

vi.mock('./queue', () => ({
  enqueueTask: mocks.enqueueTask,
  getDownloadTask: mocks.getDownloadTask,
  waitForDownloadTasks: mocks.waitForDownloadTasks,
}))
vi.mock('./worker', () => ({
  requestDownloadProcessing: mocks.requestDownloadProcessing,
}))
vi.mock('../db', () => ({
  getDb: () => ({}),
}))
vi.mock('../db/file-task-schema', () => ({
  createFileTaskSchema: vi.fn(),
  linkRunFileTask: vi.fn(),
}))

function intent(jobId: string, songId: number) {
  return {
    sourceId: 'source-one',
    songId,
    songName: `Song ${songId}`,
    artist: 'Artist',
    album: 'Album',
    quality: 'lossless',
    jobId,
    idempotencyKey: `song:${songId}`,
  }
}

function task(input: ReturnType<typeof intent>, jobId = input.jobId) {
  return {
    id: `task-${input.songId}`,
    sourceId: input.sourceId ?? null,
    songId: input.songId,
    songName: input.songName,
    artist: input.artist,
    album: input.album,
    status: 'pending' as const,
    progress: 0,
    retryCount: 0,
    jobId,
    createdAt: '',
    updatedAt: '',
  }
}

describe('file task submission handle', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.waitForDownloadTasks.mockResolvedValue(undefined)
    mocks.requestDownloadProcessing.mockResolvedValue(undefined)
  })

  it('maps intents to actual tasks and exposes reuse without changing the persisted owner', async () => {
    mocks.enqueueTask.mockImplementation((input) => (
      input.songId === 1 ? task(input) : task(input, 'other-run')
    ))
    const { submitFileTasks } = await import('./file-task-command')

    const handle = submitFileTasks([intent('current-run', 1), intent('current-run', 2)])

    expect(handle.tasks.map(item => ({ id: item.task.id, reused: item.reused }))).toEqual([
      { id: 'task-1', reused: false },
      { id: 'task-2', reused: true },
    ])
    expect(handle.ownedTaskIds).toEqual(['task-1'])
    expect(handle.reusedTaskIds).toEqual(['task-2'])
    expect(handle.tasks[1]?.task.jobId).toBe('other-run')
  })

  it('wakes globally without awaiting the global drain and waits only for its own task IDs', async () => {
    let releaseWake!: () => void
    mocks.requestDownloadProcessing.mockReturnValue(new Promise<void>(resolve => {
      releaseWake = resolve
    }))
    mocks.enqueueTask.mockImplementation(input => task(input))
    const { submitFileTasks } = await import('./file-task-command')
    const handle = submitFileTasks([intent('current-run', 7)])
    const throwIfCancelled = vi.fn()

    handle.wake()
    expect(mocks.requestDownloadProcessing).toHaveBeenCalledOnce()

    await handle.wait({ throwIfCancelled })
    expect(mocks.waitForDownloadTasks).toHaveBeenCalledWith({
      taskIds: ['task-7'],
      throwIfCancelled,
    })
    releaseWake()
  })

  it('forwards cancellation to the scoped wait without cancelling shared tasks', async () => {
    mocks.enqueueTask.mockImplementation(input => task(input))
    mocks.waitForDownloadTasks.mockImplementation(async (input) => {
      input.throwIfCancelled?.()
    })
    const { submitFileTasks } = await import('./file-task-command')
    const handle = submitFileTasks([intent('current-run', 8)])
    const cancellation = vi.fn(() => { throw new Error('cancelled') })

    await expect(handle.wait({ throwIfCancelled: cancellation })).rejects.toThrow('cancelled')
    expect(mocks.waitForDownloadTasks).toHaveBeenCalledWith({
      taskIds: ['task-8'],
      throwIfCancelled: cancellation,
    })
  })

  it('reads persisted results by the actual reused task IDs', async () => {
    mocks.enqueueTask.mockImplementation(input => task(input, 'owner-run'))
    const { submitFileTasks } = await import('./file-task-command')
    const handle = submitFileTasks([intent('caller-run', 8)])
    mocks.getDownloadTask.mockReturnValue({ ...task(intent('owner-run', 8)), status: 'done' })
    expect(handle.readResults()).toEqual([expect.objectContaining({ id: 'task-8', status: 'done', jobId: 'owner-run' })])
    expect(mocks.getDownloadTask).toHaveBeenCalledWith('task-8')
  })
})
