import { changedFields, fieldErrorsFrom, isConflict, saveErrorMessage } from './forms'
import { validateMilestone, validateProject, validateTask } from './validation'

describe('form helpers', () => {
  it('maps server details to the first message per field', () => {
    expect(fieldErrorsFrom({ details: [{ field: 'a', message: 'one' }, { field: 'a', message: 'two' }, { message: 'no field' }] })).toEqual({ a: 'one' })
    expect(fieldErrorsFrom(null)).toEqual({})
  })

  it('describes conflicts with who changed the record', () => {
    const conflict = { status: 409, message: 'Changed by someone else.', details: [{ field: 'version', message: 'Changed by Jordan Lee.' }] }
    expect(isConflict(conflict)).toBe(true)
    expect(saveErrorMessage(conflict)).toBe('Changed by someone else. Changed by Jordan Lee.')
    expect(saveErrorMessage({ status: 409, message: 'Conflict.' })).toBe('Conflict.')
    expect(saveErrorMessage({ status: 400 })).toBe('The change could not be saved.')
    expect(saveErrorMessage(null)).toBe('')
  })

  it('keeps only changed fields, treating empty as null', () => {
    expect(changedFields({ a: 'x ', b: '', c: 1 }, { a: 'x', b: null, c: 2 })).toEqual({ c: 1 })
  })
})

describe('validators', () => {
  const ok = { name: 'Valid name', department_id: 'd', pm_user_id: 'u', planned_start: '2026-01-01', planned_end: '2026-02-01', approved_budget: '10', lifecycle_status: 'ACTIVE' }

  it('accepts a valid project and rejects boundaries', () => {
    expect(validateProject(ok)).toEqual({})
    expect(validateProject({ ...ok, name: 'x'.repeat(121) }).name).toBeTruthy()
    expect(validateProject({ ...ok, name: 'abc' }).name).toBeUndefined()
    expect(validateProject({ ...ok, planned_end: '2026-01-01' }).planned_end).toBeTruthy()
    expect(validateProject({ ...ok, approved_budget: '' }).approved_budget).toBe('Enter the approved budget.')
    expect(validateProject({ ...ok, approved_budget: 'abc' }).approved_budget).toBeTruthy()
    expect(validateProject({ ...ok, lifecycle_status: '', planned_start: '', planned_end: '' })).toMatchObject({ lifecycle_status: expect.any(String), planned_start: expect.any(String), planned_end: expect.any(String) })
    expect(validateProject({ ...ok, description: 'x'.repeat(4001), sponsor: 'y'.repeat(121) })).toMatchObject({ description: expect.any(String), sponsor: expect.any(String) })
  })

  it('validates milestones and tasks', () => {
    const project = { planned_start: '2026-01-01', planned_end: '2026-12-31' }
    expect(validateMilestone({ name: 'M', due_date: '2026-05-01', status: 'NOT_STARTED', percent_complete: '' }, project)).toEqual({})
    expect(validateMilestone({ name: 'x'.repeat(161), due_date: '', status: '', percent_complete: '5.5' }, project)).toMatchObject({ name: expect.any(String), due_date: expect.any(String), status: expect.any(String), percent_complete: expect.any(String) })
    expect(validateTask({ title: 'T', milestone_id: 'm', status: 'TODO', due_date: '' }, project)).toEqual({})
    expect(validateTask({ title: 'x'.repeat(201), milestone_id: '', status: '', due_date: '2027-01-01' }, project)).toMatchObject({ title: expect.any(String), milestone_id: expect.any(String), status: expect.any(String), due_date: expect.any(String) })
  })
})
