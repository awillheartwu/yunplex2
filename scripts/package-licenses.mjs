import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

/** Preserve upstream notices without rewriting their terms or attribution. */
export function packageLicenses(root) {
  const output = join(root, '.output/licenses/npm')
  const store = join(root, 'node_modules/.pnpm')
  const runtime = JSON.parse(readFileSync(join(root, '.output/server/package.json'), 'utf8')).dependencies ?? {}
  const upstreamRoot = join(root, 'licenses/upstream')
  const upstream = existsSync(join(upstreamRoot, 'sources.json'))
    ? JSON.parse(readFileSync(join(upstreamRoot, 'sources.json'), 'utf8')) : []
  const packages = new Map()
  const seen = new Set()
  rmSync(output, { recursive: true, force: true })
  mkdirSync(output, { recursive: true })
  for (const entry of readdirSync(store)) {
    const modules = join(store, entry, 'node_modules')
    if (!existsSync(modules)) continue
    for (const name of readdirSync(modules)) {
      if (name.startsWith('.')) continue
      const names = name.startsWith('@')
        ? readdirSync(join(modules, name)).map(child => `${name}/${child}`) : [name]
      for (const child of names) {
        const manifest = join(modules, child, 'package.json')
        if (!existsSync(manifest)) continue
        const directory = dirname(realpathSync(manifest))
        if (seen.has(directory)) continue
        seen.add(directory)
        const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
        const key = `${pkg.name}@${pkg.version}`
        if (packages.has(key)) continue
        const notices = readdirSync(directory, { withFileTypes: true })
          .filter(file => file.isFile() && /^(?:licen[cs]e|copying|notice)(?:$|[._-])/i.test(file.name))
          .map(file => file.name).sort()
        const target = join(output, encodeURIComponent(key))
        if (notices.length) {
          mkdirSync(target, { recursive: true })
          for (const notice of notices) cpSync(join(directory, notice), join(target, notice))
        }
        const supplement = !notices.length && upstream.find(entry => entry.version === pkg.version
          && (entry.package === pkg.name || (entry.packagePrefix && pkg.name.startsWith(entry.packagePrefix))))
        if (supplement) {
          mkdirSync(target, { recursive: true })
          for (const file of supplement.files) {
            const source = join(upstreamRoot, file.file)
            if (createHash('sha256').update(readFileSync(source)).digest('hex') !== file.sha256) {
              throw new Error(`Upstream notice checksum mismatch for ${key}`)
            }
            cpSync(source, join(target, file.file))
            notices.push(file.file)
          }
        }
        packages.set(key, { name: pkg.name, version: pkg.version, license: pkg.license ?? null,
          notices, ...(supplement ? { upstream: supplement.files } : {}), runtime: runtime[pkg.name] === pkg.version })
      }
    }
  }
  const entries = [...packages.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`))
  const missingRuntimeNotices = Object.entries(runtime)
    .filter(([name, version]) => !packages.get(`${name}@${version}`)?.notices.length)
    .map(([name, version]) => ({ name, version }))
  const result = { packages: entries, missingRuntimeNotices }
  writeFileSync(join(output, 'index.json'), `${JSON.stringify(result, null, 2)}\n`)
  return result
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = packageLicenses(fileURLToPath(new URL('../', import.meta.url)))
  console.log(`Preserved notices for ${result.packages.filter(pkg => pkg.notices.length).length} dependency versions`)
  if (result.missingRuntimeNotices.length) console.warn(`Upstream notice files missing for ${result.missingRuntimeNotices.length} runtime packages; see .output/licenses/npm/index.json before public distribution`)
}
