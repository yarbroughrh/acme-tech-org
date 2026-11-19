import { isEmail } from './format'

/**
 * Validate the sign-in form.
 * @param {{email: string, password: string}} values
 * @returns {{email?: string, password?: string}} field errors
 */
export function validateLogin({ email, password }) {
  const errors = {}
  if (!email.trim()) errors.email = 'Enter your email address.'
  else if (!isEmail(email)) errors.email = 'Enter a valid email address, like name@acme.example.'
  if (!password) errors.password = 'Enter your password.'
  return errors
}

/**
 * Validate the project form (mirrors the backend rules; the backend re-validates).
 * @param {object} v form values (strings)
 * @returns {Record<string, string>} field errors
 */
export function validateProject(v) {
  const errors = {}
  const name = (v.name || '').trim()
  if (!name) errors.name = 'Enter a project name.'
  else if (name.length < 3 || name.length > 120) errors.name = 'Name must be 3–120 characters.'
  if (!v.department_id) errors.department_id = 'Choose a department.'
  if (!v.pm_user_id) errors.pm_user_id = 'Choose a project manager.'
  if (!v.planned_start) errors.planned_start = 'Enter the planned start date.'
  if (!v.planned_end) errors.planned_end = 'Enter the planned end date.'
  else if (v.planned_start && v.planned_end <= v.planned_start) errors.planned_end = 'End date must be after the start date.'
  const budget = Number(v.approved_budget)
  if (v.approved_budget === '' || v.approved_budget === null || v.approved_budget === undefined) errors.approved_budget = 'Enter the approved budget.'
  else if (!Number.isFinite(budget) || budget <= 0) errors.approved_budget = 'Budget must be a number greater than 0.'
  if (!v.lifecycle_status) errors.lifecycle_status = 'Choose a lifecycle status.'
  if ((v.description || '').length > 4000) errors.description = 'Description must be at most 4000 characters.'
  if ((v.sponsor || '').length > 120) errors.sponsor = 'Sponsor must be at most 120 characters.'
  return errors
}

/**
 * Validate a milestone form.
 * @param {object} v
 * @param {{planned_start?: string, planned_end?: string}} [project]
 * @returns {Record<string, string>}
 */
export function validateMilestone(v, project) {
  const errors = {}
  const name = (v.name || '').trim()
  if (!name) errors.name = 'Enter a milestone name.'
  else if (name.length > 160) errors.name = 'Name must be at most 160 characters.'
  if (!v.due_date) errors.due_date = 'Enter a due date.'
  else if (project?.planned_start && project?.planned_end && (v.due_date < project.planned_start || v.due_date > project.planned_end)) {
    errors.due_date = 'Due date must be within the project dates.'
  }
  if (!v.status) errors.status = 'Choose a status.'
  if (v.percent_complete !== '' && v.percent_complete !== null && v.percent_complete !== undefined) {
    const pct = Number(v.percent_complete)
    if (!Number.isInteger(pct) || pct < 0 || pct > 100) errors.percent_complete = 'Enter a whole number from 0 to 100.'
  }
  return errors
}

/**
 * Validate a task form.
 * @param {object} v
 * @param {{planned_start?: string, planned_end?: string}} [project]
 * @returns {Record<string, string>}
 */
export function validateTask(v, project) {
  const errors = {}
  const title = (v.title || '').trim()
  if (!title) errors.title = 'Enter a task title.'
  else if (title.length > 200) errors.title = 'Title must be at most 200 characters.'
  if (!v.milestone_id) errors.milestone_id = 'Choose a milestone.'
  if (!v.status) errors.status = 'Choose a status.'
  if (v.due_date && project?.planned_start && project?.planned_end && (v.due_date < project.planned_start || v.due_date > project.planned_end)) {
    errors.due_date = 'Due date must be within the project dates.'
  }
  return errors
}
