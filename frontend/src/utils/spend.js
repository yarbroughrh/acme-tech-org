/** Weekly spend helpers (CONFIRMED: spend is recorded weekly, week starting Monday, PMO only). */

export const SPEND_CATEGORY_LABELS = {
  LABOUR: 'Labour',
  CONTRACTORS_VENDORS: 'Contractors and vendors',
  SOFTWARE_LICENCES: 'Software and licences',
  HARDWARE_INFRA: 'Hardware and infrastructure',
  OTHER: 'Other',
}

/** Parse YYYY-MM-DD as a local date (no timezone shift). */
function parseIso(iso) {
  const [y, m, d] = String(iso).split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** @returns {string} YYYY-MM-DD for a local Date */
export function toIso(date) {
  const p = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
}

/** Monday of the ISO week containing `date`. */
export function mondayOf(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}

/** Default week: the Monday of last week. */
export function lastWeekMonday(today = new Date()) {
  const m = mondayOf(today)
  m.setDate(m.getDate() - 7)
  return toIso(m)
}

/** "Mon 9 Nov 2026" */
export function formatWeek(iso) {
  if (!iso) return ''
  return parseIso(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * Validate the spend form. Returns {field: message}.
 * @param {{week_starting: string, category: string, amount: string, note: string}} values
 */
export function validateSpend(values, today = new Date()) {
  const errors = {}
  if (!values.week_starting) errors.week_starting = 'Week starting is required.'
  else {
    const day = parseIso(values.week_starting)
    if (Number.isNaN(day.getTime())) errors.week_starting = 'Week starting must be a date.'
    else if (day.getDay() !== 1) errors.week_starting = 'Week starting must be a Monday.'
    else if (day > mondayOf(today)) errors.week_starting = "Week starting can't be in the future."
  }
  if (!values.category) errors.category = 'Choose a category.'
  const amount = Number(values.amount)
  if (values.amount === '' || !Number.isFinite(amount) || amount <= 0) errors.amount = 'Amount must be greater than 0.'
  if ((values.note || '').length > 500) errors.note = 'Note must be 500 characters or fewer.'
  return errors
}
