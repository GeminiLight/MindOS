import { describe, expect, it } from 'vitest'
import { buildLanceIdFilter, buildLanceMetadataFilter } from './filters.js'

describe('LanceDB predicate builders', () => {
  it('builds an OR chain for safe ids', () => {
    expect(buildLanceIdFilter(['doc1', 'chunk:2', 'a.b-c'])).toBe('id = "doc1" OR id = "chunk:2" OR id = "a.b-c"')
  })

  it('rejects ids that could break out of the predicate', () => {
    expect(() => buildLanceIdFilter(['x" OR 1=1 OR id = "'])).toThrow(/Unsafe vector id/)
    expect(() => buildLanceIdFilter([''])).toThrow(/Unsafe vector id/)
  })

  it('encodes metadata values as stored JSON and escapes SQL quotes', () => {
    expect(buildLanceMetadataFilter({ path: "Notes/it's.md", chunk: 3, pinned: true })).toBe(
      `metadata LIKE '%"path":"Notes/it''s.md"%' AND metadata LIKE '%"chunk":3%' AND metadata LIKE '%"pinned":true%'`,
    )
    expect(buildLanceMetadataFilter({ title: 'say "hi"' })).toBe(`metadata LIKE '%"title":"say \\"hi\\""%'`)
  })

  it('refuses unsupported filter value types', () => {
    expect(() => buildLanceMetadataFilter({ nested: { a: 1 } })).toThrow(/Unsupported metadata filter/)
  })
})
