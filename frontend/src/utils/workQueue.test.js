import { filterItems, relativeTime } from './workQueue'

describe('relativeTime', () => {
  it.each([
    [{ days_overdue: 9 }, '9 days late'],
    [{ days_overdue: 1 }, '1 day late'],
    [{ days_overdue: 0, waiting_days: 3 }, 'waiting 3 days'],
    [{ days_overdue: 0, waiting_days: 0 }, 'waiting since today'],
    [{ days_overdue: 0, waiting_days: null, due_in_days: 2 }, 'due in 2 days'],
    [{ days_overdue: 0, waiting_days: null, due_in_days: 0 }, 'due today'],
    [{ days_overdue: 0, waiting_days: null, due_in_days: null }, ''],
  ])('%j → %s', (item, expected) => {
    expect(relativeTime(item)).toBe(expected)
  })
})

describe('filterItems', () => {
  const items = [
    { id: 'a', severity: 'critical', type: 'PROJECT_RED' },
    { id: 'b', severity: 'high', type: 'APPROVAL_WAITING' },
    { id: 'c', severity: 'due_soon', type: 'PROPOSAL_REJECTED' },
  ]
  it('filters by severity and role chip', () => {
    expect(filterItems(items, 'all', 'PM')).toHaveLength(3)
    expect(filterItems(items, 'critical', 'PM').map((i) => i.id)).toEqual(['a'])
    expect(filterItems(items, 'approvals', 'PM').map((i) => i.id)).toEqual(['b'])
    expect(filterItems(items, 'rework', 'ANALYST').map((i) => i.id)).toEqual(['c'])
    expect(filterItems(items, 'rework', 'PM')).toHaveLength(3) // not this role's chip
  })
})
