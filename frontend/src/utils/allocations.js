/** Allocation and people helpers shared by the Team tab, People page and load chips. */

export const STANDARD_HOURS = 40
export const PEOPLE_PAGE_SIZE = 25
export const LOAD_FILTERS = [
  { value: '', label: 'All' },
  { value: 'SEVERE', label: 'Severely over-allocated' },
  { value: 'OVER', label: 'Over-allocated' },
  { value: 'UNDER', label: 'Available capacity' },
]

/**
 * Text for a weekly load (icon + text; colour is never the only signal).
 * @param {string} status UNDER | OK | OVER | SEVERE
 * @param {number} totalHours total hours per week across projects
 * @returns {string}
 */
export function loadLabel(status, totalHours) {
  const hours = Number(totalHours) || 0
  const diff = Math.abs(Math.round((hours - STANDARD_HOURS) * 10) / 10)
  if (status === 'SEVERE') return `Severely over-allocated +${diff}h`
  if (status === 'OVER') return `Over-allocated +${diff}h`
  if (status === 'OK') return 'Fully allocated'
  return `Available ${diff}h`
}

/**
 * Validate allocation fields (mirrors the API's data checks).
 * @param {{person: object|null, hours: string, start: string, end: string}} values
 * @param {{planned_start: string, planned_end: string}} project
 * @param {boolean} editing person is fixed when editing
 * @returns {Record<string, string>} field → message
 */
export function validateAllocation(values, project, editing) {
  const errors = {}
  if (!editing && !values.person) errors.person = 'Choose a person.'
  const hours = Number(values.hours)
  if (values.hours === '' || Number.isNaN(hours)) errors.hours = 'Hours per week is required.'
  else if (hours < 0.5 || hours > 168) errors.hours = 'Hours per week must be between 0.5 and 168.'
  if (!values.start) errors.start = 'Start date is required.'
  if (!values.end) errors.end = 'End date is required.'
  const inRange = (d) => d >= project.planned_start && d <= project.planned_end
  if (values.start && !inRange(values.start)) errors.start = `Must be within the project dates (${project.planned_start} to ${project.planned_end}).`
  if (values.end && !inRange(values.end)) errors.end = `Must be within the project dates (${project.planned_start} to ${project.planned_end}).`
  if (values.start && values.end && values.end < values.start && !errors.end) errors.end = 'End date must be on or after the start date.'
  return errors
}
