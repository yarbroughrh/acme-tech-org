import PropTypes from 'prop-types'
import { Box, Paper, Stack, Typography } from '@mui/material'
import HealthBadge from '../../components/HealthBadge'
import LifecycleChip from '../../components/LifecycleChip'
import { PRIORITY_LABELS, formatDate, formatDateTime, formatPct, formatUsd } from '../../utils/format'

/** Label/value pair in a definition grid. */
export function Field({ label, children }) {
  return (
    <Box>
      <Typography variant="body2" color="text.secondary" component="dt">{label}</Typography>
      <Typography component="dd" sx={{ m: 0 }}>{children || '—'}</Typography>
    </Box>
  )
}

Field.propTypes = { label: PropTypes.string.isRequired, children: PropTypes.node }

const DIMENSIONS = [
  { key: 'schedule', label: 'Schedule' },
  { key: 'budget', label: 'Budget' },
  { key: 'milestones', label: 'Milestones' },
]

/** Calculated health: one row per dimension, the key metrics, and every reason. */
function HealthPanel({ project }) {
  const health = project.health
  if (project.lifecycle_status !== 'ACTIVE') {
    return (
      <Paper sx={{ p: { xs: 2, md: 3 }, mb: 2 }}>
        <Typography variant="h2" component="h2" gutterBottom>Health</Typography>
        <Typography color="text.secondary">
          Health is calculated for Active projects only. This project is shown by its lifecycle status.
        </Typography>
      </Paper>
    )
  }
  if (!health) {
    return (
      <Paper sx={{ p: { xs: 2, md: 3 }, mb: 2 }}>
        <Typography variant="h2" component="h2" gutterBottom>Health</Typography>
        <Typography color="text.secondary">Health has not been calculated yet.</Typography>
      </Paper>
    )
  }
  const m = health.metrics || {}
  return (
    <Paper sx={{ p: { xs: 2, md: 3 }, mb: 2 }} component="section" aria-labelledby="health-heading">
      <Typography id="health-heading" variant="h2" component="h2" gutterBottom>Health</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Calculated from approved project data by the portfolio rules. Nobody can override it.
      </Typography>
      <Stack spacing={1.5} sx={{ mb: 2 }}>
        {DIMENSIONS.map(({ key, label }) => {
          const dim = health.dimensions?.[key]
          return (
            <Stack key={key} direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0.5, sm: 2 }} alignItems={{ sm: 'center' }}>
              <Typography sx={{ fontWeight: 600, minWidth: 110 }}>{label}</Typography>
              <Box sx={{ minWidth: 150 }}><HealthBadge health={dim?.status || null} size="small" /></Box>
              <Typography variant="body2">{dim?.summary || '—'}</Typography>
            </Stack>
          )
        })}
      </Stack>
      <Box component="dl" sx={{ m: 0, mb: 2, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' } }}>
        <Field label="Time elapsed">{formatPct(m.elapsed_pct)}</Field>
        <Field label="Progress">{formatPct(m.progress_pct)}</Field>
        <Field label="Spend to date vs plan">{`${formatUsd(m.spend_to_date)} / ${formatUsd(m.planned_spend_to_date)}`}</Field>
        <Field label="Budget spent">{formatPct(m.budget_spent_pct)}</Field>
      </Box>
      {health.reasons?.length > 0 && (
        <>
          <Typography variant="h3" component="h3" gutterBottom>Why this status</Typography>
          <Box component="ul" sx={{ m: 0, pl: 3 }}>
            {health.reasons.map((r) => <li key={r}><Typography>{r}</Typography></li>)}
          </Box>
        </>
      )}
    </Paper>
  )
}

HealthPanel.propTypes = { project: PropTypes.object.isRequired }

/** Overview tab: health panel and project details. */
export default function OverviewTab({ project: p }) {
  return (
    <>
      <HealthPanel project={p} />
      <Paper sx={{ p: { xs: 2, md: 3 } }} component="section" aria-label="Project details">
        <Box component="dl" sx={{ m: 0, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)' } }}>
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

OverviewTab.propTypes = { project: PropTypes.object.isRequired }
