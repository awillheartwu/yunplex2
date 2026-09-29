import { backup, restore, verify } from './bundle.mjs'
import { readFile } from 'node:fs/promises'
const [command, dataDir, bundleDir] = process.argv.slice(2)
process.umask(0o077)
try {
  if (command === 'backup') {
    const version = JSON.parse(await readFile('/app/release.json', 'utf8')).version
    console.log(await backup(dataDir, bundleDir, version))
  } else if (command === 'verify') {
    const manifest = await verify(bundleDir)
    console.log(JSON.stringify({ valid: true, appVersion: manifest.appVersion, databaseVersion: manifest.databaseVersion, files: manifest.files.length }))
  } else if (command === 'restore') console.log(`Previous data retained: ${await restore(bundleDir, dataDir)}`)
  else throw new Error('Expected backup, verify or restore')
} catch (error) { console.error(`Maintenance failed: ${error instanceof Error ? error.message : 'unknown error'}`); process.exitCode = 1 }
