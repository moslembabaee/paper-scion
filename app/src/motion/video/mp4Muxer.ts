export interface MP4Sample {
  readonly data: Uint8Array
  readonly duration: number // in timescale units
  readonly isKeyframe: boolean
}

export interface MP4MuxerOptions {
  readonly width: number
  readonly height: number
  readonly fps?: number
  readonly timescale?: number
  readonly avcDecoderConfigRecord?: Uint8Array
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

function makeBox(type: string, ...payloads: (Uint8Array | undefined)[]): Uint8Array {
  let payloadLength = 0
  for (const p of payloads) {
    if (p) payloadLength += p.byteLength
  }
  const size = 8 + payloadLength
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  view.setUint32(0, size, false)
  out[4] = type.charCodeAt(0)
  out[5] = type.charCodeAt(1)
  out[6] = type.charCodeAt(2)
  out[7] = type.charCodeAt(3)
  let offset = 8
  for (const p of payloads) {
    if (p) {
      out.set(p, offset)
      offset += p.byteLength
    }
  }
  return out
}

function uint16(value: number): Uint8Array {
  const buf = new Uint8Array(2)
  new DataView(buf.buffer).setUint16(0, value, false)
  return buf
}

function uint32(value: number): Uint8Array {
  const buf = new Uint8Array(4)
  new DataView(buf.buffer).setUint32(0, value, false)
  return buf
}

export class MP4Muxer {
  private readonly width: number
  private readonly height: number
  private readonly timescale: number
  private avcConfig?: Uint8Array
  private readonly samples: MP4Sample[] = []

  constructor(options: MP4MuxerOptions) {
    this.width = options.width
    this.height = options.height
    this.timescale = options.timescale ?? 60000
    if (options.avcDecoderConfigRecord) {
      this.avcConfig = options.avcDecoderConfigRecord
    }
  }

  setAvcConfig(config: Uint8Array): void {
    this.avcConfig = config
  }

  addSample(sample: MP4Sample): void {
    let sampleData = sample.data
    if (this.isAnnexB(sampleData)) {
      sampleData = this.convertAnnexBToAvcc(sampleData)
    }

    const normalizedSample: MP4Sample = {
      ...sample,
      data: sampleData,
    }

    this.samples.push(normalizedSample)
    if (!this.avcConfig && sample.isKeyframe) {
      this.tryExtractSpsPps(sampleData)
    }
  }

  private isAnnexB(data: Uint8Array): boolean {
    if (data.byteLength < 4) return false
    return (
      (data[0] === 0 && data[1] === 0 && data[2] === 1) ||
      (data[0] === 0 && data[1] === 0 && data[2] === 0 && data[3] === 1)
    )
  }

  private convertAnnexBToAvcc(data: Uint8Array): Uint8Array {
    const offsets: { start: number; headerLength: number }[] = []
    let i = 0
    while (i < data.byteLength - 2) {
      if (data[i] === 0 && data[i + 1] === 0) {
        if (data[i + 2] === 1) {
          offsets.push({ start: i, headerLength: 3 })
          i += 3
          continue
        } else if (i < data.byteLength - 3 && data[i + 2] === 0 && data[i + 3] === 1) {
          offsets.push({ start: i, headerLength: 4 })
          i += 4
          continue
        }
      }
      i++
    }

    if (offsets.length === 0) return data

    const nals: Uint8Array[] = []
    for (let k = 0; k < offsets.length; k++) {
      const nalStart = offsets[k].start + offsets[k].headerLength
      const nalEnd = k + 1 < offsets.length ? offsets[k + 1].start : data.byteLength
      const nalPayload = data.subarray(nalStart, nalEnd)
      if (nalPayload.byteLength > 0) {
        nals.push(uint32(nalPayload.byteLength), nalPayload)
      }
    }
    return concatBuffers(...nals)
  }

  private tryExtractSpsPps(data: Uint8Array): void {
    // Scan AVCC 4-byte length-prefixed NAL units
    let offset = 0
    let sps: Uint8Array | null = null
    let pps: Uint8Array | null = null
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

    while (offset + 4 <= data.byteLength) {
      const nalLength = view.getUint32(offset, false)
      offset += 4
      if (offset + nalLength > data.byteLength) break

      const nalType = data[offset] & 0x1f
      if (nalType === 7 && !sps) {
        sps = data.slice(offset, offset + nalLength)
      } else if (nalType === 8 && !pps) {
        pps = data.slice(offset, offset + nalLength)
      }
      offset += nalLength
    }

    if (sps && pps) {
      // Build AVC Configuration Record (avcC)
      const avcC = new Uint8Array(11 + sps.byteLength + pps.byteLength)
      avcC[0] = 1 // version
      avcC[1] = sps[1] // profile
      avcC[2] = sps[2] // profile_compat
      avcC[3] = sps[3] // level
      avcC[4] = 0xff // 6 bits reserved + lengthSizeMinusOne (3 = 4 bytes)
      avcC[5] = 0xe1 // 3 bits reserved + numSPS (1)
      new DataView(avcC.buffer).setUint16(6, sps.byteLength, false)
      avcC.set(sps, 8)
      const ppsOffset = 8 + sps.byteLength
      avcC[ppsOffset] = 1 // numPPS
      new DataView(avcC.buffer).setUint16(ppsOffset + 1, pps.byteLength, false)
      avcC.set(pps, ppsOffset + 3)
      this.avcConfig = avcC
    }
  }

  private createDefaultAvcConfig(): Uint8Array {
    // Minimal standard AVC Baseline profile config
    return new Uint8Array([
      0x01, 0x42, 0xc0, 0x1e, 0xff, 0xe1, 0x00, 0x09,
      0x67, 0x42, 0xc0, 0x1e, 0xd9, 0x01, 0x41, 0xf9, 0x70,
      0x01, 0x00, 0x04, 0x68, 0xce, 0x3c, 0x80
    ])
  }

  finalize(): Uint8Array {
    if (this.samples.length === 0) {
      throw new Error('Cannot finalize MP4 with 0 video frames.')
    }

    const avcConfig = this.avcConfig ?? this.createDefaultAvcConfig()

    // 1. ftyp box
    const ftyp = makeBox(
      'ftyp',
      new Uint8Array([
        0x69, 0x73, 0x6f, 0x6d, // major_brand: isom
        0x00, 0x00, 0x02, 0x00, // minor_version: 512
        0x69, 0x73, 0x6f, 0x6d, // compatible_brands: isom
        0x69, 0x73, 0x6f, 0x32, // iso2
        0x61, 0x76, 0x63, 0x31, // avc1
        0x6d, 0x70, 0x34, 0x31, // mp41
      ])
    )

    // Compute total duration
    let totalDuration = 0
    for (const sample of this.samples) {
      totalDuration += sample.duration
    }

    // Build sample tables:
    // stts (time to sample)
    const sttsEntries: Uint8Array[] = []
    let currentDelta = this.samples[0].duration
    let currentCount = 0
    for (const s of this.samples) {
      if (s.duration === currentDelta) {
        currentCount++
      } else {
        sttsEntries.push(uint32(currentCount), uint32(currentDelta))
        currentDelta = s.duration
        currentCount = 1
      }
    }
    if (currentCount > 0) {
      sttsEntries.push(uint32(currentCount), uint32(currentDelta))
    }
    const stts = makeBox('stts', uint32(0), uint32(sttsEntries.length / 2), concatBuffers(...sttsEntries))

    // stss (sync samples / keyframes)
    const keyframeIndices: Uint8Array[] = []
    this.samples.forEach((s, idx) => {
      if (s.isKeyframe) {
        keyframeIndices.push(uint32(idx + 1)) // 1-based index
      }
    })
    const stss = makeBox('stss', uint32(0), uint32(keyframeIndices.length), concatBuffers(...keyframeIndices))

    // stsc (sample to chunk: 1 sample per chunk)
    const stsc = makeBox(
      'stsc',
      uint32(0), // version & flags
      uint32(1), // entry_count
      uint32(1), // first_chunk
      uint32(1), // samples_per_chunk
      uint32(1)  // sample_description_index
    )

    // stsz (sample sizes)
    const sampleSizes = this.samples.map(s => uint32(s.data.byteLength))
    const stsz = makeBox('stsz', uint32(0), uint32(0), uint32(this.samples.length), concatBuffers(...sampleSizes))

    // avcC box
    const avcCBox = makeBox('avcC', avcConfig)

    // avc1 box
    const compressorName = new Uint8Array(32)
    const label = 'Paper H.264'
    compressorName[0] = label.length
    for (let i = 0; i < label.length; i++) {
      compressorName[1 + i] = label.charCodeAt(i)
    }

    const avc1Payload = concatBuffers(
      new Uint8Array(6), // reserved
      uint16(1), // data_reference_index
      new Uint8Array(16), // pre_defined & reserved
      uint16(this.width),
      uint16(this.height),
      uint32(0x00480000), // horizresolution: 72 dpi
      uint32(0x00480000), // vertresolution: 72 dpi
      uint32(0), // reserved
      uint16(1), // frame_count
      compressorName,
      uint16(0x0018), // depth: 24 bits
      uint16(0xffff), // pre_defined: -1
      avcCBox
    )
    const avc1 = makeBox('avc1', avc1Payload)

    // stsd
    const stsd = makeBox('stsd', uint32(0), uint32(1), avc1)

    // mdat payload
    const mdatBuffers = this.samples.map(s => s.data)
    let mdatPayloadSize = 0
    for (const b of mdatBuffers) mdatPayloadSize += b.byteLength
    const mdatHeader = new Uint8Array(8)
    new DataView(mdatHeader.buffer).setUint32(0, 8 + mdatPayloadSize, false)
    mdatHeader[4] = 0x6d // 'm'
    mdatHeader[5] = 0x64 // 'd'
    mdatHeader[6] = 0x61 // 'a'
    mdatHeader[7] = 0x74 // 't'

    // Calculate stco offsets:
    // With FastStart (ftyp -> moov -> mdat):
    // stco chunk offsets are known if we compute moov box size first.
    // stco box size with N samples: 8 (box header) + 4 (version/flags) + 4 (entry count) + N * 4 bytes
    const buildMoov = (firstMdatByteOffset: number): Uint8Array => {
      const chunkOffsets: Uint8Array[] = []
      let offset = firstMdatByteOffset + 8 // skip mdat 8-byte header
      for (const s of this.samples) {
        chunkOffsets.push(uint32(offset))
        offset += s.data.byteLength
      }
      const stco = makeBox('stco', uint32(0), uint32(this.samples.length), concatBuffers(...chunkOffsets))

      const stbl = makeBox('stbl', stsd, stts, stss, stsc, stsz, stco)

      const dinf = makeBox(
        'dinf',
        makeBox('dref', uint32(0), uint32(1), makeBox('url ', uint32(1)))
      )

      const vmhd = makeBox(
        'vmhd',
        uint32(1), // version 0, flags 1
        uint16(0), // graphicsmode
        uint16(0), uint16(0), uint16(0) // opcolor
      )

      const minf = makeBox('minf', vmhd, dinf, stbl)

      const hdlr = makeBox(
        'hdlr',
        uint32(0), // version 0, flags 0
        uint32(0), // pre_defined
        new Uint8Array([0x76, 0x69, 0x64, 0x65]), // 'vide'
        new Uint8Array(12), // reserved
        new Uint8Array([
          0x56, 0x69, 0x64, 0x65, 0x6f, 0x48, 0x61, 0x6e, 0x64, 0x6c, 0x65, 0x72, 0x00 // 'VideoHandler\0'
        ])
      )

      const mdhd = makeBox(
        'mdhd',
        uint32(0), // version 0, flags 0
        uint32(0), // creation_time
        uint32(0), // modification_time
        uint32(this.timescale),
        uint32(totalDuration),
        uint16(0x55c4), // language: und
        uint16(0) // pre_defined
      )

      const mdia = makeBox('mdia', mdhd, hdlr, minf)

      const tkhd = makeBox(
        'tkhd',
        uint32(3), // version 0, flags 3 (enabled | in_movie)
        uint32(0), // creation_time
        uint32(0), // modification_time
        uint32(1), // track_ID: 1
        uint32(0), // reserved
        uint32(totalDuration),
        new Uint8Array(8), // reserved
        uint16(0), // layer
        uint16(0), // alternate_group
        uint16(0), // volume
        uint16(0), // reserved
        // matrix: identity 3x3
        uint32(0x00010000), uint32(0), uint32(0),
        uint32(0), uint32(0x00010000), uint32(0),
        uint32(0), uint32(0), uint32(0x40000000),
        uint32(this.width << 16),
        uint32(this.height << 16)
      )

      const trak = makeBox('trak', tkhd, mdia)

      const mvhd = makeBox(
        'mvhd',
        uint32(0), // version 0, flags 0
        uint32(0), // creation_time
        uint32(0), // modification_time
        uint32(this.timescale),
        uint32(totalDuration),
        uint32(0x00010000), // rate: 1.0
        uint16(0x0100), // volume: 1.0
        new Uint8Array(10), // reserved
        // matrix: identity 3x3
        uint32(0x00010000), uint32(0), uint32(0),
        uint32(0), uint32(0x00010000), uint32(0),
        uint32(0), uint32(0), uint32(0x40000000),
        new Uint8Array(24), // pre_defined
        uint32(2) // next_track_ID: 2
      )

      return makeBox('moov', mvhd, trak)
    }

    // Two-pass size resolution for exact fast-start moov offset:
    const provisionalMoov = buildMoov(0)
    const exactMoovOffset = ftyp.byteLength
    const exactMdatOffset = exactMoovOffset + provisionalMoov.byteLength
    const finalMoov = buildMoov(exactMdatOffset)

    return concatBuffers(ftyp, finalMoov, mdatHeader, ...mdatBuffers)
  }
}
