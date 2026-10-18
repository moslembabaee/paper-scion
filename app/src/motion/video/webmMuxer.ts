export interface WebMSample {
  readonly data: Uint8Array
  readonly timestampMs: number
  readonly isKeyframe: boolean
  readonly durationMs?: number
}

export interface WebMMuxerOptions {
  readonly width: number
  readonly height: number
  readonly codec?: 'V_VP9' | 'V_VP8'
  readonly transparent?: boolean
  readonly timescaleMs?: number
}

function encodeVint(val: number): Uint8Array {
  if (val < 0x7f) {
    return new Uint8Array([0x80 | val])
  } else if (val < 0x3fff) {
    return new Uint8Array([0x40 | (val >> 8), val & 0xff])
  } else if (val < 0x1fffff) {
    return new Uint8Array([0x20 | (val >> 16), (val >> 8) & 0xff, val & 0xff])
  } else if (val < 0x0fffffff) {
    return new Uint8Array([0x10 | (val >> 24), (val >> 16) & 0xff, (val >> 8) & 0xff, val & 0xff])
  } else {
    // 8-byte VINT
    const buf = new Uint8Array(8)
    const view = new DataView(buf.buffer)
    view.setUint32(0, Math.floor(val / 0x100000000), false)
    view.setUint32(4, val >>> 0, false)
    buf[0] |= 0x01
    return buf
  }
}

function encodeId(id: number): Uint8Array {
  if (id <= 0xff) {
    return new Uint8Array([id])
  } else if (id <= 0xffff) {
    return new Uint8Array([id >> 8, id & 0xff])
  } else if (id <= 0xffffff) {
    return new Uint8Array([id >> 16, (id >> 8) & 0xff, id & 0xff])
  } else {
    return new Uint8Array([(id >>> 24) & 0xff, (id >> 16) & 0xff, (id >> 8) & 0xff, id & 0xff])
  }
}

function ebmlElement(id: number, ...children: Uint8Array[]): Uint8Array {
  let payloadLength = 0
  for (const c of children) payloadLength += c.byteLength
  const idBytes = encodeId(id)
  const sizeBytes = encodeVint(payloadLength)
  const out = new Uint8Array(idBytes.byteLength + sizeBytes.byteLength + payloadLength)
  out.set(idBytes, 0)
  out.set(sizeBytes, idBytes.byteLength)
  let offset = idBytes.byteLength + sizeBytes.byteLength
  for (const c of children) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}

function ebmlUint(id: number, value: number): Uint8Array {
  const bytes: number[] = []
  let temp = value
  do {
    bytes.unshift(temp & 0xff)
    temp = Math.floor(temp / 256)
  } while (temp > 0)
  return ebmlElement(id, new Uint8Array(bytes))
}

function ebmlString(id: number, str: string): Uint8Array {
  const encoder = new TextEncoder()
  return ebmlElement(id, encoder.encode(str))
}

function ebmlFloat(id: number, value: number): Uint8Array {
  const buf = new Uint8Array(4)
  new DataView(buf.buffer).setFloat32(0, value, false)
  return ebmlElement(id, buf)
}

function concatBuffers(...buffers: Uint8Array[]): Uint8Array {
  let totalLength = 0
  for (const b of buffers) totalLength += b.byteLength
  const out = new Uint8Array(totalLength)
  let offset = 0
  for (const b of buffers) {
    out.set(b, offset)
    offset += b.byteLength
  }
  return out
}

export class WebMMuxer {
  private readonly width: number
  private readonly height: number
  private readonly codec: 'V_VP9' | 'V_VP8'
  private readonly transparent: boolean
  private readonly samples: WebMSample[] = []

  constructor(options: WebMMuxerOptions) {
    this.width = options.width
    this.height = options.height
    this.codec = options.codec ?? 'V_VP9'
    this.transparent = options.transparent ?? false
  }

  addSample(sample: WebMSample): void {
    this.samples.push(sample)
  }

  finalize(): Uint8Array {
    if (this.samples.length === 0) {
      throw new Error('Cannot finalize WebM with 0 video frames.')
    }

    // 1. EBML Header
    const ebmlHeader = ebmlElement(
      0x1a45dfa3, // EBML
      ebmlUint(0x4286, 1), // EBMLVersion
      ebmlUint(0x42f7, 1), // EBMLReadVersion
      ebmlUint(0x42f2, 4), // EBMLMaxIDLength
      ebmlUint(0x42f3, 8), // EBMLMaxSizeLength
      ebmlString(0x4282, 'webm'), // DocType
      ebmlUint(0x4287, 4), // DocTypeVersion
      ebmlUint(0x4285, 2)  // DocTypeReadVersion
    )

    // Duration calculation
    const lastSample = this.samples[this.samples.length - 1]
    const durationMs = lastSample.timestampMs + (lastSample.durationMs ?? 16.67)

    // 2. Segment Info
    const segmentInfo = ebmlElement(
      0x1549a966, // Info
      ebmlUint(0x2ad7b1, 1000000), // TimecodeScale: 1ms (1,000,000 ns)
      ebmlString(0x4d80, 'Paper Video Engine'), // MuxingApp
      ebmlString(0x5741, 'Paper WebM Exporter'), // WritingApp
      ebmlFloat(0x4489, durationMs) // Duration in ms
    )

    // 3. Track Settings
    const videoSettings = [
      ebmlUint(0xb0, this.width), // PixelWidth
      ebmlUint(0xba, this.height), // PixelHeight
    ]
    if (this.transparent) {
      // AlphaMode: 1 indicates transparent alpha channel video stream
      videoSettings.push(ebmlUint(0x53c0, 1))
    }

    const trackEntry = ebmlElement(
      0xae, // TrackEntry
      ebmlUint(0xd7, 1), // TrackNumber: 1
      ebmlUint(0x73c5, 1), // TrackUID: 1
      ebmlUint(0x83, 1), // TrackType: 1 (video)
      ebmlString(0x86, this.codec), // CodecID: V_VP9 or V_VP8
      ebmlElement(0xe0, ...videoSettings) // Video
    )

    const tracks = ebmlElement(0x1654ae6b, trackEntry)

    // 4. Clusters & SimpleBlocks
    // Group samples into clusters (e.g. by keyframe or every 1000ms)
    const clusterElements: Uint8Array[] = []
    let currentClusterTime = 0
    let currentClusterBlocks: Uint8Array[] = []

    const flushCluster = () => {
      if (currentClusterBlocks.length > 0) {
        const cluster = ebmlElement(
          0x1f43b675, // Cluster
          ebmlUint(0xe7, currentClusterTime), // Timecode
          ...currentClusterBlocks
        )
        clusterElements.push(cluster)
        currentClusterBlocks = []
      }
    }

    for (let i = 0; i < this.samples.length; i++) {
      const sample = this.samples[i]
      if (sample.isKeyframe && i > 0 && sample.timestampMs - currentClusterTime >= 1000) {
        flushCluster()
        currentClusterTime = Math.round(sample.timestampMs)
      } else if (i === 0) {
        currentClusterTime = Math.round(sample.timestampMs)
      }

      // SimpleBlock header:
      // Track number: 0x81 (Track 1)
      // Relative Timecode: 16-bit signed BE
      // Flags: keyframe = 0x80, non-keyframe = 0x00
      const relTime = Math.max(-32768, Math.min(32767, Math.round(sample.timestampMs - currentClusterTime)))
      const blockHeader = new Uint8Array(4)
      blockHeader[0] = 0x81 // Track 1 VINT
      new DataView(blockHeader.buffer).setInt16(1, relTime, false)
      blockHeader[3] = sample.isKeyframe ? 0x80 : 0x00

      const blockPayload = concatBuffers(blockHeader, sample.data)
      const simpleBlock = ebmlElement(0xa3, blockPayload)
      currentClusterBlocks.push(simpleBlock)
    }
    flushCluster()

    // 5. Segment
    const segment = ebmlElement(
      0x18538067, // Segment
      segmentInfo,
      tracks,
      ...clusterElements
    )

    return concatBuffers(ebmlHeader, segment)
  }
}
