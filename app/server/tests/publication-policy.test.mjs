import test from 'node:test'
import assert from 'node:assert/strict'
import { publicationDocument, publicationOrigin } from '../dist/server/publication.js'

test('the trusted publication shell keeps hostile source in a string and has no editor bridge', () => {
  const html = '</script><script>parent.document.cookie="stolen"</script>\u2028\u2029'
  const output = publicationDocument(html)
  assert.equal(output.match(/<script>/g).length, 1)
  assert.equal(output.match(/<\/script>/g).length, 1)
  assert.ok(output.includes('sandbox="allow-scripts" credentialless'))
  assert.ok(!output.includes('allow-same-origin'))
  assert.ok(!output.includes('postMessage'))
  const literal = output.split('.srcdoc=')[1].split(';</script>')[0]
  assert.equal(JSON.parse(literal), html)
})

test('release configuration permits separate HTTPS origins and loopback only for HTTP', () => {
  assert.equal(publicationOrigin(undefined, 'https://paper.example'), undefined)
  assert.equal(publicationOrigin('https://apps.example.net', 'https://paper.example'), 'https://apps.example.net')
  assert.equal(publicationOrigin('http://localhost:4180', 'http://127.0.0.1:4173'), 'http://localhost:4180')
  for (const candidate of ['http://apps.example.net', 'https://paper.example:8443', 'https://u:p@apps.example.net', 'https://apps.example.net/?path=1', 'https://apps.example.net/#fragment']) {
    assert.throws(() => publicationOrigin(candidate, 'https://paper.example'), /separate hostname/)
  }
})

test('DNS absolute names cannot disguise the editor hostname as an isolated release host', () => {
  for (const [release, editor] of [
    ['https://paper.example.', 'https://paper.example'],
    ['https://paper.example', 'https://paper.example.'],
    ['https://PAPER.example.:8443', 'https://paper.example'],
    ['http://localhost.:4180', 'http://localhost:4173'],
  ]) {
    assert.throws(() => publicationOrigin(release, editor), /separate hostname/)
  }
  // A distinct absolute DNS name is still usable behind an exact-Host proxy.
  assert.equal(publicationOrigin('https://apps.example.net.', 'https://paper.example'), 'https://apps.example.net.')
})
