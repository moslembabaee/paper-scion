interface PDFImage {
  readonly width: number
  readonly height: number
  readonly pageWidth: number
  readonly pageHeight: number
  readonly rgba: Uint8ClampedArray
}
const encode = (value: string) => new TextEncoder().encode(value)

async function imageStream(bytes: Uint8Array<ArrayBuffer>): Promise<{ blob: Blob; filter: string }> {
  const source = new Blob([bytes])
  if (typeof CompressionStream === 'undefined') return { blob: source, filter: '' }
  return { blob: await new Response(source.stream().pipeThrough(new CompressionStream('deflate'))).blob(), filter: '/Filter /FlateDecode ' }
}

/** Lossless RGB artwork with a separate alpha mask. Page dimensions stay in CSS px at 72/96 points. */
export async function createPDF(image: PDFImage, signal?: AbortSignal): Promise<Blob> {
  signal?.throwIfAborted()
  const { width, height, pageWidth, pageHeight, rgba } = image
  if (![width, height, pageWidth, pageHeight].every(v => Number.isFinite(v) && v > 0) || !Number.isInteger(width) || !Number.isInteger(height) || rgba.length !== width * height * 4) throw new Error('Invalid PDF image dimensions.')
  const rgb = new Uint8Array(width * height * 3), alpha = new Uint8Array(width * height)
  let transparent = false
  for (let pixel = 0; pixel < alpha.length; pixel++) {
    rgb[pixel * 3] = rgba[pixel * 4]
    rgb[pixel * 3 + 1] = rgba[pixel * 4 + 1]
    rgb[pixel * 3 + 2] = rgba[pixel * 4 + 2]
    alpha[pixel] = rgba[pixel * 4 + 3]
    transparent ||= alpha[pixel] !== 255
    if (pixel > 0 && pixel % 1_000_000 === 0) {
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      signal?.throwIfAborted()
    }
  }
  const color = await imageStream(rgb)
  const mask = transparent ? await imageStream(alpha) : null
  const w = Number((pageWidth * .75).toFixed(4)), h = Number((pageHeight * .75).toFixed(4))
  const content = encode(`q\n${w} 0 0 ${h} 0 0 cm\n/Artwork Do\nQ\n`)
  const objects: Blob[] = [
    new Blob(['<< /Type /Catalog /Pages 2 0 R >>']),
    new Blob(['<< /Type /Pages /Kids [3 0 R] /Count 1 >>']),
    new Blob([`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Artwork 5 0 R >> >> /Contents 4 0 R >>`]),
    new Blob([`<< /Length ${content.length} >>\nstream\n`, content, 'endstream']),
    new Blob([`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 ${color.filter}${mask ? '/SMask 6 0 R ' : ''}/Length ${color.blob.size} >>\nstream\n`, color.blob, '\nendstream']),
  ]
  if (mask) objects.push(new Blob([`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8 ${mask.filter}/Length ${mask.blob.size} >>\nstream\n`, mask.blob, '\nendstream']))
  const parts: BlobPart[] = [encode('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n')]
  const offsets = [0]
  let offset = (parts[0] as Uint8Array).length
  objects.forEach((object, i) => {
    const start = encode(`${i + 1} 0 obj\n`), end = encode('\nendobj\n')
    offsets.push(offset)
    parts.push(start, object, end)
    offset += start.length + object.size + end.length
  })
  parts.push(`xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(value => `${String(value).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${offset}\n%%EOF\n`)
  return new Blob(parts, { type: 'application/pdf' })
}
