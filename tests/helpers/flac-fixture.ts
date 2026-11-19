import { readFileSync } from 'node:fs'

// Generated silence; no downloaded music or external service is needed.
const silence = readFileSync(new URL('../fixtures/silence.flac', import.meta.url))
export const pngCover = readFileSync(new URL('../fixtures/cover.png', import.meta.url))
export const jpegCover = readFileSync(new URL('../fixtures/cover.jpg', import.meta.url))

export interface FlacBlock { type: number; body: Buffer }

export function inspectFlac(bytes: Buffer): { blocks: FlacBlock[]; audio: Buffer } {
  if (bytes.subarray(0, 4).toString('ascii') !== 'fLaC') throw new Error('Fixture must be native FLAC')
  const blocks: FlacBlock[] = []
  let offset = 4
  for (;;) {
    const type = bytes[offset]!
    const length = bytes.readUIntBE(offset + 1, 3)
    if (offset + 4 + length > bytes.length) throw new Error('Truncated fixture')
    blocks.push({ type: type & 127, body: bytes.subarray(offset + 4, offset + 4 + length) })
    offset += 4 + length
    if (type & 128) return { blocks, audio: bytes.subarray(offset) }
  }
}

function uint32(value: number, littleEndian = false): Buffer {
  const result = Buffer.alloc(4)
  if (littleEndian) result.writeUInt32LE(value)
  else result.writeUInt32BE(value)
  return result
}

export function pictureBlock(type: number, data = pngCover, description = '封面说明'): FlacBlock {
  const mime = Buffer.from('image/png')
  const text = Buffer.from(description)
  return { type: 6, body: Buffer.concat([
    uint32(type), uint32(mime.length), mime, uint32(text.length), text,
    uint32(2), uint32(2), uint32(24), uint32(0), uint32(data.length), data,
  ]) }
}

export function makeFlac(options: {
  comments?: string[]
  extra?: FlacBlock[]
  padding?: number
} = {}): Buffer {
  const base = inspectFlac(silence)
  const blocks = [base.blocks[0]!]
  if (options.comments) {
    const vendor = Buffer.from('YunPlex fixture')
    blocks.push({ type: 4, body: Buffer.concat([
      uint32(vendor.length, true), vendor, uint32(options.comments.length, true),
      ...options.comments.flatMap(tag => { const text = Buffer.from(tag); return [uint32(text.length, true), text] }),
    ]) })
  }
  blocks.push(...options.extra ?? [])
  if (options.padding !== undefined) blocks.push({ type: 1, body: Buffer.alloc(options.padding) })
  return Buffer.concat([Buffer.from('fLaC'), ...blocks.flatMap((block, index) => {
    const header = Buffer.alloc(4)
    header[0] = block.type | (index === blocks.length - 1 ? 128 : 0)
    header.writeUIntBE(block.body.length, 1, 3)
    return [header, block.body]
  }), base.audio])
}

export function id3Prefix(footer = false): Buffer {
  const header = Buffer.from([73, 68, 51, footer ? 4 : 3, 0, footer ? 16 : 0, 0, 0, 0, 0])
  const title = Buffer.from('\x00Stale ID3 title')
  const frame = Buffer.alloc(10)
  frame.write('TIT2')
  frame.writeUInt32BE(title.length, 4)
  header[9] = frame.length + title.length
  const tail = Buffer.from(header)
  tail.write('3DI')
  return Buffer.concat([header, frame, title, ...(footer ? [tail] : [])])
}
