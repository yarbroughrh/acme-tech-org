import { useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Accordion, AccordionDetails, AccordionSummary, Box, Button, Chip, Skeleton, Stack, Typography,
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { useAuth } from '../auth/AuthContext'
import { useWorkQueue } from '../components/WorkQueueProvider'
import WorkItem from '../components/WorkItem'
import ExecutiveDashboard from '../components/ExecutiveDashboard'
import { EmptyState, ErrorState } from '../components/PageState'
import { ROLE_CHIPS, SEVERITY_META, SEVERITY_ORDER, filterItems } from '../utils/workQueue'

/** Skeleton cards while the queue loads. */
function QueueSkeleton() {
  return (
    <Stack spacing={1.5} role="status" aria-live="polite" aria-label="Loading your next actions">
      {[0, 1, 2].map((i) => <Skeleton key={i} variant="rounded" height={120} />)}
    </Stack>
  )
}

/**
 * "Your next actions": the landing page for every role. A ranked list of what needs the user's
 * attention, each item with one action. Executives see the queue as "Off track" with the
 * portfolio dashboard below; the Portfolio Manager gets the dashboard as a "Portfolio overview".
 */
export default function NextActionsPage() {
  const { user } = useAuth()
  const queue = useWorkQueue()
  const [filter, setFilter] = useState('all')
  const [overviewOpen, setOverviewOpen] = useState(false)
  const role = user?.role
  const isExec = role === 'EXEC'
  const showDashboard = role === 'EXEC' || role === 'PMO'
  const data = queue?.data
  const items = data?.items || []
  const counts = data?.counts || { critical: 0, high: 0, due_soon: 0, total: 0 }
  const overdue = items.filter((i) => i.days_overdue > 0).length
  const shown = filterItems(items, filter, role)
  const roleChip = ROLE_CHIPS[role]

  let body
  if (!queue || (queue.loading && !data)) body = <QueueSkeleton />
  else if (queue.error && !data) body = <ErrorState message={queue.error.message} onRetry={queue.reload} />
  else if (!items.length) {
    body = (
      <EmptyState
        title="You're all caught up"
        description="Nothing needs your attention right now. New items appear here as soon as they do."
        action={role === 'ADMIN'
          ? <Button component={RouterLink} to="/users" variant="outlined">Go to user management</Button>
          : <Button component={RouterLink} to="/portfolio" variant="outlined">Go to the portfolio</Button>}
      />
    )
  } else if (!shown.length) {
    body = <EmptyState title="Nothing in this filter" description="Choose All to see every action." />
  } else {
    body = (
      <Stack spacing={1.5} component="section" aria-label="Actions">
        {shown.map((item) => <WorkItem key={item.id} item={item} onChanged={queue.reload} />)}
      </Stack>
    )
  }

  const chip = (key, label, count) => (
    <Chip
      key={key}
      label={count === undefined ? label : `${label} (${count})`}
      clickable
      color={filter === key ? 'primary' : 'default'}
      variant={filter === key ? 'filled' : 'outlined'}
      onClick={() => setFilter(key)}
      aria-pressed={filter === key}
    />
  )

  return (
    <>
      <Typography variant="h1" component="h1">Your next actions</Typography>
      {data && (
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          {`${counts.total} action${counts.total === 1 ? '' : 's'}${overdue ? ` · ${overdue} overdue` : ''}`}
        </Typography>
      )}
      {isExec && <Typography variant="h2" component="h2" sx={{ mt: 2 }}>Off track</Typography>}
      <Stack direction="row" spacing={1} sx={{ my: 2, overflowX: 'auto', pb: 0.5 }} role="group" aria-label="Filter actions">
        {chip('all', 'All', counts.total)}
        {SEVERITY_ORDER.map((s) => chip(s, SEVERITY_META[s].label, counts[s]))}
        {roleChip && chip(roleChip.key, roleChip.label, items.filter((i) => i.type === roleChip.type).length)}
      </Stack>
      {body}
      {isExec && (
        <Box sx={{ mt: 4 }}>
          <ExecutiveDashboard heading="Portfolio dashboard" />
        </Box>
      )}
      {showDashboard && !isExec && (
        <Accordion sx={{ mt: 4 }} expanded={overviewOpen} onChange={(_e, open) => setOverviewOpen(open)}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />} aria-controls="portfolio-overview" id="portfolio-overview-header">
            <Typography variant="h2" component="h2">Portfolio overview</Typography>
          </AccordionSummary>
          <AccordionDetails id="portfolio-overview">
            {overviewOpen && <ExecutiveDashboard heading="Dashboard" />}
          </AccordionDetails>
        </Accordion>
      )}
    </>
  )
}
