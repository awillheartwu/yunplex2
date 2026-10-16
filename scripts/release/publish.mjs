import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { git, packageAt, stableVersion, taggedRevision } from './git.mjs'
import { registry, compareVersions } from './registry.mjs'

const execute = promisify(execFile)
const lockName = 'reyunplex-publish-lock'

export async function publish(env = process.env) {
  const { RELEASE_TAG: tag, GHCR_IMAGE: destination, GHCR_USERNAME: username, GHCR_TOKEN: password, NAS_APP_ROOT: appRoot } = env
  const revision = taggedRevision(tag ?? '')
  const { version } = packageAt(revision)
  if (tag !== `v${version}`) throw new Error('Release tag does not match package.json at that commit')
  if (git('branch', '--show-current') !== 'main') throw new Error('Dispatch publication from main')
  git('merge-base', '--is-ancestor', revision, 'HEAD')
  if (!/^ghcr\.io\/[a-z0-9][a-z0-9-]*\/[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(destination ?? '')) {
    throw new Error('Set GHCR_IMAGE to a lowercase ghcr.io/owner/image without a tag')
  }
  if (!username || !password) throw new Error('Set GHCR_USERNAME and GHCR_TOKEN in Forgejo secrets')
  if (!/^\/volume\d+\/docker\/reyunplex$/.test(appRoot ?? '')) throw new Error('Set the existing NAS_APP_ROOT deployment variable')
  if (!['true', 'false'].includes(env.GHCR_UPDATE_LATEST)) throw new Error('GHCR_UPDATE_LATEST must be true or false')
  const updateLatest = env.GHCR_UPDATE_LATEST === 'true'
  const image = `reyunplex:${revision}`
  const authDir = await mkdtemp(join(tmpdir(), 'yunplex-ghcr-'))
  const dockerEnv = { ...process.env, DOCKER_CONFIG: authDir }
  delete dockerEnv.GHCR_TOKEN
  const aliases = []
  let lockId
  async function docker(args, { input, allowMissing = false } = {}) {
    try {
      const pending = execute('docker', args, { env: dockerEnv, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 600_000 })
      pending.child.stdin.end(input)
      return (await pending).stdout.trim()
    } catch (error) {
      if (allowMissing && /No such (?:image|container|object)/i.test(String(error.stderr))) return null
      // Never forward authentication output or inherited credential values.
      throw new Error(`Docker ${args[0]} failed (${error.code ?? 'interrupted'}); inspect daemon connectivity and registry permissions`, { cause: error })
    }
  }
  async function inspect(kind, name) {
    const result = await docker([kind, 'inspect', name], { allowMissing: true })
    return result === null ? null : JSON.parse(result)[0]
  }
  const client = registry(destination, username, password)
  try {
    const info = JSON.parse(await docker(['info', '--format', '{{json .}}']))
    if (info.OSType !== 'linux' || !['amd64', 'x86_64'].includes(info.Architecture)) throw new Error('Publication requires the existing amd64 NAS Docker daemon')
    const candidate = await inspect('image', image)
    if (!candidate) throw new Error('Accepted local image is missing. Rebuild and accept it separately; publication never rebuilds')
    const labels = candidate.Config?.Labels ?? {}
    if (candidate.Os !== 'linux' || candidate.Architecture !== 'amd64' || labels['org.opencontainers.image.revision'] !== revision || labels['org.opencontainers.image.version'] !== version) {
      throw new Error('Image architecture, revision or version does not match the release')
    }
    lockId = await docker(['create', '--name', lockName, '--label', 'reyunplex.role=publish-lock', '--network', 'none', '--tmpfs', '/app/data', '--entrypoint', 'node', candidate.Id, '-e', 'process.exit(0)'])
    async function requireAcceptedDeployment() {
      const deploying = await inspect('container', 'reyunplex-deploy-lock')
      if (deploying) throw new Error('NAS deployment is in progress; confirm it before publishing')
      const running = await inspect('container', 'reyunplex')
      if (!running?.State.Running || running.Image !== candidate.Id || running.Config?.Labels?.['com.docker.compose.project'] !== 'reyunplex') {
        throw new Error('The release image must be the running managed NAS deployment')
      }
      const state = JSON.parse(await docker([
        'run', '--rm', '--network', 'none', '--read-only', '--user', '0:0', '--tmpfs', '/app/data',
        '--mount', `type=bind,source=${appRoot}/deployment.json,target=/deployment.json,readonly`,
        '--entrypoint', 'node', candidate.Id, '-e', "process.stdout.write(require('node:fs').readFileSync('/deployment.json','utf8'))",
      ]))
      if (state.status !== 'ready' || state.revision !== revision || state.image !== image) throw new Error('NAS deployment record is not ready for this release')
      const probe = JSON.parse(await docker(['exec', 'reyunplex', 'node', '-e', "Promise.all([fetch('http://127.0.0.1:3000/api/system/ready',{signal:AbortSignal.timeout(5000)}).then(r=>{if(!r.ok)throw Error();return r.json()}),Promise.resolve(require('/app/release.json').version)]).then(([ready,version])=>console.log(JSON.stringify({ready:ready.code===0&&ready.data?.ready===true,version}))).catch(()=>process.exit(1))"]))
      if (!probe.ready || probe.version !== version) throw new Error('Running image version or application readiness did not match')
    }
    await requireAcceptedDeployment()
    const fixedTags = [`sha-${revision}`, version]
    // Check both immutable destinations before the first registry write.
    for (const name of fixedTags) {
      const existing = await client.manifest(name)
      if (existing && existing.imageId !== candidate.Id) throw new Error(`GHCR ${name} already contains different content; refusing to replace it`)
    }
    async function requireLatestNotNewer() {
      const latest = await client.manifest('latest')
      if (!latest) return
      const previousVersion = await client.version(latest)
      if (!stableVersion.test(previousVersion ?? '')) throw new Error('Existing latest has no stable version; inspect it before promotion')
      if (compareVersions(previousVersion, version) > 0) throw new Error('Refusing to move latest to an older version; retry with update_latest=false')
      if (previousVersion === version && latest.imageId !== candidate.Id) throw new Error('Existing latest uses different content for this version')
    }
    if (updateLatest) await requireLatestNotNewer()
    await docker(['login', 'ghcr.io', '--username', username, '--password-stdin'], { input: `${password}\n` })
    async function push(name, immutable) {
      const existing = await client.manifest(name)
      if (existing?.imageId === candidate.Id) return existing
      if (immutable && existing) throw new Error(`GHCR ${name} changed during publication; refusing to replace it`)
      const alias = `${destination}:${name}`
      const local = await inspect('image', alias)
      if (local && local.Id !== candidate.Id) throw new Error(`Local ${alias} belongs to another image; preserve or remove it explicitly`)
      if (!local) {
        await docker(['tag', candidate.Id, alias])
        aliases.push(alias)
      }
      await docker(['push', alias])
      const result = await client.manifest(name)
      if (result?.imageId !== candidate.Id) throw new Error(`GHCR ${name} did not resolve to the accepted image after push`)
      return result
    }
    const sha = await push(fixedTags[0], true)
    const release = await push(version, true)
    if (sha.digest !== release.digest) throw new Error('Version and SHA tags have different remote manifest digests')
    if (updateLatest) {
      await requireAcceptedDeployment()
      await requireLatestNotNewer()
      const latest = await push('latest', false)
      if (latest.digest !== release.digest) throw new Error('Latest digest does not match the fixed release')
    }
    console.log(`Published ${destination}:${version} (${release.digest}); platform linux/amd64; latest ${updateLatest ? 'promoted' : 'unchanged'}.`)
    console.log('Confirm package visibility is public, then verify an anonymous pull before announcing distribution.')
  } finally {
    for (const alias of aliases) await docker(['image', 'rm', alias]).catch(() => { console.error('Temporary GHCR image tag cleanup failed') })
    if (lockId) await docker(['container', 'rm', lockId]).catch(() => { console.error(`Publication lock remains: inspect ${lockName} before retrying`) })
    await rm(authDir, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await publish() } catch (error) {
    console.error(error instanceof Error ? error.message : 'Publication failed')
    process.exitCode = 1
  }
}
