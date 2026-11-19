/**
 * Password policy (CONFIRMED by the PMO; mirrors the backend, which is authoritative):
 * at least 12 characters with an upper-case letter, a lower-case letter, a digit and a symbol.
 */
export const MIN_PASSWORD_LENGTH = 12

export const PASSWORD_RULES = [
  { id: 'length', label: `At least ${MIN_PASSWORD_LENGTH} characters`, test: (p) => p.length >= MIN_PASSWORD_LENGTH },
  { id: 'upper', label: 'An upper-case letter', test: (p) => /[A-Z]/.test(p) },
  { id: 'lower', label: 'A lower-case letter', test: (p) => /[a-z]/.test(p) },
  { id: 'digit', label: 'A digit', test: (p) => /\d/.test(p) },
  { id: 'symbol', label: 'A symbol', test: (p) => /[^A-Za-z0-9]/.test(p) },
]

/**
 * Evaluate a password against every rule.
 * @param {string} password
 * @returns {{valid: boolean, results: Array<{id: string, label: string, met: boolean}>}}
 */
export function checkPassword(password = '') {
  const results = PASSWORD_RULES.map((rule) => ({ id: rule.id, label: rule.label, met: rule.test(password) }))
  return { valid: results.every((r) => r.met), results }
}
