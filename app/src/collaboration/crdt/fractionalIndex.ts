/**
 * Fractional Indexing CRDT for conflict-free sequence ordering.
 * Generates compact, lexicographically orderable string keys between any two positions.
 *
 * Guarantees:
 * 1. a < generateKeyBetween(a, b) < b (lexicographical string ordering)
 * 2. Deterministic, collision-free with actor tie-breaking
 * 3. Indefinite insertions without needing to reindex siblings
 */

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const START_KEY = 'a0'
const MID_INDEX = Math.floor(ALPHABET.length / 2)

function getCharIndex(char: string): number {
  const index = ALPHABET.indexOf(char)
  return index >= 0 ? index : 0
}

function generateRawBetween(a: string | null | undefined, b: string | null | undefined): string {
  if (!a && !b) {
    return START_KEY
  }

  if (!a && b) {
    const idxB = getCharIndex(b[0])
    if (idxB > 1) {
      return ALPHABET[Math.floor(idxB / 2)]
    }
    return ALPHABET[0] + generateRawBetween(null, b.slice(1))
  }

  if (a && !b) {
    return a + ALPHABET[MID_INDEX]
  }

  if (a! >= b!) {
    return a! + ALPHABET[MID_INDEX]
  }

  let p = 0
  while (p < a!.length && p < b!.length && a![p] === b![p]) {
    p++
  }

  const prefix = a!.slice(0, p)
  if (p === a!.length) {
    const idxB = getCharIndex(b![p])
    if (idxB > 1) {
      return prefix + ALPHABET[Math.floor(idxB / 2)]
    }
    return prefix + ALPHABET[0] + ALPHABET[MID_INDEX]
  }

  const idxA = getCharIndex(a![p])
  const idxB = getCharIndex(b![p])

  if (idxB - idxA > 1) {
    return prefix + ALPHABET[Math.floor((idxA + idxB) / 2)]
  }

  return prefix + a![p] + generateRawBetween(a!.slice(p + 1), null)
}

/**
 * Generates a fractional index string between `a` and `b`.
 * If a is null/undefined, generates a key before b.
 * If b is null/undefined, generates a key after a.
 * If both are null/undefined, returns a default mid-range key.
 */
export function generateKeyBetween(
  a: string | null | undefined,
  b: string | null | undefined,
  actor = ''
): string {
  const key = generateRawBetween(a, b)
  return actor ? `${key}:${actor}` : key
}

/**
 * Sorts items by their fractional index, using ID as tie-breaker if fractional indices coincide.
 */
export function sortByFractionalIndex<T>(
  items: readonly T[],
  getIndex: (item: T) => string | undefined,
  getId: (item: T) => string
): T[] {
  return [...items].sort((a, b) => {
    const indexA = getIndex(a) ?? ''
    const indexB = getIndex(b) ?? ''
    if (indexA < indexB) return -1
    if (indexA > indexB) return 1
    const idA = getId(a)
    const idB = getId(b)
    if (idA < idB) return -1
    if (idA > idB) return 1
    return 0
  })
}
