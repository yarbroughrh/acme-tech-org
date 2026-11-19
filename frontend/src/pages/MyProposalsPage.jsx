import { useState } from 'react'
import PropTypes from 'prop-types'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import {
  Alert, Box, Card, CardContent, Chip, Link, Paper, Stack, Tab, TablePagination, Tabs, Typography, useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { listChangeRequests } from '../api/changeRequests'
import ChangeDiff from '../components/ChangeDiff'
import { EmptyState, ErrorState, LoadingState } from '../components/PageState'
import useApiQuery from '../utils/useApiQuery'
import { CHANGE_STATUS_LABELS, ENTITY_LABELS, formatDateTime } from '../utils/format'

const STATUSES = ['PENDING', 'APPROVED', 'REJECTED']
const STATUS_COLORS = { PENDING: 'warning', APPROVED: 'success', REJECTED: 'error' }
const PAGE_SIZE = 20

/** One of the analyst's proposals. */
function ProposalCard({ proposal, compact }) {
  return (
    <Card variant="outlined" data-testid="proposal-item">
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h3" component="h2">
              {`${ENTITY_LABELS[proposal.entity_type] || proposal.entity_type}: ${proposal.entity_name || ''}`}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              <Link component={RouterLink} to={`/portfolio/${proposal.project?.id}`}>{proposal.project?.name}</Link>
              {` · sent ${formatDateTime(proposal.created_at)}`}
            </Typography>
          </Box>
          <Chip size="small" label={CHANGE_STATUS_LABELS[proposal.status] || proposal.status} color={STATUS_COLORS[proposal.status]} variant="outlined" />
        </Stack>
        <Box sx={{ mt: 1.5, overflowX: 'auto' }}>
          <ChangeDiff
            changes={proposal.changes} current={proposal.current} entityType={proposal.entity_type} compact={compact}
            currentLabel="At the time" proposedLabel="Proposed"
          />
        </Box>
        {proposal.status === 'REJECTED' && (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            <strong>Reason: </strong>{proposal.reason || 'No reason given.'}
          </Alert>
        )}
        {proposal.status !== 'PENDING' && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {`${proposal.status === 'APPROVED' ? 'Approved' : 'Rejected'} by ${proposal.decided_by?.display_name || 'the project manager'} · ${formatDateTime(proposal.decided_at)}`}
          </Typography>
        )}
      </CardContent>
    </Card>
  )
}

ProposalCard.propTypes = { proposal: PropTypes.object.isRequired, compact: PropTypes.bool }

/** PM Analyst home: their proposals by status, with the PM's reason for rejections. */
export default function MyProposalsPage() {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'))
  const [params] = useSearchParams()
  const initial = params.get('status')
  const [status, setStatus] = useState(CHANGE_STATUS_LABELS[initial] ? initial : 'PENDING')
  const [page, setPage] = useState(0)
  const state = useApiQuery(
    () => listChangeRequests({ view: 'mine', status, page: page + 1, page_size: PAGE_SIZE }),
    `${status}|${page}`,
  )
  const items = state.data?.items || []
  const total = state.data?.total || 0

  let body
  if (state.loading && !state.data) body = <LoadingState rows={3} label="Loading proposals" />
  else if (state.error) body = <ErrorState message={state.error.message} onRetry={state.reload} />
  else if (!items.length) {
    body = (
      <EmptyState
        title={`No ${CHANGE_STATUS_LABELS[status].toLowerCase()} proposals`}
        description="Open one of your projects and choose Propose change on a milestone or task."
      />
    )
  } else body = <Stack spacing={1.5}>{items.map((p) => <ProposalCard key={p.id} proposal={p} compact={isMobile} />)}</Stack>

  return (
    <>
      <Typography variant="h1" component="h1" sx={{ mb: 1 }}>My proposals</Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>
        Your proposed changes take effect only when the project manager approves them.
      </Typography>
      <Paper sx={{ mb: 2 }}>
        <Tabs
          value={status} onChange={(_e, v) => { setStatus(v); setPage(0) }} aria-label="Proposal status"
          variant="fullWidth"
        >
          {STATUSES.map((s) => <Tab key={s} value={s} label={CHANGE_STATUS_LABELS[s]} />)}
        </Tabs>
      </Paper>
      <Box aria-busy={state.loading}>{body}</Box>
      {total > PAGE_SIZE && (
        <Paper sx={{ mt: 1.5 }}>
          <TablePagination component="div" count={total} page={page} rowsPerPage={PAGE_SIZE} rowsPerPageOptions={[PAGE_SIZE]} onPageChange={(_e, p) => setPage(p)} />
        </Paper>
      )}
    </>
  )
}
