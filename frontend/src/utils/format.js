/** Display helpers shared by pages. */

export const LIFECYCLE_LABELS = {
  PROPOSED: 'Proposed',
  ACTIVE: 'Active',
  ON_HOLD: 'On hold',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
}

export const PRIORITY_LABELS = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' }

export const HEALTH_LABELS = { GREEN: 'Green', AMBER: 'Amber', RED: 'Red' }

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })

/** @returns {string} amount formatted as whole US dollars, or an em dash */
export function formatUsd(amount) {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) return '—'
  return usd.format(Number(amount))
}

/** @returns {string} an ISO date (YYYY-MM-DD) as e.g. "19 Nov 2026", or an em dash */
export function formatDate(iso) {
  if (!iso) return '—'
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return '—'
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  })
}

/** @returns {string} an ISO timestamp as a local date and time, or an em dash */
export function formatDateTime(iso) {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

/** Simple email format check used for inline validation. */
export function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
}
