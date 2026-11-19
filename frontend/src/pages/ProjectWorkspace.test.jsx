import { vi } from 'vitest'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp, USERS } from '../test/renderWithProviders'
import * as projectsApi from '../api/projects'
import * as milestonesApi from '../api/milestones'
import * as tasksApi from '../api/tasks'
import * as analystsApi from '../api/analysts'
import * as statusApi from '../api/statusUpdates'
import * as auditApi from '../api/audit'
import * as crApi from '../api/changeRequests'

vi.mock('../api/projects', () => ({
  listProjects: vi.fn(), getLookups: vi.fn(), getProject: vi.fn(), createProject: vi.fn(), updateProject: vi.fn(),
  archiveProject: vi.fn(), cancelProject: vi.fn(), getTeam: vi.fn(),
}))
vi.mock('../api/milestones', () => ({ listMilestones: vi.fn(), createMilestone: vi.fn(), updateMilestone: vi.fn(), deleteMilestone: vi.fn() }))
vi.mock('../api/tasks', () => ({ listTasks: vi.fn(), createTask: vi.fn(), updateTask: vi.fn(), deleteTask: vi.fn() }))
vi.mock('../api/analysts', () => ({ listAnalysts: vi.fn(), assignAnalyst: vi.fn(), removeAnalyst: vi.fn() }))
vi.mock('../api/statusUpdates', () => ({ listStatusUpdates: vi.fn(), submitStatusUpdate: vi.fn() }))
vi.mock('../api/audit', () => ({ listProjectAudit: vi.fn() }))
vi.mock('../api/changeRequests', () => ({ listChangeRequests: vi.fn(), approveChangeRequest: vi.fn(), rejectChangeRequest: vi.fn(), proposeChange: vi.fn() }))

const NONE = {
  can_edit: false, can_edit_baseline: false, can_archive: false, can_edit_plan: false, can_submit_status: false,
  can_propose: false, can_assign_analysts: false, can_view_audit: false, can_record_spend: false,
}
const PERMS = {
  EXEC: NONE,
  PM: { ...NONE, can_edit: true, can_edit_plan: true, can_submit_status: true, can_assign_analysts: true, can_view_audit: true },
  ANALYST: { ...NONE, can_propose: true },
  PMO: { ...NONE, can_edit: true, can_edit_baseline: true, can_archive: true, can_edit_plan: true, can_assign_analysts: true, can_view_audit: true, can_record_spend: true },
}

const project = (permissions) => ({
  id: 'p1', name: 'Customer Portal Rebuild', description: null, sponsor: 'CIO Office', department: { id: 'd1', name: 'Digital Channels' },
  pm: { id: 'm1', display_name: 'Jordan Lee' }, planned_start: '2026-01-05', planned_end: '2026-12-18', actual_start: '2026-01-06',
  approved_budget: 2000000, lifecycle_status: 'ACTIVE', priority: 'HIGH', archived_at: null, health_overall: 'RED',
  health_reasons: ['Schedule: progress lags time elapsed by 30 points.'], flags: ['STATUS_MISMATCH', 'UPDATE_OVERDUE'], version: 7,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-11-18T10:00:00Z',
  health: {
    overall: 'RED', reasons: ['Schedule: progress lags time elapsed by 30 points.'], flags: ['STATUS_MISMATCH'],
    dimensions: {
      schedule: { status: 'RED', summary: 'Progress 26% vs 56% of time elapsed.' },
      budget: { status: 'GREEN', summary: 'Spend is 2% under plan.' },
      milestones: { status: 'AMBER', summary: '1 milestone at risk.' },
    },
    metrics: { elapsed_pct: 56, progress_pct: 26, spend_to_date: 1100000, planned_spend_to_date: 1120000, budget_spent_pct: 55 },
  },
  permissions,
})

const milestone = {
  id: 'ms1', name: 'UAT sign-off', description: null, notes: null, owner: { id: 'x', full_name: 'Priya Raman' }, due_date: '2026-11-25',
  status: 'IN_PROGRESS', percent_complete: 40, completion_pct: 40, task_count: 1, done_count: 0, is_late: false, is_at_risk: true,
  version: 2, updated_at: '2026-11-18T10:00:00Z',
}
const task = { id: 'tk1', milestone_id: 'ms1', title: 'Build reports', status: 'IN_PROGRESS', notes: null, assignee: null, due_date: '2026-11-20', version: 1 }

function setup(role) {
  projectsApi.getProject.mockResolvedValue({ project: project(PERMS[role]) })
  projectsApi.getLookups.mockResolvedValue({ departments: [], project_managers: [], analysts: [{ id: 'n1', display_name: 'Sam Okafor' }] })
  projectsApi.getTeam.mockResolvedValue({ items: [] })
  milestonesApi.listMilestones.mockResolvedValue({ items: [milestone] })
  tasksApi.listTasks.mockResolvedValue({ items: [task] })
  analystsApi.listAnalysts.mockResolvedValue({ items: [] })
  statusApi.listStatusUpdates.mockResolvedValue({ items: [] })
  auditApi.listProjectAudit.mockResolvedValue({ items: [{ id: 1, at: '2026-11-18T10:00:00Z', actor: { id: 'm1', display_name: 'Jordan Lee' }, entity_type: 'milestone', entity_id: 'ms1', action: 'UPDATED', before: { status: 'NOT_STARTED' }, after: { status: 'IN_PROGRESS' } }], page: 1, page_size: 20, total: 1 })
  renderApp('/portfolio/p1', USERS[role])
}

describe('Project workspace permissions', () => {
  afterEach(() => vi.clearAllMocks())

  it('shows health per dimension, reasons and flags', async () => {
    setup('EXEC')
    expect(await screen.findByRole('heading', { level: 1, name: 'Customer Portal Rebuild' })).toBeInTheDocument()
    expect(screen.getByText('Progress 26% vs 56% of time elapsed.')).toBeInTheDocument()
    expect(screen.getByText('Spend is 2% under plan.')).toBeInTheDocument()
    expect(screen.getByText('Status mismatch')).toBeInTheDocument()
    expect(screen.getByText('Update overdue')).toBeInTheDocument()
    expect(screen.getAllByText('Schedule: progress lags time elapsed by 30 points.').length).toBeGreaterThan(0)
  })

  it('Executive: read only, no audit or analyst tabs', async () => {
    const user = userEvent.setup()
    setup('EXEC')
    await screen.findByRole('heading', { level: 1, name: 'Customer Portal Rebuild' })
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Audit' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Analysts' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Milestones & tasks' }))
    expect(await screen.findByRole('table', { name: 'Milestones' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add milestone' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Propose change/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit UAT sign-off/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Status updates' }))
    expect(await screen.findByText('No status updates yet')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Submit update' })).not.toBeInTheDocument()
  })

  it('Project Manager: edits own plan and submits status, cannot archive and never sees spend editing', async () => {
    const user = userEvent.setup()
    setup('PM')
    await screen.findByRole('heading', { level: 1, name: 'Customer Portal Rebuild' })
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /spend/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /spend/i })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Audit' })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Milestones & tasks' }))
    expect(await screen.findByRole('button', { name: 'Add milestone' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit UAT sign-off' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Propose change/ })).not.toBeInTheDocument()
    expect(screen.getByText('At risk')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit project' })
    expect(within(dialog).getByLabelText(/Approved budget/)).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    statusApi.submitStatusUpdate.mockResolvedValue({ status_update: { id: 's1' }, project: project(PERMS.PM) })
    await user.click(screen.getByRole('tab', { name: 'Status updates' }))
    await user.click(await screen.findByRole('button', { name: 'Submit update' }))
    expect(screen.getByText('Choose the status you believe the project is in.')).toBeInTheDocument()
    expect(statusApi.submitStatusUpdate).not.toHaveBeenCalled()
    await user.click(screen.getByRole('radio', { name: 'Amber' }))
    await user.type(screen.getByLabelText(/Summary/), 'UAT slipped a week.')
    await user.click(screen.getByRole('button', { name: 'Submit update' }))
    expect(statusApi.submitStatusUpdate).toHaveBeenCalledWith('p1', { reported_status: 'AMBER', summary: 'UAT slipped a week.' }, expect.any(String))
    expect(await screen.findByText('Weekly update submitted')).toBeInTheDocument()
  })

  it('PM Analyst: proposes changes instead of editing', async () => {
    crApi.proposeChange.mockResolvedValue({ change_request: { id: 'cr1' } })
    const user = userEvent.setup()
    setup('ANALYST')
    await screen.findByRole('heading', { level: 1, name: 'Customer Portal Rebuild' })
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'Milestones & tasks' }))
    const propose = await screen.findByRole('button', { name: 'Propose change to UAT sign-off' })
    expect(screen.queryByRole('button', { name: 'Add milestone' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit UAT sign-off' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete UAT sign-off' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show tasks for UAT sign-off' }))
    expect(await screen.findByRole('button', { name: 'Propose change to Build reports' })).toBeInTheDocument()
    await user.click(propose)
    const dialog = await screen.findByRole('dialog', { name: 'Propose a change' })
    const pct = within(dialog).getByLabelText(/Percent complete/)
    await user.clear(pct)
    await user.type(pct, '75')
    await user.click(within(dialog).getByRole('button', { name: 'Send for approval' }))
    expect(crApi.proposeChange).toHaveBeenCalledWith('p1', { entity_type: 'MILESTONE', entity_id: 'ms1', changes: { percent_complete: 75 } }, expect.any(String))
    expect(await screen.findByText('Proposal sent to Jordan Lee for approval. Nothing changes until it is approved.')).toBeInTheDocument()
    // the displayed (approved) data is unchanged
    expect(screen.getByText('40%')).toBeInTheDocument()
  })

  it('Portfolio Manager: archives after confirmation and sees the audit trail', async () => {
    projectsApi.archiveProject.mockResolvedValue({ project: { ...project(PERMS.PMO), archived_at: '2026-11-19T00:00:00Z' } })
    const user = userEvent.setup()
    setup('PMO')
    await screen.findByRole('heading', { level: 1, name: 'Customer Portal Rebuild' })
    await user.click(screen.getByRole('button', { name: 'Archive' }))
    const dialog = screen.getByRole('dialog', { name: 'Archive this project?' })
    expect(within(dialog).getByText(/also archives its milestones, tasks and allocations/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }))
    expect(projectsApi.archiveProject).toHaveBeenCalledWith('p1', 7)
    expect(await screen.findByText('Project archived')).toBeInTheDocument()
    await user.click(await screen.findByRole('tab', { name: 'Audit' }))
    expect(await screen.findByText('Updated · Milestone')).toBeInTheDocument()
    expect(screen.getByText(/Not started →/)).toBeInTheDocument()
  })

  it('PM assigns an analyst from the Analysts tab', async () => {
    analystsApi.assignAnalyst.mockResolvedValue({ analyst: { user_id: 'n1' } })
    const user = userEvent.setup()
    setup('PM')
    await screen.findByRole('heading', { level: 1, name: 'Customer Portal Rebuild' })
    await user.click(screen.getByRole('tab', { name: 'Analysts' }))
    expect(await screen.findByText('No PM Analysts assigned')).toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: 'Analyst' }))
    await user.click(await screen.findByRole('option', { name: 'Sam Okafor' }))
    await user.click(screen.getByRole('button', { name: 'Assign analyst' }))
    expect(analystsApi.assignAnalyst).toHaveBeenCalledWith('p1', 'n1')
  })
})

describe('PM home', () => {
  afterEach(() => vi.clearAllMocks())

  it('shows the approvals-waiting count and my projects', async () => {
    crApi.listChangeRequests.mockResolvedValue({
      items: [{
        id: 'cr1', project: { id: 'p1', name: 'Customer Portal Rebuild' }, entity_type: 'TASK', entity_id: 't1', entity_name: 'Build reports',
        proposer: { id: 'n1', display_name: 'Sam Okafor' }, changes: { status: 'DONE' }, current: { status: 'IN_PROGRESS' }, note: null,
        status: 'PENDING', reason: null, decided_by: null, decided_at: null, created_at: '2026-11-19T10:00:00Z',
      }],
      page: 1, page_size: 5, total: 3,
    })
    projectsApi.listProjects.mockResolvedValue({ items: [{ ...project(PERMS.PM) }], page: 1, page_size: 50, total: 1 })
    renderApp('/home', USERS.PM)
    expect(await screen.findByRole('heading', { level: 2, name: 'Approvals waiting (3)' })).toBeInTheDocument()
    expect(within(screen.getByTestId('approvals-count')).getByText('3')).toBeInTheDocument()
    expect(screen.getByText('Task: Build reports')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { level: 3, name: 'Customer Portal Rebuild' })).toBeInTheDocument()
    expect(projectsApi.listProjects).toHaveBeenCalledWith({ mine: true, sort: 'health', page_size: 50 })
    expect(crApi.listChangeRequests).toHaveBeenCalledWith({ view: 'approvals', status: 'PENDING', page: 1, page_size: 5 })
  })
})
