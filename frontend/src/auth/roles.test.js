import { can, homeFor, navItemsFor } from './roles'

describe('role capabilities (UI mirror of backend RBAC)', () => {
  it.each([
    ['PMO', 'spend.record', true],
    ['PM', 'spend.record', false], // CONFIRMED: only the Portfolio Manager records spend
    ['ADMIN', 'spend.record', false],
    ['EXEC', 'spend.record', false],
    ['MEMBER', 'spend.record', false],
    ['PM', 'project.edit', true],
    ['PM', 'project.set_baseline', false],
    ['ADMIN', 'project.edit', false],
    ['EXEC', 'plan.edit', false],
    ['ADMIN', 'users.manage', true],
  ])('%s %s -> %s', (role, action, expected) => {
    expect(can(role, action)).toBe(expected)
  })

  it('denies unknown actions', () => {
    expect(can('PMO', 'health.override')).toBe(false)
  })

  it('routes roles home and filters navigation', () => {
    expect(homeFor('ADMIN')).toBe('/users')
    expect(homeFor('UNKNOWN')).toBe('/portfolio')
    expect(navItemsFor('MEMBER').map((i) => i.path)).toEqual(['/my-tasks'])
  })
})
