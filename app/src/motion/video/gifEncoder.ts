export interface GIFFrame {
  readonly rgba: Uint8ClampedArray
  readonly width: number
  readonly height: number
  readonly delayMs: number
}

export interface GIFEncoderOptions {
  readonly width: number
  readonly height: number
  readonly loop?: number // 0 = infinite
  readonly transparent?: boolean
}

interface ColorBox {
  rMin: number
  rMax: number
  gMin: number
  gMax: number
  bMin: number
  bMax: number
  colors: number[]
}

export class GIFEncoder {
  private readonly width: number
  private readonly height: number
  private readonly loop: number
  private readonly transparent: boolean
  private readonly frames: GIFFrame[] = []

  constructor(options: GIFEncoderOptions) {
    this.width = options.width
    this.height = options.height
    this.loop = options.loop ?? 0
    this.transparent = options.transparent ?? false
  }

  addFrame(frame: GIFFrame): void {
    this.frames.push(frame)
  }

  encode(): Uint8Array {
    if (this.frames.length === 0) {
      throw new Error('Cannot encode GIF with 0 frames.')
    }

    const parts: Uint8Array[] = []

    // 1. Header "GIF89a"
    parts.push(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))

    // 2. Logical Screen Descriptor
    const lsd = new Uint8Array(7)
    const view = new DataView(lsd.buffer)
    view.setUint16(0, this.width, true) // little-endian
    view.setUint16(2, this.height, true)
    // No global color table here (we use local color table per frame for best visual fidelity)
    // Packed byte: GCT Flag (0), Color Res (7 = 8 bits), Sort (0), GCT Size (0)
    lsd[4] = 0x70
    lsd[5] = 0 // background color index
    lsd[6] = 0 // pixel aspect ratio
    parts.push(lsd)

    // 3. Netscape 2.0 Looping Application Extension
    if (this.loop >= 0) {
      const loopExt = new Uint8Array([
        0x21, 0xff, 0x0b, // Extension introducer, Application extension, size 11
        0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, // "NETSCAPE2.0"
        0x03, 0x01, // Sub-block size 3, Sub-block ID 1
        this.loop & 0xff, (this.loop >> 8) & 0xff, // Loop count (little-endian)
        0x00 // Block terminator
      ])
      parts.push(loopExt)
    }

    // 4. Encode each frame
    for (const frame of this.frames) {
      parts.push(this.encodeFrame(frame))
    }

    // 5. Trailer (0x3B)
    parts.push(new Uint8Array([0x3b]))

    // Concatenate all parts
    let totalLength = 0
    for (const p of parts) totalLength += p.byteLength
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const p of parts) {
      result.set(p, offset)
      offset += p.byteLength
    }
    return result
  }

  private encodeFrame(frame: GIFFrame): Uint8Array {
    const frameParts: Uint8Array[] = []
    const { palette, indexedPixels, transparentIndex } = this.quantizeFrame(frame)

    // Graphic Control Extension
    const gce = new Uint8Array(8)
    gce[0] = 0x21 // Extension Introducer
    gce[1] = 0xf9 // Graphic Control Label
    gce[2] = 0x04 // Byte size
    // Packed byte:
    // Disposal method: 2 = restore to background (crucial for transparent GIF frames)
    // Transparent color flag: 1 if transparent, else 0
    const hasTransparency = this.transparent && transparentIndex >= 0
    const disposal = hasTransparency ? 2 : 1
    gce[3] = (disposal << 2) | (hasTransparency ? 1 : 0)
    // Delay time in 1/100ths of a second
    const delayHundredths = Math.max(1, Math.round(frame.delayMs / 10))
    new DataView(gce.buffer).setUint16(4, delayHundredths, true)
    gce[6] = hasTransparency ? transparentIndex : 0
    gce[7] = 0x00 // Terminator
    frameParts.push(gce)

    // Image Descriptor
    const id = new Uint8Array(10)
    id[0] = 0x2c // Image Separator
    new DataView(id.buffer).setUint16(1, 0, true) // Left
    new DataView(id.buffer).setUint16(3, 0, true) // Top
    new DataView(id.buffer).setUint16(5, this.width, true)
    new DataView(id.buffer).setUint16(7, this.height, true)
    // Packed byte: Local Color Table Flag (1), Interlace (0), Sort (0), Size (7 = 256 colors)
    id[9] = 0x87
    frameParts.push(id)

    // Local Color Table (256 * 3 = 768 bytes)
    frameParts.push(palette)

    // LZW Compression
    const minCodeSize = 8
    frameParts.push(new Uint8Array([minCodeSize]))
    const lzwBlocks = this.compressLZW(indexedPixels, minCodeSize)
    frameParts.push(lzwBlocks)

    let totalLen = 0
    for (const fp of frameParts) totalLen += fp.byteLength
    const out = new Uint8Array(totalLen)
    let offset = 0
    for (const fp of frameParts) {
      out.set(fp, offset)
      offset += fp.byteLength
    }
    return out
  }

  private quantizeFrame(frame: GIFFrame): {
    palette: Uint8Array
    indexedPixels: Uint8Array
    transparentIndex: number
  } {
    const totalPixels = this.width * this.height
    const indexedPixels = new Uint8Array(totalPixels)
    const transparentIndex = this.transparent ? 0 : -1

    // Build 256-color palette
    const palette = new Uint8Array(256 * 3)
    if (this.transparent) {
      // Index 0 is transparent matte (e.g. RGB 0, 0, 0)
      palette[0] = 0
      palette[1] = 0
      palette[2] = 0
    }

    // Collect color frequencies
    const maxColors = this.transparent ? 255 : 256
    const colorMap = new Map<number, number>() // RGB packed -> count
    const rgba = frame.rgba

    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4
      const a = rgba[idx + 3]
      if (this.transparent && a < 128) {
        continue
      }
      // Quantize to 5 bits per channel for fast grouping
      const r = rgba[idx] & 0xf8
      const g = rgba[idx + 1] & 0xf8
      const b = rgba[idx + 2] & 0xf8
      const rgb = (r << 16) | (g << 8) | b
      colorMap.set(rgb, (colorMap.get(rgb) ?? 0) + 1)
    }

    const uniqueColors = Array.from(colorMap.keys())
    const paletteColors: number[] = []

    if (uniqueColors.length <= maxColors) {
      paletteColors.push(...uniqueColors)
    } else {
      // Median cut on bounding boxes
      const boxes: ColorBox[] = [this.createBox(uniqueColors)]
      while (boxes.length < maxColors) {
        // Find box with largest dimension
        let maxDim = -1
        let boxToSplit = -1
        for (let i = 0; i < boxes.length; i++) {
          const b = boxes[i]
          if (b.colors.length <= 1) continue
          const dim = Math.max(b.rMax - b.rMin, b.gMax - b.gMin, b.bMax - b.bMin)
          if (dim > maxDim) {
            maxDim = dim
            boxToSplit = i
          }
        }
        if (boxToSplit < 0 || maxDim <= 0) break

        const target = boxes.splice(boxToSplit, 1)[0]
        const rLen = target.rMax - target.rMin
        const gLen = target.gMax - target.gMin
        const bLen = target.bMax - target.bMin

        let sortKey = (c: number) => (c >> 16) & 0xff
        if (gLen >= rLen && gLen >= bLen) sortKey = (c: number) => (c >> 8) & 0xff
        else if (bLen >= rLen && bLen >= gLen) sortKey = (c: number) => c & 0xff

        target.colors.sort((a, b) => sortKey(a) - sortKey(b))
        const mid = Math.floor(target.colors.length / 2)
        boxes.push(this.createBox(target.colors.slice(0, mid)))
        boxes.push(this.createBox(target.colors.slice(mid)))
      }

      for (const box of boxes) {
        let rSum = 0, gSum = 0, bSum = 0, count = 0
        for (const c of box.colors) {
          const weight = colorMap.get(c) ?? 1
          rSum += ((c >> 16) & 0xff) * weight
          gSum += ((c >> 8) & 0xff) * weight
          bSum += (c & 0xff) * weight
          count += weight
        }
        if (count > 0) {
          const r = Math.round(rSum / count)
          const g = Math.round(gSum / count)
          const b = Math.round(bSum / count)
          paletteColors.push((r << 16) | (g << 8) | b)
        }
      }
    }

    // Populate palette buffer
    const paletteOffset = this.transparent ? 1 : 0
    for (let i = 0; i < paletteColors.length && i < maxColors; i++) {
      const c = paletteColors[i]
      const pIdx = (i + paletteOffset) * 3
      palette[pIdx] = (c >> 16) & 0xff
      palette[pIdx + 1] = (c >> 8) & 0xff
      palette[pIdx + 2] = c & 0xff
    }

    // Fast lookup cache (quantized 5-5-5 RGB -> palette index)
    const lookupCache = new Map<number, number>()
    const findClosestIndex = (r: number, g: number, b: number): number => {
      const key = ((r & 0xf8) << 7) | ((g & 0xf8) << 2) | ((b & 0xf8) >> 3)
      const cached = lookupCache.get(key)
      if (cached !== undefined) return cached

      let bestIdx = paletteOffset
      let bestDist = Infinity
      const count = paletteColors.length
      for (let i = 0; i < count; i++) {
        const pIdx = (i + paletteOffset) * 3
        const pr = palette[pIdx]
        const pg = palette[pIdx + 1]
        const pb = palette[pIdx + 2]
        const dr = r - pr
        const dg = g - pg
        const db = b - pb
        const dist = dr * dr + dg * dg + db * db
        if (dist < bestDist) {
          bestDist = dist
          bestIdx = i + paletteOffset
          if (dist === 0) break
        }
      }
      lookupCache.set(key, bestIdx)
      return bestIdx
    }

    // Map each pixel to palette index
    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4
      const a = rgba[idx + 3]
      if (this.transparent && a < 128) {
        indexedPixels[i] = transparentIndex
      } else {
        indexedPixels[i] = findClosestIndex(rgba[idx], rgba[idx + 1], rgba[idx + 2])
      }
    }

    return { palette, indexedPixels, transparentIndex }
  }

  private createBox(colors: number[]): ColorBox {
    let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0
    for (const c of colors) {
      const r = (c >> 16) & 0xff
      const g = (c >> 8) & 0xff
      const b = c & 0xff
      if (r < rMin) rMin = r
      if (r > rMax) rMax = r
      if (g < gMin) gMin = g
      if (g > gMax) gMax = g
      if (b < bMin) bMin = b
      if (b > bMax) bMax = b
    }
    return { rMin, rMax, gMin, gMax, bMin, bMax, colors }
  }

  private compressLZW(indexedPixels: Uint8Array, minCodeSize: number): Uint8Array {
    const clearCode = 1 << minCodeSize // 256
    const eoiCode = clearCode + 1       // 257
    let codeSize = minCodeSize + 1     // 9
    let nextCode = eoiCode + 1         // 258

    const dictionary = new Map<number, number>()
    const initDict = () => {
      dictionary.clear()
      codeSize = minCodeSize + 1
      nextCode = eoiCode + 1
    }

    const outBytes: number[] = []
    let curAccum = 0
    let curBits = 0

    const emitBits = (code: number) => {
      curAccum |= code << curBits
      curBits += codeSize
      while (curBits >= 8) {
        outBytes.push(curAccum & 0xff)
        curAccum >>= 8
        curBits -= 8
      }
    }

    const flushBits = () => {
      if (curBits > 0) {
        outBytes.push(curAccum & 0xff)
        curAccum = 0
        curBits = 0
      }
    }

    // Start with clear code
    emitBits(clearCode)
    initDict()

    if (indexedPixels.length > 0) {
      let curPrefix = indexedPixels[0]
      for (let i = 1; i < indexedPixels.length; i++) {
        const k = indexedPixels[i]
        // Key: prefix (max 12 bits) << 8 | k (8 bits)
        const key = (curPrefix << 8) | k
        const code = dictionary.get(key)
        if (code !== undefined) {
          curPrefix = code
        } else {
          emitBits(curPrefix)
          if (nextCode < 4096) {
            dictionary.set(key, nextCode++)
            if (nextCode === (1 << codeSize) + 1 && codeSize < 12) {
              codeSize++
            }
          } else {
            emitBits(clearCode)
            initDict()
          }
          curPrefix = k
        }
      }
      emitBits(curPrefix)
    }

    emitBits(eoiCode)
    flushBits()

    // Package output into sub-blocks (max 255 bytes each)
    const blocks: number[] = []
    let idx = 0
    while (idx < outBytes.length) {
      const blockSize = Math.min(255, outBytes.length - idx)
      blocks.push(blockSize)
      for (let i = 0; i < blockSize; i++) {
        blocks.push(outBytes[idx + i])
      }
      idx += blockSize
    }
    blocks.push(0x00) // Block terminator

    return new Uint8Array(blocks)
  }
}
