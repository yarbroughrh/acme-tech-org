import { useState } from 'react'
import PropTypes from 'prop-types'
import { Box, Paper, Stack, TablePagination, Typography } from '@mui/material'
import { listProjectAudit } from '../../api/audit'
import { EmptyState, ErrorState, LoadingState } from '../../components/PageState'
import useApiQuery from '../../utils/useApiQuery'
import { FIELD_LABELS, formatDateTime, formatFieldValue } from '../../utils/format'

const PAGE_SIZE = 20

/** Compact "field: before → after" lines for changed fields. */
export function AuditDiff({ before, after, entityType }) {
  const keys = Array.from(new Set([...Object.keys(before || {}), ...Object.keys(after || {})]))
  if (!keys.length) return null
  return (
    <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
      {keys.map((k) => (
        <Typography component="li" variant="body2" key={k}>
          <strong>{FIELD_LABELS[k] || k.replace(/_/g, ' ')}</strong>
          {before && k in before ? `: ${formatFieldValue(k, before[k], entityType)} → ` : ': '}
          {after && k in after ? formatFieldValue(k, after[k], entityType) : '—'}
        </Typography>
      ))}
    </Box>
  )
}

AuditDiff.propTypes = { before: PropTypes.object, after: PropTypes.object, entityType: PropTypes.string }

const humanise = (s) => String(s || '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase())

/** Project audit log: who changed what, when, before and after (server-side pagination). */
export default function AuditTab({ project }) {
  const [page, setPage] = useState(0)
  const state = useApiQuery(() => listProjectAudit(project.id, { page: page + 1, page_size: PAGE_SIZE }), `${project.id}|${page}`)
  const items = state.data?.items || []
  const total = state.data?.total || 0

  if (state.loading && !state.data) return <LoadingState rows={4} label="Loading audit log" />
  if (state.error) return <ErrorState message={state.error.message} onRetry={state.reload} />
  if (!items.length) return <Paper><EmptyState title="No audit entries yet" /></Paper>
  return (
    <Paper sx={{ p: { xs: 1.5, md: 2 } }}>
      <Stack spacing={1.5} component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }} aria-label="Audit log">
        {items.map((e) => (
          <Box component="li" key={e.id} sx={{ borderBottom: 1, borderColor: 'divider', pb: 1.5 }}>
            <Typography variant="body2" color="text.secondary">
              {`${formatDateTime(e.at)} · ${e.actor?.display_name || 'System'}`}
            </Typography>
            <Typography sx={{ fontWeight: 600 }}>{`${humanise(e.action)} · ${humanise(e.entity_type)}`}</Typography>
            <AuditDiff before={e.before} after={e.after} entityType={String(e.entity_type || '').toUpperCase()} />
          </Box>
        ))}
      </Stack>
      <TablePagination component="div" count={total} page={page} rowsPerPage={PAGE_SIZE} rowsPerPageOptions={[PAGE_SIZE]} onPageChange={(_e, p) => setPage(p)} />
    </Paper>
  )
}

AuditTab.propTypes = { project: PropTypes.object.isRequired }
