/**
 * LanceDB predicates are SQL text. Ids and metadata filter values used to be
 * interpolated raw, so a quote in either broke the predicate or widened a
 * delete. Ids are restricted to a safe alphabet; metadata values are encoded
 * exactly as they appear in the stored JSON and single quotes are doubled.
 */
const SAFE_VECTOR_ID = /^[A-Za-z0-9_.:@-]{1,128}$/

export function assertSafeVectorId(id: string): string {
  if (!SAFE_VECTOR_ID.test(id)) {
    throw new Error(`Unsafe vector id: ${JSON.stringify(id)}`)
  }
  return id
}

export function buildLanceIdFilter(ids: string[]): string {
  return ids.map((id) => `id = "${assertSafeVectorId(id)}"`).join(' OR ')
}

function sqlStringBody(value: string): string {
  // JSON-encode (matches how the value sits inside the metadata column) and
  // strip the surrounding quotes, then escape for a single-quoted SQL literal.
  return JSON.stringify(value).slice(1, -1).replace(/'/g, "''")
}

export function buildLanceMetadataFilter(filter: Record<string, unknown>): string {
  return Object.entries(filter)
    .map(([key, value]) => {
      const encodedKey = sqlStringBody(key)
      if (typeof value === 'string') {
        return `metadata LIKE '%"${encodedKey}":"${sqlStringBody(value)}"%'`
      }
      if (typeof value === 'number' || typeof value === 'boolean') {
        return `metadata LIKE '%"${encodedKey}":${String(value)}%'`
      }
      throw new Error(`Unsupported metadata filter value for ${JSON.stringify(key)}`)
    })
    .join(' AND ')
}
