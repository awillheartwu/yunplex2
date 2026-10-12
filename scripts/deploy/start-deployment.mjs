// Copy the checked-out deployment tools into a short-lived host container.
// Canceling an Actions job can stop its waiter, but cannot stop this upgrade.
import { mkdtemp, mkdir, copyFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { docker, deploymentConfig, composeEnvironment, inspect } from './nas-deploy.mjs'

const execute = promisify(execFile)
const root = fileURLToPath(new URL('../../', import.meta.url))
const WORKER = 'reyunplex-deploy-worker'

export async function startDeployment(config, dependencies = {}) {
  const run = dependencies.docker ?? docker
  const wait = dependencies.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const getAncestors = dependencies.ancestors ?? (async () => (await execute('git', ['rev-list', config.revision], { cwd: root })).stdout)
  for (let attempt = 0; ; attempt++) {
    const previous = await inspect(run, WORKER)
    if (!previous) break
    if (previous.Config?.Labels?.['reyunplex.role'] !== 'deploy-worker') throw new Error('Deployment worker name is occupied by an unmanaged container')
    if (!previous.State.Running) { await run(['rm', previous.Id]); break }
    if (attempt === 120) throw new Error('Previous deployment is still running; inspect the deployment worker')
    await wait(5000)
  }

  const temporary = await mkdtemp(join(tmpdir(), 'reyunplex-deploy-tools-'))
  let id, started = false
  try {
    const workspace = join(temporary, 'workspace')
    await mkdir(join(workspace, 'scripts', 'deploy'), { recursive: true })
    await mkdir(join(workspace, 'deploy'))
    for (const name of ['nas-deploy.mjs', 'host-state.mjs', 'retention.mjs']) {
      await copyFile(join(root, 'scripts', 'deploy', name), join(workspace, 'scripts', 'deploy', name))
    }
    await copyFile(join(root, 'deploy', 'nas.compose.yml'), join(workspace, 'deploy', 'nas.compose.yml'))
    await writeFile(join(workspace, 'ancestors.txt'), await getAncestors(), { mode: 0o600 })
    const environment = {
      ...composeEnvironment(config), REYUNPLEX_REVISION: config.revision,
      REYUNPLEX_ANCESTORS_FILE: '/workspace/ancestors.txt', DOCKER_API_VERSION: '1.43',
    }
    id = await run([
      'create', '--name', WORKER, '--label', 'reyunplex.role=deploy-worker',
      '--network', 'none', '--pids-limit', '128',
      '--user', '0:0', '--tmpfs', '/app/data',
      '--mount', 'type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock',
      ...Object.entries(environment).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
      '--workdir', '/workspace', '--entrypoint', 'node', config.image, 'scripts/deploy/nas-deploy.mjs',
    ])
    await run(['cp', `${workspace}/.`, `${id}:/workspace`])
    await run(['cp', '/usr/local/bin/docker', `${id}:/usr/local/bin/docker`])
    await run(['cp', '/usr/local/lib/docker', `${id}:/usr/local/lib/docker`])
    await run(['start', id])
    started = true
    const code = await run(['wait', id], { timeout: 900_000 })
    const logs = await run(['logs', '--tail', '80', id], { allowFailure: true })
    if (logs) console.log(logs)
    if (code !== '0') throw new Error('Deployment worker failed; inspect its logs and application deployment.json')
    await run(['rm', id])
  } finally {
    // Never force-remove a worker: a start response may be lost after Docker
    // already started it. A canceled waiter leaves its worker for inspection.
    if (id && !started) await run(['rm', id], { allowFailure: true })
    await rm(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await startDeployment(deploymentConfig(process.env)) } catch (error) {
    console.error(error instanceof Error ? error.message : 'Deployment worker failed')
    process.exitCode = 1
  }
}
