export const DEPLOYMENT_LOCK = 'reyunplex-deploy-lock'
export const DEPLOYMENT_TOOL_IMAGE = 'node:24-alpine'

const fields = '{"Id":{{json .Id}},"Name":{{json .Name}},"Labels":{{json .Config.Labels}}}'

export async function assertDeploymentLock(run, revision, id) {
  if (!/^[a-f0-9]{64}$/.test(id ?? '')) throw new Error('A full deployment lock container ID is required')
  const raw = await run(['container', 'inspect', DEPLOYMENT_LOCK, '--format', fields], { allowFailure: true })
  const lock = raw === null ? null : JSON.parse(raw)
  if (lock?.Id !== id || lock.Name !== `/${DEPLOYMENT_LOCK}`
    || lock.Labels?.['reyunplex.role'] !== 'deploy-lock'
    || lock.Labels?.['reyunplex.revision'] !== revision) {
    throw new Error('Deployment lock ownership changed; refusing cleanup or release')
  }
}

export async function acquireDeploymentLock(run, revision) {
  const available = await run(['image', 'inspect', DEPLOYMENT_TOOL_IMAGE, '--format', '{{.Id}}'], { allowFailure: true })
  if (available === null) await run(['pull', DEPLOYMENT_TOOL_IMAGE], { timeout: 300_000 })
  const id = await run(['create', '--name', DEPLOYMENT_LOCK, '--network', 'none', '--tmpfs', '/app/data',
    '--label', 'reyunplex.role=deploy-lock', '--label', `reyunplex.revision=${revision}`,
    '--entrypoint', 'node', DEPLOYMENT_TOOL_IMAGE, '-e', 'process.exit(0)'])
  await assertDeploymentLock(run, revision, id)
  return id
}

export async function releaseDeploymentLock(run, revision, id) {
  await assertDeploymentLock(run, revision, id)
  await run(['rm', id])
}
