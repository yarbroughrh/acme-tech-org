import { useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import { Link as RouterLink, useParams, useSearchParams } from 'react-router-dom'
import {
  Alert, Box, Breadcrumbs, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Link, Paper,
  Stack, Tab, Tabs, TextField, Typography,
} from '@mui/material'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined'
import BlockOutlinedIcon from '@mui/icons-material/BlockOutlined'
import { archiveProject, cancelProject, getLookups, getProject } from '../api/projects'
import { listAnalysts } from '../api/analysts'
import ConfirmDialog from '../components/ConfirmDialog'
import FlagChips from '../components/FlagChips'
import HealthBadge from '../components/HealthBadge'
import LifecycleChip from '../components/LifecycleChip'
import { useNotify } from '../components/NotifyProvider'
import { EmptyState, ErrorState, LoadingState } from '../components/PageState'
import ProjectFormDialog from '../components/ProjectFormDialog'
import useApiQuery from '../utils/useApiQuery'
import { isConflict, saveErrorMessage } from '../utils/forms'
import OverviewTab from './project/OverviewTab'
import PlanTab from './project/PlanTab'
import StatusUpdatesTab from './project/StatusUpdatesTab'
import AnalystsTab from './project/AnalystsTab'
import AuditTab from './project/AuditTab'
import TeamTab from './project/TeamTab'

/** Cancel dialog with an optional reason. */
function CancelProjectDialog({ open, busy, onCancel, onConfirm }) {
  const [reason, setReason] = useState('')
  return (
    <Dialog open={open} onClose={busy ? undefined : onCancel} fullWidth maxWidth="sm" aria-labelledby="cancel-project-title">
      <DialogTitle id="cancel-project-title">Cancel this project?</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          The project stops being tracked for health. Nothing is deleted; the history and audit log are kept.
        </DialogContentText>
        <TextField id="cancel-reason" label="Reason (optional)" fullWidth multiline minRows={2} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={busy}>Keep project</Button>
        <Button variant="contained" color="error" onClick={() => onConfirm(reason.trim())} disabled={busy}>Cancel project</Button>
      </DialogActions>
    </Dialog>
  )
}

CancelProjectDialog.propTypes = { open: PropTypes.bool.isRequired, busy: PropTypes.bool, onCancel: PropTypes.func.isRequired, onConfirm: PropTypes.func.isRequired }

/**
 * Project workspace: header (health, flags, actions) and tabs. Every action is shown according to the
 * server-computed, ownership-aware `project.permissions`; the backend enforces them regardless.
 */
export default function ProjectDetailPage() {
  const { id } = useParams()
  const notify = useNotify()
  const [reloadKey, setReloadKey] = useState(0)
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = searchParams.get('tab') || 'overview'
  const setTab = (value) => setSearchParams((prev) => {
    const next = new URLSearchParams(prev)
    next.set('tab', value)
    return next
  }, { replace: true })
  const [dialog, setDialog] = useState(null) // 'edit' | 'archive' | 'cancel'
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState(null)
  const [lookups, setLookups] = useState(null)
  const [analystCount, setAnalystCount] = useState(0)
  const query = useApiQuery(() => getProject(id), `${id}|${reloadKey}`)
  const project = query.data?.project
  const permissions = project?.permissions || {}
  const reload = () => setReloadKey((k) => k + 1)

  useEffect(() => {
    getLookups().then(setLookups).catch(() => {})
  }, [])
  useEffect(() => {
    if (!project?.id) return
    listAnalysts(project.id).then((r) => setAnalystCount(r.items?.length || 0)).catch(() => {})
  }, [project?.id])

  const crumbs = (
    <Breadcrumbs sx={{ mb: 1 }}>
      <Link component={RouterLink} to="/portfolio">Portfolio</Link>
      <Typography color="text.primary">{project?.name || 'Project'}</Typography>
    </Breadcrumbs>
  )

  if (query.loading && !query.data) return <>{crumbs}<LoadingState rows={6} label="Loading project" /></>
  if (query.error?.status === 404 || query.error?.status === 403) {
    return (
      <>
        {crumbs}
        <Paper>
          <EmptyState
            title={query.error.status === 404 ? 'Project not found' : "You can't open this project"}
            description={query.error.status === 404 ? 'It may have been archived, or the link is wrong.' : query.error.message}
            action={<Button component={RouterLink} to="/portfolio" variant="contained">Back to portfolio</Button>}
          />
        </Paper>
      </>
    )
  }
  if (query.error) return <>{crumbs}<ErrorState message={query.error.message} onRetry={query.reload} /></>

  const runAction = async (fn, success) => {
    setBusy(true)
    setActionError(null)
    try {
      await fn()
      notify(success)
      setDialog(null)
      reload()
    } catch (err) {
      setActionError(err)
      setDialog(null)
    } finally {
      setBusy(false)
    }
  }

  const tabs = [
    { value: 'overview', label: 'Overview' },
    { value: 'plan', label: 'Milestones & tasks' },
    { value: 'status', label: 'Status updates' },
    { value: 'team', label: 'Team' },
    ...(permissions.can_assign_analysts || analystCount > 0 ? [{ value: 'analysts', label: 'Analysts' }] : []),
    ...(permissions.can_view_audit ? [{ value: 'audit', label: 'Audit' }] : []),
  ]
  const activeTab = tabs.some((t) => t.value === tab) ? tab : 'overview'
  const archived = Boolean(project.archived_at)

  return (
    <>
      {crumbs}
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }} sx={{ mb: 1 }}>
        <Typography variant="h1" component="h1" sx={{ flexGrow: 1 }}>{project.name}</Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {permissions.can_edit && !archived && (
            <Button variant="outlined" startIcon={<EditOutlinedIcon />} onClick={() => setDialog('edit')}>Edit</Button>
          )}
          {permissions.can_archive && !archived && (
            <>
              <Button variant="outlined" color="error" startIcon={<BlockOutlinedIcon />} onClick={() => setDialog('cancel')} disabled={project.lifecycle_status === 'CANCELLED'}>Cancel project</Button>
              <Button variant="outlined" color="error" startIcon={<ArchiveOutlinedIcon />} onClick={() => setDialog('archive')}>Archive</Button>
            </>
          )}
        </Stack>
      </Stack>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
        <LifecycleChip status={project.lifecycle_status} />
        <HealthBadge health={project.health_overall} reasons={project.health_reasons || []} lifecycleStatus={project.lifecycle_status} />
        <FlagChips flags={project.flags || []} />
        {archived && <Typography variant="body2" color="text.secondary">Archived — read only</Typography>}
      </Stack>
      {actionError && (
        <Alert
          severity="error" role="alert" sx={{ mb: 2 }} onClose={() => setActionError(null)}
          action={isConflict(actionError) ? <Button color="inherit" size="small" onClick={() => { setActionError(null); reload() }}>Reload</Button> : undefined}
        >
          {saveErrorMessage(actionError)}
        </Alert>
      )}
      <Paper sx={{ mb: 2 }}>
        <Tabs value={activeTab} onChange={(_e, v) => setTab(v)} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile aria-label="Project sections">
          {tabs.map((t) => <Tab key={t.value} value={t.value} label={t.label} id={`tab-${t.value}`} aria-controls={`panel-${t.value}`} />)}
        </Tabs>
      </Paper>
      <Box role="tabpanel" id={`panel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
        {activeTab === 'overview' && <OverviewTab project={project} />}
        {activeTab === 'plan' && <PlanTab project={project} onChanged={reload} />}
        {activeTab === 'status' && <StatusUpdatesTab project={project} onChanged={reload} />}
        {activeTab === 'team' && <TeamTab project={project} />}
        {activeTab === 'analysts' && <AnalystsTab project={project} lookups={lookups} />}
        {activeTab === 'audit' && <AuditTab project={project} />}
      </Box>

      {dialog === 'edit' && (
        <ProjectFormDialog
          open mode="edit" project={project} canEditBaseline={Boolean(permissions.can_edit_baseline)}
          canChangeLifecycle={Boolean(permissions.can_change_lifecycle)} lookups={lookups}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); notify('Project updated'); reload() }}
        />
      )}
      <ConfirmDialog
        open={dialog === 'archive'} title="Archive this project?" confirmLabel="Archive" destructive busy={busy}
        message="Archiving also archives its milestones, tasks and allocations, and closes pending proposals. Nothing is deleted."
        onCancel={() => setDialog(null)}
        onConfirm={() => runAction(() => archiveProject(project.id, project.version), 'Project archived')}
      />
      {dialog === 'cancel' && (
        <CancelProjectDialog
          open busy={busy} onCancel={() => setDialog(null)}
          onConfirm={(reason) => runAction(() => cancelProject(project.id, project.version, reason), 'Project cancelled')}
        />
      )}
    </>
  )
}
