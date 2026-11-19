import { ROLE_LABELS, can, homeFor, navItemsFor } from './roles'

describe('role capabilities (UI mirror of backend RBAC)', () => {
  it.each([
    ['PMO', 'spend.record', true],
    ['PM', 'spend.record', false], // CONFIRMED: only the Portfolio Manager records spend
    ['ADMIN', 'spend.record', false],
    ['EXEC', 'spend.record', false],
    ['ANALYST', 'spend.record', false],
    ['PM', 'project.edit', true],
    ['PM', 'project.set_baseline', false],
    ['ADMIN', 'project.edit', false],
    ['EXEC', 'plan.edit', false],
    ['ANALYST', 'plan.edit', false], // analysts propose, never edit directly
    ['ANALYST', 'project.edit', false],
    ['ANALYST', 'change_request.propose', true],
    ['PM', 'change_request.propose', false],
    ['PM', 'change_request.decide', true],
    ['PMO', 'change_request.decide', false],
    ['ANALYST', 'change_request.decide', false],
    ['PM', 'analyst.assign', true],
    ['ANALYST', 'audit.read', false],
    ['ADMIN', 'users.manage', true],
  ])('%s %s -> %s', (role, action, expected) => {
    expect(can(role, action)).toBe(expected)
  })

  it('denies unknown actions', () => {
    expect(can('PMO', 'health.override')).toBe(false)
  })

  it('replaces Team member with PM Analyst', () => {
    expect(ROLE_LABELS.ANALYST).toBe('PM Analyst')
    expect(ROLE_LABELS.MEMBER).toBeUndefined()
  })

  it('routes roles home and filters navigation', () => {
    expect(homeFor('ADMIN')).toBe('/users')
    expect(homeFor('PM')).toBe('/home')
    expect(homeFor('ANALYST')).toBe('/my-proposals')
    expect(homeFor('UNKNOWN')).toBe('/portfolio')
    expect(navItemsFor('ANALYST').map((i) => i.path)).toEqual(['/my-proposals', '/portfolio'])
    expect(navItemsFor('PM').map((i) => i.path)).toEqual(['/home', '/approvals', '/portfolio', '/people'])
    expect(navItemsFor('EXEC').map((i) => i.path)).toEqual(['/portfolio', '/people'])
  })
})

describe('People navigation', () => {
  it('shows People for PMO, PM and Executive only', () => {
    expect(navItemsFor('PMO').map((i) => i.path)).toContain('/people')
    expect(navItemsFor('PM').map((i) => i.path)).toContain('/people')
    expect(navItemsFor('EXEC').map((i) => i.path)).toContain('/people')
    expect(navItemsFor('ADMIN').map((i) => i.path)).not.toContain('/people')
    expect(navItemsFor('ANALYST').map((i) => i.path)).not.toContain('/people')
  })
})
