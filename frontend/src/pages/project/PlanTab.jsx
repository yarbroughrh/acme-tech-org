import { Fragment, useState } from 'react'
import PropTypes from 'prop-types'
import {
  Box, Button, Card, CardContent, Chip, Collapse, IconButton, LinearProgress, Paper, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography, useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import AddIcon from '@mui/icons-material/Add'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined'
import RateReviewOutlinedIcon from '@mui/icons-material/RateReviewOutlined'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp'
import { deleteMilestone, listMilestones } from '../../api/milestones'
import { deleteTask, listTasks } from '../../api/tasks'
import { getTeam } from '../../api/projects'
import ConfirmDialog from '../../components/ConfirmDialog'
import ProposeChangeDialog from '../../components/ProposeChangeDialog'
import { useNotify } from '../../components/NotifyProvider'
import { EmptyState, ErrorState, LoadingState } from '../../components/PageState'
import useApiQuery from '../../utils/useApiQuery'
import { MILESTONE_STATUS_LABELS, TASK_STATUS_LABELS, formatDate } from '../../utils/format'
import { MilestoneDialog, TaskDialog } from './PlanDialogs'

/** Completion bar with a visible percentage label. */
function Completion({ value }) {
  const pct = Math.round(Number(value) || 0)
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 120 }}>
      <LinearProgress variant="determinate" value={pct} sx={{ flexGrow: 1, height: 8, borderRadius: 4 }} aria-label={`${pct}% complete`} />
      <Typography variant="body2" sx={{ minWidth: 36 }}>{`${pct}%`}</Typography>
    </Stack>
  )
}

Completion.propTypes = { value: PropTypes.number }

/** Late / at-risk indicators (text, not colour alone). */
function RiskChips({ milestone }) {
  return (
    <>
      {milestone.is_late && <Chip size="small" color="error" variant="outlined" label="Late" />}
      {!milestone.is_late && milestone.is_at_risk && <Chip size="small" color="warning" variant="outlined" label="At risk" />}
    </>
  )
}

RiskChips.propTypes = { milestone: PropTypes.object.isRequired }

/** Edit / delete / propose buttons for one milestone or task, according to permissions. */
function RowActions({ kind, item, permissions, onEdit, onDelete, onPropose }) {
  const name = item.name || item.title
  return (
    <Stack direction="row" spacing={0.5} justifyContent="flex-end" flexWrap="wrap" useFlexGap>
      {permissions.can_propose && (
        <Button size="small" startIcon={<RateReviewOutlinedIcon />} onClick={() => onPropose(kind, item)} aria-label={`Propose change to ${name}`}>
          Propose change
        </Button>
      )}
      {permissions.can_edit_plan && (
        <>
          <Tooltip title="Edit">
            <IconButton size="small" onClick={() => onEdit(kind, item)} aria-label={`Edit ${name}`}><EditOutlinedIcon fontSize="small" /></IconButton>
          </Tooltip>
          <Tooltip title="Delete">
            <IconButton size="small" onClick={() => onDelete(kind, item)} aria-label={`Delete ${name}`}><DeleteOutlinedIcon fontSize="small" /></IconButton>
          </Tooltip>
        </>
      )}
    </Stack>
  )
}

RowActions.propTypes = {
  kind: PropTypes.oneOf(['MILESTONE', 'TASK']).isRequired,
  item: PropTypes.object.isRequired,
  permissions: PropTypes.object.isRequired,
  onEdit: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  onPropose: PropTypes.func.isRequired,
}

/** Tasks of one milestone as a compact list. */
function TaskList({ tasks, permissions, actions, onAddTask, milestone }) {
  return (
    <Box sx={{ py: 1 }}>
      {tasks.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          No tasks. Completion comes from the milestone&apos;s percent complete.
        </Typography>
      )}
      <Stack spacing={1} component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }} aria-label={`Tasks for ${milestone.name}`}>
        {tasks.map((t) => (
          <Box component="li" key={t.id} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Typography sx={{ fontWeight: 600 }}>{t.title}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {`${TASK_STATUS_LABELS[t.status] || t.status} · ${t.assignee?.full_name || 'Unassigned'} · Due ${formatDate(t.due_date)}`}
                </Typography>
              </Box>
              <RowActions kind="TASK" item={t} permissions={permissions} {...actions} />
            </Stack>
          </Box>
        ))}
      </Stack>
      {permissions.can_edit_plan && (
        <Button size="small" startIcon={<AddIcon />} sx={{ mt: 1 }} onClick={() => onAddTask(milestone.id)}>Add task</Button>
      )}
    </Box>
  )
}

TaskList.propTypes = {
  tasks: PropTypes.array.isRequired,
  permissions: PropTypes.object.isRequired,
  actions: PropTypes.object.isRequired,
  onAddTask: PropTypes.func.isRequired,
  milestone: PropTypes.object.isRequired,
}

/**
 * Milestones & tasks: table on desktop, cards on mobile. PMO / the owning PM edit directly;
 * PM Analysts propose changes (nothing changes until the PM approves). Others read only.
 */
export default function PlanTab({ project, onChanged }) {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('md'))
  const notify = useNotify()
  const permissions = project.permissions || {}
  const [reloadKey, setReloadKey] = useState(0)
  const [expanded, setExpanded] = useState({})
  const [dialog, setDialog] = useState(null) // {type: 'milestone'|'task'|'propose', item?, kind?, milestoneId?}
  const [deleting, setDeleting] = useState(null) // {kind, item}
  const [busy, setBusy] = useState(false)
  const [team, setTeam] = useState(null)

  const plan = useApiQuery(
    () => Promise.all([listMilestones(project.id), listTasks(project.id)]).then(([m, t]) => ({ milestones: m.items, tasks: t.items })),
    `${project.id}|${reloadKey}`,
  )
  const refresh = () => { setReloadKey((k) => k + 1); onChanged() }

  const ensureTeam = () => {
    if (team === null) getTeam(project.id).then((r) => setTeam(r.items)).catch(() => setTeam([]))
  }
  const actions = {
    onEdit: (kind, item) => { ensureTeam(); setDialog({ type: kind === 'MILESTONE' ? 'milestone' : 'task', item }) },
    onDelete: (kind, item) => setDeleting({ kind, item }),
    onPropose: (kind, item) => setDialog({ type: 'propose', kind, item }),
  }
  const addTask = (milestoneId) => { ensureTeam(); setDialog({ type: 'task', milestoneId }) }

  const confirmDelete = async () => {
    setBusy(true)
    try {
      if (deleting.kind === 'MILESTONE') await deleteMilestone(project.id, deleting.item.id)
      else await deleteTask(project.id, deleting.item.id)
      notify(`${deleting.kind === 'MILESTONE' ? 'Milestone' : 'Task'} deleted`)
      setDeleting(null)
      refresh()
    } catch (err) {
      notify(err.message || 'Delete failed.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const saved = (label) => () => { setDialog(null); notify(label); refresh() }

  if (plan.loading && !plan.data) return <LoadingState rows={4} label="Loading milestones" />
  if (plan.error) return <ErrorState message={plan.error.message} onRetry={plan.reload} />
  const milestones = plan.data?.milestones || []
  const tasksFor = (id) => (plan.data?.tasks || []).filter((t) => t.milestone_id === id)
  const toggle = (id) => setExpanded((e) => ({ ...e, [id]: !e[id] }))

  const header = (
    <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }} spacing={1}>
      <Typography variant="body2" color="text.secondary">
        {permissions.can_propose ? 'Propose changes for the project manager to approve. Nothing changes until they approve it.' : `${milestones.length} milestone${milestones.length === 1 ? '' : 's'}`}
      </Typography>
      {permissions.can_edit_plan && (
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => { ensureTeam(); setDialog({ type: 'milestone' }) }}>Add milestone</Button>
      )}
    </Stack>
  )

  let list
  if (!milestones.length) {
    list = <Paper><EmptyState title="No milestones yet" description={permissions.can_edit_plan ? 'Add the first milestone to start tracking delivery.' : 'The project manager has not added milestones yet.'} /></Paper>
  } else if (isMobile) {
    list = (
      <Stack spacing={1.5}>
        {milestones.map((m) => (
          <Card key={m.id} variant="outlined" data-testid="milestone-card">
            <CardContent>
              <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="flex-start">
                <Typography variant="h3" component="h3">{m.name}</Typography>
                <Stack direction="row" spacing={0.5}><RiskChips milestone={m} /></Stack>
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ my: 0.5 }}>
                {`${MILESTONE_STATUS_LABELS[m.status] || m.status} · Due ${formatDate(m.due_date)} · ${m.owner?.full_name || 'No owner'}`}
              </Typography>
              <Completion value={m.completion_pct} />
              <RowActions kind="MILESTONE" item={m} permissions={permissions} {...actions} />
              <Button size="small" onClick={() => toggle(m.id)} endIcon={expanded[m.id] ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />} aria-expanded={Boolean(expanded[m.id])}>
                {`Tasks (${m.task_count ?? tasksFor(m.id).length})`}
              </Button>
              <Collapse in={Boolean(expanded[m.id])} unmountOnExit>
                <TaskList tasks={tasksFor(m.id)} permissions={permissions} actions={actions} onAddTask={addTask} milestone={m} />
              </Collapse>
            </CardContent>
          </Card>
        ))}
      </Stack>
    )
  } else {
    list = (
      <TableContainer component={Paper}>
        <Table size="small" aria-label="Milestones">
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox" />
              <TableCell>Milestone</TableCell>
              <TableCell>Due</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Completion</TableCell>
              <TableCell>Owner</TableCell>
              <TableCell align="right">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {milestones.map((m) => (
              <Fragment key={m.id}>
                <TableRow hover>
                  <TableCell padding="checkbox">
                    <IconButton size="small" onClick={() => toggle(m.id)} aria-label={`${expanded[m.id] ? 'Hide' : 'Show'} tasks for ${m.name}`} aria-expanded={Boolean(expanded[m.id])}>
                      {expanded[m.id] ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
                    </IconButton>
                  </TableCell>
                  <TableCell>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <span>{m.name}</span>
                      <RiskChips milestone={m} />
                    </Stack>
                  </TableCell>
                  <TableCell>{formatDate(m.due_date)}</TableCell>
                  <TableCell>{MILESTONE_STATUS_LABELS[m.status] || m.status}</TableCell>
                  <TableCell><Completion value={m.completion_pct} /></TableCell>
                  <TableCell>{m.owner?.full_name || '—'}</TableCell>
                  <TableCell align="right"><RowActions kind="MILESTONE" item={m} permissions={permissions} {...actions} /></TableCell>
                </TableRow>
                <TableRow>
                  <TableCell colSpan={7} sx={{ py: 0, borderBottom: expanded[m.id] ? undefined : 'none' }}>
                    <Collapse in={Boolean(expanded[m.id])} unmountOnExit>
                      <TaskList tasks={tasksFor(m.id)} permissions={permissions} actions={actions} onAddTask={addTask} milestone={m} />
                    </Collapse>
                  </TableCell>
                </TableRow>
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    )
  }

  return (
    <>
      {header}
      {list}
      {dialog?.type === 'milestone' && (
        <MilestoneDialog open project={project} milestone={dialog.item} team={team || []} onClose={() => setDialog(null)} onSaved={saved(dialog.item ? 'Milestone updated' : 'Milestone added')} />
      )}
      {dialog?.type === 'task' && (
        <TaskDialog
          open project={project} task={dialog.item} milestones={milestones} defaultMilestoneId={dialog.milestoneId} team={team || []}
          onClose={() => setDialog(null)} onSaved={saved(dialog.item ? 'Task updated' : 'Task added')}
        />
      )}
      {dialog?.type === 'propose' && (
        <ProposeChangeDialog
          open projectId={project.id} pmName={project.pm?.display_name} entityType={dialog.kind} entity={dialog.item}
          onClose={() => setDialog(null)}
          onProposed={() => {
            setDialog(null)
            notify(`Proposal sent to ${project.pm?.display_name || 'the project manager'} for approval. Nothing changes until it is approved.`)
          }}
        />
      )}
      <ConfirmDialog
        open={Boolean(deleting)}
        title={`Delete ${deleting?.kind === 'MILESTONE' ? 'milestone' : 'task'}?`}
        message={`"${deleting?.item?.name || deleting?.item?.title || ''}" will be soft-deleted. It is kept in the audit log.`}
        confirmLabel="Delete" destructive busy={busy}
        onConfirm={confirmDelete} onCancel={() => setDeleting(null)}
      />
    </>
  )
}

PlanTab.propTypes = {
  project: PropTypes.object.isRequired,
  onChanged: PropTypes.func.isRequired,
}
