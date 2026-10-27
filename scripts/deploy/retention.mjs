import { assertDeploymentLock, releaseDeploymentLock } from './deployment-lock.mjs'

const label = name => `{{if .Config.Labels}}{{json (index .Config.Labels "${name}")}}{{else}}null{{end}}`
const fields = `{"Id":{{json .Id}},"Parent":{{json .Parent}},"RepoTags":{{json .RepoTags}},"BuildCache":${label('reyunplex.build-cache')},"Title":${label('org.opencontainers.image.title')}}`
const owned = image => image.BuildCache === 'true' || image.Title === 'YunPlex'
  || image.RepoTags?.some(tag => tag.startsWith('reyunplex:'))
const shared = image => image.RepoTags?.some(tag => !tag.startsWith('reyunplex:'))

export class ImageCleanupError extends Error {
  name = 'ImageCleanupError'
}

export function reportImageCleanupFailure(error, { ready = false, operationFailed = false } = {}) {
  const message = `${ready ? 'Deployment ready; image cleanup/lock failed' : 'Image cleanup/lock failed'}: ${error.message}`
  if (operationFailed) console.error(message)
  else throw new ImageCleanupError(message, { cause: error })
}

async function readImages(run) {
  const ids = [...new Set((await run(['image', 'ls', '--all', '--quiet', '--no-trunc'])).split(/\s+/).filter(Boolean))]
  if (!ids.length) return []
  const rows = await run(['image', 'inspect', ...ids, '--format', fields])
  return rows.split('\n').filter(Boolean).map(row => JSON.parse(row))
}

/** Only the owner of the build/deploy boundary may collect project images. */
export async function pruneImages(run, { revision, lockId }) {
  await assertDeploymentLock(run, revision, lockId)
  /** @type {{removed: string[], skipped: {id: string, reason: string}[], failed: {id: string, reason: string}[], blockedBy: string[]}} */
  const report = { removed: [], skipped: [], failed: [], blockedBy: [] }
  const builders = (await run(['ps', '-q', '--filter', 'label=reyunplex.build-cache=true'])).split(/\s+/).filter(Boolean)
  const runtime = (await run(['ps', '-q', '--filter', 'label=org.opencontainers.image.title=YunPlex'])).split(/\s+/).filter(Boolean)
  if (runtime.length) {
    const rows = await run(['container', 'inspect', ...runtime, '--format', '{{.Id}} {{index .Config.Labels "com.docker.compose.project"}}'])
    for (const row of rows.split('\n')) {
      const [id, project] = row.trim().split(/\s+/)
      if (id && project !== 'reyunplex') builders.push(id)
    }
  }
  if (builders.length) return { ...report, blockedBy: builders }
  const images = await readImages(run)
  const byId = new Map(images.map(image => [image.Id, image]))
  const containers = (await run(['ps', '-aq'])).split(/\s+/).filter(Boolean)
  const used = containers.length
    ? (await run(['container', 'inspect', ...containers, '--format', '{{.Image}}'])).split(/\s+/).filter(Boolean) : []
  const keep = new Set()
  const protect = (id) => {
    while (id && !keep.has(id)) {
      keep.add(id)
      id = byId.get(id)?.Parent
    }
  }
  for (const id of used) protect(id)
  for (const image of images) {
    if (shared(image) || image.RepoTags?.includes('reyunplex:build-deps')) protect(image.Id)
  }
  const pending = new Map()
  for (const image of images.filter(owned)) {
    if (keep.has(image.Id)) report.skipped.push({ id: image.Id, reason: 'referenced_or_required_ancestor' })
    else pending.set(image.Id, image)
  }
  while (pending.size) {
    const leaves = [...pending.values()].filter(image => ![...pending.values()].some(child => child.Parent === image.Id))
    if (!leaves.length) throw new Error('Unexpected cycle in project image ancestry')
    for (const image of leaves) {
      pending.delete(image.Id)
      if (images.some(child => child.Parent === image.Id && !report.removed.includes(child.Id))) {
        report.skipped.push({ id: image.Id, reason: 'dependent_image' })
        continue
      }
      try {
        await assertDeploymentLock(run, revision, lockId)
        const raw = await run(['image', 'inspect', image.Id, '--format', fields])
        const current = JSON.parse(raw)
        if (!owned(current) || shared(current) || current.RepoTags?.includes('reyunplex:build-deps')) {
          report.skipped.push({ id: image.Id, reason: 'ownership_or_tags_changed' })
          continue
        }
        if (await run(['ps', '-aq', '--filter', `ancestor=${image.Id}`])) {
          report.skipped.push({ id: image.Id, reason: 'container_reference' })
          continue
        }
        const tags = current.RepoTags ?? []
        for (const reference of tags.length ? tags : [image.Id]) await run(['image', 'rm', '--no-prune', reference])
        report.removed.push(image.Id)
      } catch (error) {
        report.failed.push({ id: image.Id, reason: error instanceof Error ? error.message : String(error) })
      }
    }
  }
  return report
}

export function logImageCleanup(report) {
  const summary = { removed: report.removed.length, skipped: report.skipped.length,
    failed: report.failed.length, blockedBy: report.blockedBy, images: report }
  if (report.failed.length || report.blockedBy.length) console.error('Image cleanup:', JSON.stringify(summary))
  else console.log('Image cleanup:', JSON.stringify(summary))
}

export async function collectImagesAndReleaseLock(run, { revision, lockId }, { ready = false, operationFailed = false } = {}) {
  try {
    const report = await pruneImages(run, { revision, lockId })
    logImageCleanup(report)
    if (report.blockedBy.length) throw new Error('Project build or validation container still active; deployment lock retained for manual inspection')
    await releaseDeploymentLock(run, revision, lockId)
    if (report.failed.length) throw new Error(`${report.failed.length} image(s) could not be removed; deployment lock released; see image cleanup report`)
  } catch (error) {
    reportImageCleanupFailure(error, { ready, operationFailed })
  }
}
