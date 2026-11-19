import { Worker } from 'node:worker_threads'
import { createRequire } from 'node:module'

const FLAC_TAG_TIMEOUT_MS = 120000
const MANAGED_FLAC_TAG_FIELDS = [
  'TITLE', 'ALBUMARTIST', 'ALBUM', 'TRACKNUMBER', 'YEAR', 'DATE', 'ARTIST',
  'LENGTH', 'DISCNUMBER', 'DISCTOTAL', 'TOTALTRACKS', 'GENRE', 'DESCRIPTION',
  'PUBLISHER', 'RELEASETYPE',
] as const

// Run the independent reader in the same worker so readback shares its timeout
// and cannot keep reading a stage after cancellation releases the writer slot.
const tagReadbackCode = `
  async function verifyWrittenTags(fileType) {
    const { parseFile } = await import(pathToFileURL(workerData.metadataModulePath).href);
    const { filePath, imageBuffer } = workerData;
    const result = await parseFile(filePath, {
      duration: false, skipPostHeaders: true, skipCovers: !imageBuffer,
    });
    const fail = (field) => { throw new Error('标签回读核验失败: ' + field); };
    if (fileType === 'flac') {
      if (result.format.container !== 'FLAC') fail('FLAC 容器');
      if (workerData.writeMetadata) {
        const tags = result.native.vorbis || [];
        for (const key of workerData.managedFields) {
          const actual = tags.filter(tag => tag.id.toUpperCase() === key).map(tag => tag.value);
          const expected = workerData.tagMap[key];
          if (expected === undefined ? actual.length !== 0 : actual.length !== 1 || actual[0] !== expected) fail(key);
        }
      }
    } else {
      const tags = workerData.tags;
      const frames = result.native['ID3v2.3'] || [];
      for (const [key, frame] of Object.entries({ title: 'TIT2', artist: 'TPE1', album: 'TALB', performerInfo: 'TPE2', trackNumber: 'TRCK' })) {
        if (!tags[key]) continue;
        const actual = frames.filter(tag => tag.id === frame).map(tag => tag.value);
        // node-id3 emits ID3v2.3; its artist slash is read as a value separator.
        // Compare native values rather than the common artist or numeric track,
        // which discard additional artists and turn an unknown track 0 into null.
        const expected = key === 'artist' ? tags[key].split('/').map(value => value.trim()) : [tags[key]];
        if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(key);
      }
    }
    if (imageBuffer) {
      const front = (result.common.picture || []).filter(pic => pic.type === 'Cover (front)');
      if (front.length !== 1 || !Buffer.from(front[0].data).equals(Buffer.from(imageBuffer))) fail('正面封面');
    }
  }
`

function runWorkerWithTimeout(
  workerCode: string,
  payload: Record<string, unknown>,
  label: string,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerCode, {
      eval: true,
      workerData: payload,
    })

    let settled = false
    const timeout = setTimeout(() => {
      finish(new Error(`${label} 超时（>${Math.floor(FLAC_TAG_TIMEOUT_MS / 1000)}s）`))
    }, FLAC_TAG_TIMEOUT_MS)

    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      // The tag slot and working file remain owned until the thread stops.
      // Otherwise an abort can overlap the next writer or race file cleanup.
      void worker.terminate().then(() => error ? reject(error) : resolve(), reject)
    }
    const abort = () => {
      finish(signal?.reason instanceof Error ? signal.reason : new Error(`${label} 已取消`))
    }
    if (signal?.aborted) {
      abort()
      return
    }
    signal?.addEventListener('abort', abort, { once: true })

    worker.once('message', (msg: { ok?: boolean; error?: string; code?: string }) => {
      finish(msg?.ok ? undefined : Object.assign(new Error(msg?.error || `${label} 失败`), { code: msg?.code }))
    })

    worker.once('error', (err) => {
      finish(err)
    })

    worker.once('exit', (code) => {
      if (settled) return
      finish(new Error(`${label} worker 未返回写入结果（code=${code}）`))
    })
  })
}

export function runFlacTagWorkerInline(payload: {
  filePath: string
  tagMap: Record<string, string>
  imageBuffer: Buffer | null
  writeMetadata: boolean
}, signal?: AbortSignal): Promise<void> {
  const r = 'requir' + 'e' // evade bundler static analysis
  const workerCode = `
    const { parentPort, workerData } = ${r}('node:worker_threads');
    const { pathToFileURL } = ${r}('node:url');
    const fs = ${r}('node:fs');
    const { dirname } = ${r}('node:path');
    let requiredRewriteBytes = 0;
    ${tagReadbackCode}

    // Normalize only the private working copy, with bounded memory even for a
    // large ID3 prefix. libFLAC otherwise retains that prefix and stale fields.
    function stripLeadingId3(filePath) {
      const fd = fs.openSync(filePath, 'r+');
      try {
        const header = Buffer.alloc(10);
        const size = fs.fstatSync(fd).size;
        const read = fs.readSync(fd, header, 0, 10, 0);
        if (header.subarray(0, 3).toString('ascii') !== 'ID3') return;
        if (read !== 10 || header.subarray(6).some(value => value & 0x80)) throw new Error('Invalid ID3v2 header before FLAC stream');
        const payloadSize = [...header.subarray(6)].reduce((total, value) => (total << 7) | value, 0);
        const offset = 10 + payloadSize + (header[5] & 0x10 ? 10 : 0);
        const magic = Buffer.alloc(4);
        if (offset + 4 > size || fs.readSync(fd, magic, 0, 4, offset) !== 4 || magic.toString('ascii') !== 'fLaC') throw new Error('FLAC 文件头无效');
        const buffer = Buffer.alloc(1024 * 1024);
        for (let position = offset; position < size;) {
          const length = fs.readSync(fd, buffer, 0, Math.min(buffer.length, size - position), position);
          if (!length) throw Object.assign(new Error('FLAC prefix read failed'), { code: 'EIO' });
          for (let written = 0; written < length;) {
            const count = fs.writeSync(fd, buffer, written, length - written, position - offset + written);
            if (!count) throw Object.assign(new Error('FLAC prefix write failed'), { code: 'EIO' });
            written += count;
          }
          position += length;
        }
        fs.ftruncateSync(fd, size - offset);
      } finally { fs.closeSync(fd); }
    }

    (async () => { try {
      const { Chain, metadata, format } = await import(pathToFileURL(workerData.modulePath).href);
      const { filePath, tagMap, imageBuffer, writeMetadata } = workerData;
      stripLeadingId3(filePath);
      const chain = new Chain();
      // Synchronous native I/O stays inside this worker. Termination cannot
      // release the stage while detached native async writes are still active.
      chain.read(filePath);
      const oldMetadataBytes = [...chain.createIterator()].reduce((total, block) => total + 4 + block.length, 0);
      const iterator = chain.createIterator();
      const must = ok => { if (!ok) throw new Error('FLAC 元数据更新失败'); };
      const updateComments = block => {
        for (const field of workerData.managedFields) {
          if (block.removeEntriesMatching(field) < 0) throw new Error('FLAC 标签清理失败');
        }
        for (const [key, value] of Object.entries(tagMap)) must(block.appendComment(key + '=' + value));
      };
      let hasComments = false;
      do {
        const block = iterator.getBlock();
        if (block.type === format.MetadataType.VORBIS_COMMENT) {
          hasComments = true;
          if (writeMetadata) updateComments(block);
        }
        if (imageBuffer && block.type === format.MetadataType.PICTURE && block.pictureType === 3) must(iterator.deleteBlock(false));
      } while (iterator.next());
      if (writeMetadata && !hasComments) {
        const comments = new metadata.VorbisCommentMetadata();
        updateComments(comments);
        must(iterator.insertBlockAfter(comments));
      }
      if (imageBuffer) {
        const { imageSize } = await import(pathToFileURL(workerData.imageSizeModulePath).href);
        const dimensions = imageSize(imageBuffer);
        if (!['jpg', 'png'].includes(dimensions.type)) throw new Error('封面仅支持 JPEG 或 PNG');
        const picture = new metadata.PictureMetadata();
        picture.pictureType = 3;
        picture.mimeType = dimensions.type === 'png' ? 'image/png' : 'image/jpeg';
        picture.description = '';
        picture.width = dimensions.width;
        picture.height = dimensions.height;
        picture.depth = 24;
        picture.colors = 0;
        picture.data = Buffer.from(imageBuffer);
        const problem = picture.isLegal();
        if (problem) throw new Error('FLAC 封面无效: ' + problem);
        must(iterator.insertBlockAfter(picture));
      }
      if (chain.checkIfTempFileIsNeeded(true)) {
        const newMetadataBytes = [...chain.createIterator()].reduce((total, block) => total + 4 + block.length, 0);
        requiredRewriteBytes = fs.statSync(filePath).size - oldMetadataBytes + newMetadataBytes;
        const space = fs.statfsSync(dirname(filePath));
        if (space.bavail * space.bsize < requiredRewriteBytes) throw Object.assign(new Error('磁盘空间不足，无法重写 FLAC 标签'), { code: 'ENOSPC' });
      }
      chain.write(true, false);
      await verifyWrittenTags('flac');
      parentPort.postMessage({ ok: true });
    } catch (error) {
      // Native chain errors expose a FLAC status rather than Node's errno.
      // Keep filesystem failures visible to the queue's pause/retry policy.
      const status = String(error?.statusString || '');
      if (status.includes('NOT_WRITABLE')) error.code = 'EACCES';
      else if (/READ_ERROR|WRITE_ERROR|RENAME_ERROR|UNLINK_ERROR/.test(status)) {
        error.code = 'EIO';
        if (!status.includes('READ_ERROR')) {
          try {
            fs.accessSync(dirname(workerData.filePath), fs.constants.W_OK);
            const space = fs.statfsSync(dirname(workerData.filePath));
            if (space.bavail === 0 || space.bavail * space.bsize < requiredRewriteBytes) error.code = 'ENOSPC';
          } catch (fsError) { error.code = fsError.code || error.code; }
        }
      } else if (/BAD_METADATA|NOT_A_FLAC_FILE/.test(status)) error.code = 'INVALID_AUDIO';
      parentPort.postMessage({
        ok: false,
        error: error instanceof Error ? error.message : 'FLAC tag write failed',
        code: typeof error?.code === 'string' ? error.code : undefined,
      });
    } })();
  `

  return runWorkerWithTimeout(workerCode, {
    ...payload,
    managedFields: MANAGED_FLAC_TAG_FIELDS,
    modulePath: createRequire(import.meta.url).resolve('flac-bindings/api'),
    imageSizeModulePath: createRequire(import.meta.url).resolve('image-size'),
    metadataModulePath: createRequire(import.meta.url).resolve('music-metadata'),
  }, 'FLAC 标签写入', signal)
}

export function runMp3TagWorkerInline(payload: {
  filePath: string
  tags: Record<string, unknown>
  imageBuffer: Buffer | null
}, signal?: AbortSignal): Promise<void> {
  const r = 'requir' + 'e' // evade bundler static analysis
  const workerCode = `
    const { parentPort, workerData } = ${r}('node:worker_threads');
    const { pathToFileURL } = ${r}('node:url');
    const NodeID3 = ${r}(workerData.modulePath);
    ${tagReadbackCode}

    (async () => {
      try {
        const { filePath, tags, imageBuffer } = workerData;
        if (tags.image && imageBuffer) {
          tags.image.imageBuffer = Buffer.from(imageBuffer);
        }
        await NodeID3.Promise.update(tags, filePath);
        await verifyWrittenTags('mp3');
        parentPort.postMessage({ ok: true });
      } catch (error) {
        parentPort.postMessage({
          ok: false,
          error: error instanceof Error ? error.message : 'MP3 tag write failed',
          code: typeof error?.code === 'string' ? error.code : undefined,
        });
      }
    })();
  `

  return runWorkerWithTimeout(workerCode, {
    ...payload,
    modulePath: createRequire(import.meta.url).resolve('node-id3'),
    metadataModulePath: createRequire(import.meta.url).resolve('music-metadata'),
  }, 'MP3 标签写入', signal)
}
