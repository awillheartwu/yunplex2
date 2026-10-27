// One lock covers builds, disposable-volume validation and worker handoff.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { docker, deploymentConfig } from './nas-deploy.mjs'
import { acquireDeploymentLock } from './deployment-lock.mjs'
import { startDeployment } from './start-deployment.mjs'
import { collectImagesAndReleaseLock, ImageCleanupError } from './retention.mjs'

const execute = promisify(execFile)
const root = fileURLToPath(new URL('../../', import.meta.url))

export async function buildAndDeploy(config, dependencies = {}) {
  const run = dependencies.docker ?? docker
  const start = dependencies.startDeployment ?? startDeployment
  const smoke = dependencies.smoke ?? (async () => {
    const { stdout, stderr } = await execute('sh', ['tests/acceptance/docker-smoke.sh', config.image], {
      cwd: root, env: { ...process.env, NASUID: `${config.uid}:${config.gid}` },
      timeout: 900_000, maxBuffer: 8 * 1024 * 1024,
    })
    process.stdout.write(stdout)
    process.stderr.write(stderr)
  })
  const checkInterrupted = () => { if (dependencies.interrupted?.()) throw new Error('Build/deployment interrupted') }
  const lockId = await acquireDeploymentLock(run, config.revision)
  let handedOff = false, operationFailed = false
  try {
    checkInterrupted()
    const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
    await run(['build', '--force-rm', '--target', 'dependencies', '-t', 'reyunplex:build-deps', '.'], { timeout: 1_200_000, log: true })
    checkInterrupted()
    if (await run(['image', 'inspect', config.image, '--format', '{{.Id}}'], { allowFailure: true }) === null) {
      await run(['build', '--force-rm', '--build-arg', `REYUNPLEX_REVISION=${config.revision}`,
        '--build-arg', `REYUNPLEX_VERSION=${manifest.version}`, '--build-arg', `REYUNPLEX_SOURCE=${manifest.repository.url}`,
        '--label', `org.opencontainers.image.revision=${config.revision}`, '-t', config.image, '.'], { timeout: 1_200_000, log: true })
    }
    checkInterrupted()
    const bytes = Number(await run(['image', 'inspect', config.image, '--format', '{{.Size}}']))
    console.log(`Image size: ${bytes} bytes (limit: 256 MiB)`)
    if (!Number.isFinite(bytes) || bytes <= 0 || bytes > 268_435_456) throw new Error('Image exceeds the 256 MiB size limit or has no valid size')
    await smoke()
    checkInterrupted()
    await start({ ...config, lockId }, {
      docker: run,
      onHandoff: () => { handedOff = true },
      onHandoffAborted: () => { handedOff = false },
    })
  } catch (error) {
    operationFailed = true
    throw error
  } finally {
    if (!handedOff) {
      await collectImagesAndReleaseLock(run, { revision: config.revision, lockId }, { operationFailed })
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let interrupted = false
  process.on('SIGINT', () => { interrupted = true })
  process.on('SIGTERM', () => { interrupted = true })
  try { await buildAndDeploy(deploymentConfig(process.env), { interrupted: () => interrupted }) } catch (error) {
    console.error(error instanceof ImageCleanupError ? error.message : `Build/deployment failed: ${error.message}`)
    process.exitCode = error instanceof ImageCleanupError ? 2 : 1
  }
}
