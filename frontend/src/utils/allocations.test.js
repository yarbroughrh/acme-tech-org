import { loadLabel, validateAllocation } from './allocations'

const project = { planned_start: '2026-01-01', planned_end: '2026-12-31' }

describe('loadLabel', () => {
  it.each([
    ['UNDER', 24, 'Available 16h'],
    ['OK', 40, 'Fully allocated'],
    ['OVER', 46, 'Over-allocated +6h'],
    ['SEVERE', 61, 'Severely over-allocated +21h'],
  ])('%s %s h -> %s', (status, hours, text) => expect(loadLabel(status, hours)).toBe(text))
})

describe('validateAllocation', () => {
  const ok = { person: { id: 'p' }, hours: '20', start: '2026-02-01', end: '2026-06-30' }
  it('accepts valid values', () => expect(validateAllocation(ok, project, false)).toEqual({}))
  it.each([['0.4'], ['168.5'], [''], ['abc']])('rejects hours %s', (hours) => {
    expect(validateAllocation({ ...ok, hours }, project, false)).toHaveProperty('hours')
  })
  it.each([['0.5'], ['168']])('accepts boundary hours %s', (hours) => {
    expect(validateAllocation({ ...ok, hours }, project, false)).toEqual({})
  })
  it('requires a person only when adding', () => {
    expect(validateAllocation({ ...ok, person: null }, project, false)).toHaveProperty('person')
    expect(validateAllocation({ ...ok, person: null }, project, true)).toEqual({})
  })
  it('requires dates within the project and end on or after start', () => {
    expect(validateAllocation({ ...ok, start: '2025-12-31' }, project, false)).toHaveProperty('start')
    expect(validateAllocation({ ...ok, end: '2027-01-01' }, project, false)).toHaveProperty('end')
    expect(validateAllocation({ ...ok, start: '2026-05-01', end: '2026-04-01' }, project, false).end).toMatch(/on or after/)
    expect(validateAllocation({ ...ok, start: '' }, project, false)).toHaveProperty('start')
  })
})
