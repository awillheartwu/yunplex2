import { Worker } from 'node:worker_threads'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Accept a base64 fixture when this script is piped into an isolated container.
const runtime = resolve(process.argv[2] || '.output/server')
const runtimeRequire = createRequire(join(runtime, 'package.json'))
const fixture = process.argv[3]
  ? Buffer.from(process.argv[3], 'base64')
  : await readFile(new URL('../fixtures/silence.flac', import.meta.url))
const dir = await mkdtemp(join(tmpdir(), 'yunplex-tag-runtime-'))
let worker
try {
  const filePath = join(dir, 'song.flac.part-smoke')
  await writeFile(filePath, fixture)
  worker = new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    const { pathToFileURL } = require('node:url');
    (async () => {
      const { Chain, metadata } = await import(pathToFileURL(workerData.flac).href);
      const { parseFile } = await import(pathToFileURL(workerData.reader).href);
      const { imageSize } = await import(pathToFileURL(workerData.images).href);
      if (typeof imageSize !== 'function' || typeof require(workerData.mp3).update !== 'function') throw new Error('Tag runtime dependencies missing');
      const chain = new Chain();
      chain.read(workerData.filePath);
      const iterator = chain.createIterator();
      while (iterator.next()) {}
      const comments = new metadata.VorbisCommentMetadata();
      if (!comments.appendComment('TITLE=容器标签核验') || !iterator.insertBlockAfter(comments)) throw new Error('Native metadata update failed');
      chain.write(true, false);
      const result = await parseFile(workerData.filePath, { duration: false, skipPostHeaders: true });
      if (result.format.container !== 'FLAC' || result.common.title !== '容器标签核验') throw new Error('Tag readback failed');
      parentPort.postMessage('FLAC native worker + metadata reader OK');
    })().catch(error => { throw error; });
  `, {
    eval: true,
    workerData: {
      filePath, flac: runtimeRequire.resolve('flac-bindings/api'),
      reader: runtimeRequire.resolve('music-metadata'), images: runtimeRequire.resolve('image-size'),
      mp3: runtimeRequire.resolve('node-id3'),
    },
  })
  const result = await new Promise((resolveResult, reject) => {
    const timeout = setTimeout(() => reject(new Error('Tag runtime smoke timed out')), 30000)
    worker.once('message', value => { clearTimeout(timeout); resolveResult(value) })
    worker.once('error', error => { clearTimeout(timeout); reject(error) })
    worker.once('exit', code => { clearTimeout(timeout); reject(new Error('Worker exited without a result: ' + code)) })
  })
  console.log(result)
} finally {
  await worker?.terminate()
  await rm(dir, { recursive: true, force: true })
}
