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

export const MILESTONE_STATUS_LABELS = { NOT_STARTED: 'Not started', IN_PROGRESS: 'In progress', COMPLETE: 'Complete' }

export const TASK_STATUS_LABELS = { TODO: 'To do', IN_PROGRESS: 'In progress', DONE: 'Done' }

export const FLAG_LABELS = { STATUS_MISMATCH: 'Status mismatch', UPDATE_OVERDUE: 'Update overdue' }

export const CHANGE_STATUS_LABELS = { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected' }

export const ENTITY_LABELS = { MILESTONE: 'Milestone', TASK: 'Task' }

/** Human labels for fields that can appear in change requests and audit diffs. */
export const FIELD_LABELS = {
  status: 'Status',
  percent_complete: 'Percent complete',
  due_date: 'Due date',
  notes: 'Notes',
  name: 'Name',
  title: 'Title',
}

/**
 * Format a field value for display in diffs (status codes, dates, percentages).
 * @param {string} field
 * @param {*} value
 * @param {string} [entityType] MILESTONE or TASK (status labels differ)
 * @returns {string}
 */
export function formatFieldValue(field, value, entityType) {
  if (value === null || value === undefined || value === '') return '—'
  if (field === 'status') {
    const labels = entityType === 'TASK' ? TASK_STATUS_LABELS : MILESTONE_STATUS_LABELS
    return labels[value] || TASK_STATUS_LABELS[value] || MILESTONE_STATUS_LABELS[value] || String(value)
  }
  if (field === 'percent_complete') return `${value}%`
  if (field.endsWith('_date') || field === 'planned_start' || field === 'planned_end' || field === 'actual_start') {
    return formatDate(value)
  }
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** @returns {string} a number as a whole percentage, or an em dash */
export function formatPct(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—'
  return `${Math.round(Number(value))}%`
}
