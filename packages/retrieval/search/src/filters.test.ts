import { describe, expect, it } from 'vitest'
import { buildMeilisearchFilter, meilisearchStringLiteral } from './filters.js'

describe('buildMeilisearchFilter', () => {
  it('returns undefined when no filters apply', () => {
    expect(buildMeilisearchFilter({})).toBeUndefined()
  })

  it('escapes quotes and backslashes in tags and path prefixes', () => {
    expect(meilisearchStringLiteral('a"b\\c')).toBe('"a\\"b\\\\c"')
    expect(buildMeilisearchFilter({ tags: ['x" OR path = "'], pathPrefix: 'Notes/"q' })).toBe(
      '(tags = "x\\" OR path = \\"") AND path STARTS WITH "Notes/\\"q"',
    )
  })

  it('combines tag, path and date filters with AND', () => {
    const filter = buildMeilisearchFilter({
      tags: ['a', 'b'],
      pathPrefix: 'Research/',
      createdAfter: new Date(1000),
      createdBefore: new Date(2000),
    })
    expect(filter).toBe('(tags = "a" OR tags = "b") AND path STARTS WITH "Research/" AND createdAt >= 1000 AND createdAt <= 2000')
  })
})
