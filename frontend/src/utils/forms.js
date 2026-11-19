/** Form helpers shared by dialogs. */

/**
 * Map an ApiError's `details` to `{field: message}` so messages appear next to fields.
 * @param {{details?: Array<{field: string, message: string}>}} error
 * @returns {Record<string, string>}
 */
export function fieldErrorsFrom(error) {
  const out = {}
  ;(error?.details || []).forEach((d) => {
    if (d?.field && !out[d.field]) out[d.field] = d.message
  })
  return out
}

/** @returns {boolean} whether an ApiError is an optimistic-concurrency conflict */
export function isConflict(error) {
  return error?.status === 409
}

/**
 * The message to show for a failed save. Conflicts include the server's "changed by" detail.
 * @param {{status?: number, message?: string, details?: Array<{field: string, message: string}>}} error
 * @returns {string}
 */
export function saveErrorMessage(error) {
  if (!error) return ''
  if (isConflict(error)) {
    const who = (error.details || []).find((d) => d.field === 'version')?.message
    return who ? `${error.message} ${who}` : error.message
  }
  return error.message || 'The change could not be saved.'
}

/**
 * Keep only the keys whose value differs from the original (strings trimmed, '' treated as null).
 * @param {Record<string, any>} values
 * @param {Record<string, any>} original
 * @returns {Record<string, any>}
 */
export function changedFields(values, original) {
  const norm = (v) => (v === '' || v === undefined ? null : typeof v === 'string' ? v.trim() : v)
  const out = {}
  Object.keys(values).forEach((key) => {
    if (norm(values[key]) !== norm(original?.[key])) out[key] = norm(values[key])
  })
  return out
}
