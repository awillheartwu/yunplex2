import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createJiti } from 'jiti'
import { parseFile } from 'music-metadata'

const tags = {
  TITLE: '对照测试 🎵', ALBUMARTIST: 'Album Artist', ARTIST: '艺人甲 / Artist B',
  ALBUM: 'Comparison', TRACKNUMBER: '2', YEAR: '2024', DATE: '2024-03-04',
  LENGTH: '3:45', DISCNUMBER: '2/3', DISCTOTAL: '3', TOTALTRACKS: '12',
  GENRE: 'Rock', DESCRIPTION: '第一行\n第二行', PUBLISHER: '独立厂牌', RELEASETYPE: 'Album',
}

async function audioHash(path) {
  const file = await open(path, 'r')
  let offset = 4
  try {
    for (;;) {
      const header = Buffer.alloc(4)
      const { bytesRead } = await file.read(header, 0, 4, offset)
      if (bytesRead !== 4) throw new Error('Truncated FLAC metadata')
      offset += 4 + header.readUIntBE(1, 3)
      if (header[0] & 128) break
    }
  } finally { await file.close() }
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path, { start: offset })) hash.update(chunk)
  return hash.digest('hex')
}

async function child([engine, workerPath, input]) {
  const dir = await mkdtemp(join(tmpdir(), 'yunplex-flac-compare-'))
  try {
    const path = join(dir, 'song.flac.part-comparison')
    await copyFile(input, path)
    const beforeHash = await audioHash(path)
    const jiti = createJiti(import.meta.url)
    const { runFlacTagWorkerInline } = await jiti.import(workerPath)
    const imageBuffer = await readFile(new URL('../fixtures/cover.jpg', import.meta.url))
    const baselineRSS = process.resourceUsage().maxRSS
    const started = performance.now()
    await runFlacTagWorkerInline({ filePath: path, tagMap: tags, imageBuffer, writeMetadata: true })
    const ms = performance.now() - started
    // Capture the writer peak before the independent comparison checks below.
    const peakRSS = process.resourceUsage().maxRSS
    const metadata = await parseFile(path, { duration: false, skipPostHeaders: true })
    for (const [key, value] of Object.entries(tags)) {
      const actual = (metadata.native.vorbis ?? []).filter(tag => tag.id === key).map(tag => tag.value)
      if (actual.length !== 1 || actual[0] !== value) throw new Error('Tag mismatch: ' + key)
    }
    const pictures = (metadata.common.picture ?? []).filter(pic => pic.type === 'Cover (front)')
    if (pictures.length !== 1 || !Buffer.from(pictures[0].data).equals(imageBuffer)) throw new Error('Cover mismatch')
    if (await audioHash(path) !== beforeHash) throw new Error('Encoded audio changed')
    if ((await readdir(dir)).length !== 1) throw new Error('Writer left temporary files')
    console.log(JSON.stringify({ engine, ms, peakRSSMiB: peakRSS / 1024, addedRSSMiB: (peakRSS - baselineRSS) / 1024 }))
  } finally { await rm(dir, { recursive: true, force: true }) }
}

function runChild(engine, workerPath, input) {
  return new Promise((resolveResult, reject) => {
    const processChild = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child', engine, workerPath, input], { stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    let errors = ''
    processChild.stdout.on('data', chunk => { output += chunk })
    processChild.stderr.on('data', chunk => { errors += chunk })
    processChild.once('error', reject)
    processChild.once('close', code => {
      if (code !== 0) reject(new Error(engine + ' failed: ' + errors))
      else { try { resolveResult(JSON.parse(output.trim())) } catch (error) { reject(error) } }
    })
  })
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

async function compare([legacyWorker, inputDir, roundsText = '3', reportPath]) {
  if (!legacyWorker || !inputDir) throw new Error('Usage: node tests/acceptance/compare-flac-writers.mjs <legacy-worker.ts> <FLAC-directory> [rounds] [report.json]')
  const rounds = Number(roundsText)
  if (!Number.isSafeInteger(rounds) || rounds < 1) throw new Error('rounds must be a positive integer')
  const currentWorker = fileURLToPath(new URL('../../server/lib/tag-writer-worker.ts', import.meta.url))
  const files = (await readdir(inputDir, { withFileTypes: true })).filter(file => file.isFile() && file.name.endsWith('.flac')).sort((a, b) => a.name.localeCompare(b.name))
  if (!files.length) throw new Error('No FLAC input files')
  const results = []
  for (const [index, file] of files.entries()) {
    const input = resolve(inputDir, file.name)
    const bytes = (await stat(input)).size
    for (let round = 0; round < rounds; round++) {
      const engines = [['metaflac-js-patched', resolve(legacyWorker)], ['flac-bindings', currentWorker]]
      if ((index + round) % 2) engines.reverse()
      for (const [engine, path] of engines) {
        results.push({ sample: index + 1, bytes, round: round + 1, ...await runChild(engine, path, input) })
      }
    }
    console.error('Compared sample ' + (index + 1) + '/' + files.length)
  }
  const summary = Object.fromEntries(['metaflac-js-patched', 'flac-bindings'].map(engine => {
    const rows = results.filter(row => row.engine === engine)
    return [engine, {
      passed: rows.length, medianMs: median(rows.map(row => row.ms)),
      medianPeakRSSMiB: median(rows.map(row => row.peakRSSMiB)),
      maxPeakRSSMiB: Math.max(...rows.map(row => row.peakRSSMiB)),
      medianAddedRSSMiB: median(rows.map(row => row.addedRSSMiB)),
    }]
  }))
  const report = {
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    notes: 'Fresh child process per operation; alternate engine order. Timed work includes worker startup, write, and (new writer only) readback. Source files are copied, never edited. Checks compare all managed tags, front-cover bytes and encoded-audio SHA-256. RSS is process-wide peak, including the worker.',
    summary, results,
  }
  if (reportPath) await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(summary, null, 2))
}

if (process.argv[2] === '--child') await child(process.argv.slice(3))
else await compare(process.argv.slice(2))
