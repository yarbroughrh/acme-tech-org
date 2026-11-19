import { useState } from 'react'
import PropTypes from 'prop-types'
import { NavLink, useLocation } from 'react-router-dom'
import {
  AppBar, Badge, Box, Chip, Divider, Drawer, IconButton, List, ListItemButton, ListItemIcon,
  ListItemText, Toolbar, Tooltip, Typography, useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { visuallyHidden } from '@mui/utils'
import MenuIcon from '@mui/icons-material/Menu'
import LogoutIcon from '@mui/icons-material/Logout'
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined'
import AssignmentOutlinedIcon from '@mui/icons-material/AssignmentOutlined'
import PeopleOutlinedIcon from '@mui/icons-material/PeopleOutlined'
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined'
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined'
import ManageAccountsOutlinedIcon from '@mui/icons-material/ManageAccountsOutlined'
import ChecklistOutlinedIcon from '@mui/icons-material/ChecklistOutlined'
import { useAuth } from '../auth/AuthContext'
import { ROLE_LABELS, navItemsFor } from '../auth/roles'
import { WorkQueueProvider, useWorkQueue } from './WorkQueueProvider'

const DRAWER_WIDTH = 232
const ICONS = {
  next: ChecklistOutlinedIcon,
  home: HomeOutlinedIcon,
  approvals: FactCheckOutlinedIcon,
  proposals: AssignmentOutlinedIcon,
  portfolio: DashboardOutlinedIcon,
  users: ManageAccountsOutlinedIcon,
  people: PeopleOutlinedIcon,
}

/**
 * Application frame: app bar, role-filtered navigation (permanent drawer on desktop,
 * temporary drawer on small screens) and a skip link to the main content.
 */
/**
 * Badge counts for navigation entries, from the shared work queue: critical + high actions on
 * "Your next actions"; approvals waiting on "Approvals".
 * @returns {Record<string, number>}
 */
function useNavBadges() {
  const queue = useWorkQueue()
  const data = queue?.data
  if (!data) return {}
  return {
    '/next': (data.counts?.critical || 0) + (data.counts?.high || 0),
    '/approvals': (data.items || []).filter((i) => i.type === 'APPROVAL_WAITING').length,
  }
}

/** Application frame with the shared work-queue provider (refreshed on every route change). */
export default function AppShell({ children }) {
  return <WorkQueueProvider><Frame>{children}</Frame></WorkQueueProvider>
}


function Frame({ children }) {
  const theme = useTheme()
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'))
  const [mobileOpen, setMobileOpen] = useState(false)
  const { user, logout } = useAuth()
  const location = useLocation()
  const items = navItemsFor(user?.role)
  const badges = useNavBadges()

  const nav = (
    <Box component="nav" aria-label="Main navigation">
      <Toolbar />
      <List>
        {items.map((item) => {
          const Icon = ICONS[item.icon]
          const selected = location.pathname.startsWith(item.path)
          return (
            <ListItemButton
              key={item.path}
              component={NavLink}
              to={item.path}
              selected={selected}
              aria-current={selected ? 'page' : undefined}
              onClick={() => setMobileOpen(false)}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>
                {badges[item.path] ? (
                  <Badge badgeContent={badges[item.path]} color="error" max={99} aria-hidden="true">
                    <Icon />
                  </Badge>
                ) : <Icon aria-hidden="true" />}
              </ListItemIcon>
              <ListItemText
                primary={item.label}
                secondary={badges[item.path] ? <Box component="span" sx={visuallyHidden}>{`${badges[item.path]} need attention`}</Box> : null}
              />
            </ListItemButton>
          )
        })}
      </List>
      <Divider />
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Box
        component="a"
        href="#main-content"
        onClick={(e) => { e.preventDefault(); document.getElementById('main-content')?.focus() }}
        sx={{
          position: 'absolute', left: -9999, top: 8, zIndex: 2000, bgcolor: 'background.paper', p: 1,
          '&:focus': { left: 8 },
        }}
      >
        Skip to content
      </Box>
      <AppBar position="fixed" sx={{ zIndex: (t) => t.zIndex.drawer + 1 }}>
        <Toolbar sx={{ gap: 1 }}>
          {!isDesktop && (
            <IconButton color="inherit" edge="start" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
              <MenuIcon />
            </IconButton>
          )}
          <Typography variant="h3" component="span" sx={{ flexGrow: 1, color: 'inherit' }}>Beacon</Typography>
          {user && (
            <>
              <Box sx={{ display: { xs: 'none', sm: 'block' }, textAlign: 'right' }}>
                <Typography variant="body2" sx={{ color: 'inherit' }}>{user.display_name}</Typography>
              </Box>
              <Chip
                size="small"
                label={ROLE_LABELS[user.role] || user.role}
                sx={{ bgcolor: 'rgba(255,255,255,0.16)', color: 'inherit' }}
              />
              <Tooltip title="Sign out">
                <IconButton color="inherit" aria-label="Sign out" onClick={logout}>
                  <LogoutIcon />
                </IconButton>
              </Tooltip>
            </>
          )}
        </Toolbar>
      </AppBar>
      {isDesktop ? (
        <Drawer
          variant="permanent"
          sx={{ width: DRAWER_WIDTH, flexShrink: 0, '& .MuiDrawer-paper': { width: DRAWER_WIDTH, boxSizing: 'border-box' } }}
        >
          {nav}
        </Drawer>
      ) : (
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{ '& .MuiDrawer-paper': { width: DRAWER_WIDTH } }}
        >
          {nav}
        </Drawer>
      )}
      <Box
        component="main"
        id="main-content"
        tabIndex={-1}
        sx={{ flexGrow: 1, minWidth: 0, p: { xs: 2, md: 3 }, outline: 'none' }}
      >
        <Toolbar />
        {children}
      </Box>
    </Box>
  )
}

AppShell.propTypes = { children: PropTypes.node.isRequired }

Frame.propTypes = { children: PropTypes.node.isRequired }
