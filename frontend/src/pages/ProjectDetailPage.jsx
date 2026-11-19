import PropTypes from 'prop-types'
import { Link as RouterLink, useParams } from 'react-router-dom'
import { Box, Breadcrumbs, Button, Link, Paper, Stack, Typography } from '@mui/material'
import { getProject } from '../api/projects'
import HealthBadge from '../components/HealthBadge'
import LifecycleChip from '../components/LifecycleChip'
import { EmptyState, ErrorState, LoadingState } from '../components/PageState'
import useApiQuery from '../utils/useApiQuery'
import { PRIORITY_LABELS, formatDate, formatDateTime, formatUsd } from '../utils/format'

/** Label/value pair in the details grid. */
function Field({ label, children }) {
  return (
    <Box>
      <Typography variant="body2" color="text.secondary" component="dt">{label}</Typography>
      <Typography component="dd" sx={{ m: 0 }}>{children || '—'}</Typography>
    </Box>
  )
}

Field.propTypes = { label: PropTypes.string.isRequired, children: PropTypes.node }

/** Read-only project details (editing arrives in slice 2). */
export default function ProjectDetailPage() {
  const { id } = useParams()
  const query = useApiQuery(() => getProject(id), id)
  const state = { loading: query.loading, error: query.error, project: query.data?.project }

  const crumbs = (
    <Breadcrumbs sx={{ mb: 1 }}>
      <Link component={RouterLink} to="/portfolio">Portfolio</Link>
      <Typography color="text.primary">{state.project?.name || 'Project'}</Typography>
    </Breadcrumbs>
  )

  if (state.loading) return <>{crumbs}<LoadingState rows={6} label="Loading project" /></>
  if (state.error?.status === 404) {
    return (
      <>
        {crumbs}
        <Paper>
          <EmptyState
            title="Project not found"
            description="It may have been archived, or the link is wrong."
            action={<Button component={RouterLink} to="/portfolio" variant="contained">Back to portfolio</Button>}
          />
        </Paper>
      </>
    )
  }
  if (state.error) return <>{crumbs}<ErrorState message={state.error.message} onRetry={query.reload} /></>

  const p = state.project
  return (
    <>
      {crumbs}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} sx={{ mb: 2 }}>
        <Typography variant="h1" component="h1" sx={{ flexGrow: 1 }}>{p.name}</Typography>
        <HealthBadge health={p.health_overall} reasons={p.health_reasons || []} lifecycleStatus={p.lifecycle_status} />
      </Stack>
      {p.health_reasons?.length > 0 && (
        <Paper sx={{ p: 2, mb: 2 }}>
          <Typography variant="h3" component="h2" gutterBottom>Why this status</Typography>
          <Box component="ul" sx={{ m: 0, pl: 3 }}>
            {p.health_reasons.map((r) => <li key={r}><Typography>{r}</Typography></li>)}
          </Box>
        </Paper>
      )}
      <Paper sx={{ p: { xs: 2, md: 3 } }}>
        <Box
          component="dl"
          sx={{ m: 0, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)' } }}
        >
          <Field label="Department">{p.department?.name}</Field>
          <Field label="Project manager">{p.pm?.display_name}</Field>
          <Field label="Sponsor">{p.sponsor}</Field>
          <Field label="Status"><LifecycleChip status={p.lifecycle_status} /></Field>
          <Field label="Priority">{PRIORITY_LABELS[p.priority] || p.priority}</Field>
          <Field label="Approved budget">{formatUsd(p.approved_budget)}</Field>
          <Field label="Planned start">{formatDate(p.planned_start)}</Field>
          <Field label="Planned end">{formatDate(p.planned_end)}</Field>
          <Field label="Actual start">{p.actual_start ? formatDate(p.actual_start) : null}</Field>
          <Field label="Last updated">{formatDateTime(p.updated_at)}</Field>
        </Box>
        {p.description && (
          <Box sx={{ mt: 3 }}>
            <Typography variant="body2" color="text.secondary">Description</Typography>
            <Typography sx={{ whiteSpace: 'pre-line' }}>{p.description}</Typography>
          </Box>
        )}
      </Paper>
    </>
  )
}
