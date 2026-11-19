/** Role codes, labels, home pages, navigation and UI capabilities, kept in one place. */

export const ROLES = {
  ADMIN: 'ADMIN',
  PMO: 'PMO',
  PM: 'PM',
  ANALYST: 'ANALYST',
  EXEC: 'EXEC',
}

export const ROLE_LABELS = {
  ADMIN: 'Admin',
  PMO: 'Portfolio Manager',
  PM: 'Project Manager',
  ANALYST: 'PM Analyst',
  EXEC: 'Executive',
}

/** Landing page per role: "Your next actions" for everyone. */
export const ROLE_HOME = {
  ADMIN: '/next',
  EXEC: '/next',
  PMO: '/next',
  PM: '/next',
  ANALYST: '/next',
}

/** Roles that may open the portfolio and project pages (the backend filters what each sees). */
// The Admin has no access to project data (lead decision): no Portfolio for ADMIN.
export const PORTFOLIO_ROLES = ['PMO', 'PM', 'EXEC', 'ANALYST']

/** Navigation entries and which roles see them. `icon` is a key resolved by AppShell. */
export const NAV_ITEMS = [
  { path: '/next', label: 'Your next actions', icon: 'next', roles: ['ADMIN', 'PMO', 'PM', 'ANALYST', 'EXEC'] },
  { path: '/approvals', label: 'Approvals', icon: 'approvals', roles: ['PM'] },
  { path: '/my-proposals', label: 'My proposals', icon: 'proposals', roles: ['ANALYST'] },
  { path: '/portfolio', label: 'Portfolio', icon: 'portfolio', roles: PORTFOLIO_ROLES },
  { path: '/people', label: 'People', icon: 'people', roles: ['PMO', 'PM', 'EXEC'] },
  { path: '/users', label: 'Users', icon: 'users', roles: ['ADMIN'] },
]

/**
 * Navigation items visible to a role.
 * @param {string} role
 * @returns {Array<{path: string, label: string, icon: string}>}
 */
export function navItemsFor(role) {
  return NAV_ITEMS.filter((item) => item.roles.includes(role))
}

/** @returns {string} home path for a role (falls back to /next) */
export function homeFor(role) {
  return ROLE_HOME[role] || '/next'
}

/**
 * UI capability map: mirrors backend/_shared/beacon/rbac.py so screens can hide or disable
 * actions a role cannot perform. COSMETIC ONLY: the backend enforces every permission.
 * Use this for GLOBAL decisions (navigation, "New project"). Per-project decisions must use the
 * server-computed, ownership-aware `project.permissions` object instead.
 */
export const CAPABILITIES = {
  'users.manage': ['ADMIN'],
  'project.create': ['PMO'],
  'project.set_baseline': ['PMO'],
  'project.archive': ['PMO'],
  'project.edit': ['PMO', 'PM'],
  'plan.edit': ['PMO', 'PM'],
  'allocation.edit': ['PMO', 'PM'],
  'spend.record': ['PMO'], // Only the Portfolio Manager records actual spend (CONFIRMED)
  'status_update.submit': ['PM'],
  'health_rules.edit': ['PMO'],
  'change_request.propose': ['ANALYST'], // PM Analysts propose; nothing applies until approved (CONFIRMED)
  'change_request.decide': ['PM'], // only the project's own PM decides (backend checks ownership)
  'analyst.assign': ['PMO', 'PM'],
  'audit.read': ['ADMIN', 'PMO', 'PM'],
}

/**
 * Whether a role may perform an action (UI hint only).
 * @param {string} role
 * @param {string} action key of CAPABILITIES
 * @returns {boolean}
 */
export function can(role, action) {
  return (CAPABILITIES[action] || []).includes(role)
}
