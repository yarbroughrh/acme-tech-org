/** Presentation helpers for "Your next actions" (pure, unit-tested). */

export const SEVERITY_META = {
  critical: { label: 'Critical', color: 'error' },
  high: { label: 'High', color: 'warning' },
  due_soon: { label: 'Due soon', color: 'info' },
}

export const SEVERITY_ORDER = ['critical', 'high', 'due_soon']

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * Human relative time for an item: "9 days late", "waiting 3 days", "due in 2 days", "due today".
 * @param {{days_overdue?: number, waiting_days?: number|null, due_in_days?: number|null}} item
 * @returns {string} empty string when nothing time-based applies
 */
export function relativeTime(item) {
  if (item.days_overdue > 0) return `${plural(item.days_overdue, 'day')} late`
  if (item.waiting_days !== null && item.waiting_days !== undefined) {
    return item.waiting_days === 0 ? 'waiting since today' : `waiting ${plural(item.waiting_days, 'day')}`
  }
  if (item.due_in_days !== null && item.due_in_days !== undefined) {
    if (item.due_in_days === 0) return 'due today'
    return item.due_in_days < 0 ? `${plural(-item.due_in_days, 'day')} late` : `due in ${plural(item.due_in_days, 'day')}`
  }
  return ''
}

/** Role-specific filter chip: PM → Approvals, Analyst → Rework. */
export const ROLE_CHIPS = {
  PM: { key: 'approvals', label: 'Approvals', type: 'APPROVAL_WAITING' },
  ANALYST: { key: 'rework', label: 'Rework', type: 'PROPOSAL_REJECTED' },
}

/**
 * Filter items by the selected chip key ("all", a severity, or a role chip key).
 * @param {object[]} items
 * @param {string} filter
 * @param {string} role
 */
export function filterItems(items, filter, role) {
  if (filter === 'all') return items
  if (SEVERITY_META[filter]) return items.filter((i) => i.severity === filter)
  const chip = ROLE_CHIPS[role]
  if (chip && chip.key === filter) return items.filter((i) => i.type === chip.type)
  return items
}
