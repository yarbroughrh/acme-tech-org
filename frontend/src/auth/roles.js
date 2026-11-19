/** Role codes, labels, home pages and navigation, kept in one place. */

export const ROLES = {
  ADMIN: 'ADMIN',
  PMO: 'PMO',
  PM: 'PM',
  MEMBER: 'MEMBER',
  EXEC: 'EXEC',
}

export const ROLE_LABELS = {
  ADMIN: 'Admin',
  PMO: 'Portfolio Manager',
  PM: 'Project Manager',
  MEMBER: 'Team member',
  EXEC: 'Executive',
}

/** Landing page per role (later slices replace /portfolio with dashboards/queues). */
export const ROLE_HOME = {
  ADMIN: '/users',
  EXEC: '/portfolio',
  PMO: '/portfolio',
  PM: '/portfolio',
  MEMBER: '/my-tasks',
}

/** Navigation entries and which roles see them. `icon` is a key resolved by AppShell. */
export const NAV_ITEMS = [
  { path: '/portfolio', label: 'Portfolio', icon: 'portfolio', roles: ['ADMIN', 'PMO', 'PM', 'EXEC'] },
  { path: '/my-tasks', label: 'My tasks', icon: 'tasks', roles: ['MEMBER'] },
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

/** @returns {string} home path for a role (falls back to /portfolio) */
export function homeFor(role) {
  return ROLE_HOME[role] || '/portfolio'
}
