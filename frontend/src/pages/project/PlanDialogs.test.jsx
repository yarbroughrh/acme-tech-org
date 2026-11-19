import { vi } from 'vitest'
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MilestoneDialog, TaskDialog } from './PlanDialogs'
import * as milestonesApi from '../../api/milestones'
import * as tasksApi from '../../api/tasks'
import { ApiError } from '../../api/client'
import { renderWithProviders, USERS } from '../../test/renderWithProviders'

vi.mock('../../api/milestones', () => ({ createMilestone: vi.fn(), updateMilestone: vi.fn(), listMilestones: vi.fn(), deleteMilestone: vi.fn() }))
vi.mock('../../api/tasks', () => ({ createTask: vi.fn(), updateTask: vi.fn(), listTasks: vi.fn(), deleteTask: vi.fn() }))

const project = { id: 'p1', planned_start: '2026-01-01', planned_end: '2026-12-31' }
const team = [{ id: 'x1', full_name: 'Priya Raman' }]

describe('MilestoneDialog', () => {
  afterEach(() => vi.clearAllMocks())

  it('validates name, due date within the project, and percent', async () => {
    const user = userEvent.setup()
    renderWithProviders(<MilestoneDialog open project={project} team={team} onClose={vi.fn()} onSaved={vi.fn()} />, { user: USERS.PM })
    fireEvent.change(screen.getByLabelText(/Due date/), { target: { value: '2027-02-01' } })
    await user.type(screen.getByLabelText(/Percent complete/), '101')
    await user.click(screen.getByRole('button', { name: 'Save milestone' }))
    expect(screen.getByText('Enter a milestone name.')).toBeInTheDocument()
    expect(screen.getByText('Due date must be within the project dates.')).toBeInTheDocument()
    expect(screen.getByText('Enter a whole number from 0 to 100.')).toBeInTheDocument()
    expect(milestonesApi.createMilestone).not.toHaveBeenCalled()
  })

  it('creates with an idempotency key, nulls for empty optionals', async () => {
    milestonesApi.createMilestone.mockResolvedValue({ milestone: { id: 'm9' } })
    const onSaved = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<MilestoneDialog open project={project} team={team} onClose={vi.fn()} onSaved={onSaved} />, { user: USERS.PM })
    await user.type(screen.getByLabelText(/Milestone name/), 'Go-live')
    fireEvent.change(screen.getByLabelText(/Due date/), { target: { value: '2026-10-01' } })
    await user.click(screen.getByRole('button', { name: 'Save milestone' }))
    expect(milestonesApi.createMilestone).toHaveBeenCalledWith('p1', {
      name: 'Go-live', due_date: '2026-10-01', status: 'NOT_STARTED', owner_person_id: null, percent_complete: null, description: null, notes: null,
    }, expect.any(String))
    expect(onSaved).toHaveBeenCalledWith({ id: 'm9' })
  })

  it('updates only changed fields with the version, and shows conflicts', async () => {
    milestonesApi.updateMilestone.mockRejectedValue(new ApiError({
      status: 409, code: 'CONFLICT', message: 'This milestone was changed by someone else.', details: [{ field: 'version', message: 'Changed by Jordan Lee.' }],
    }))
    const milestone = { id: 'm1', name: 'UAT', due_date: '2026-06-01', status: 'IN_PROGRESS', owner: null, percent_complete: 20, description: null, notes: null, version: 5 }
    const user = userEvent.setup()
    renderWithProviders(<MilestoneDialog open project={project} milestone={milestone} team={team} onClose={vi.fn()} onSaved={vi.fn()} />, { user: USERS.PM })
    const pct = screen.getByLabelText(/Percent complete/)
    await user.clear(pct)
    await user.type(pct, '60')
    await user.click(screen.getByRole('button', { name: 'Save milestone' }))
    expect(milestonesApi.updateMilestone).toHaveBeenCalledWith('p1', 'm1', { percent_complete: 60, version: 5 })
    expect(await screen.findByRole('alert')).toHaveTextContent('Changed by Jordan Lee.')
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument()
  })
})

describe('TaskDialog', () => {
  afterEach(() => vi.clearAllMocks())
  const milestones = [{ id: 'm1', name: 'UAT' }]

  it('validates title and due date', async () => {
    const user = userEvent.setup()
    renderWithProviders(<TaskDialog open project={project} milestones={milestones} defaultMilestoneId="m1" team={team} onClose={vi.fn()} onSaved={vi.fn()} />, { user: USERS.PM })
    fireEvent.change(screen.getByLabelText(/Due date/), { target: { value: '2025-01-01' } })
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(screen.getByText('Enter a task title.')).toBeInTheDocument()
    expect(screen.getByText('Due date must be within the project dates.')).toBeInTheDocument()
    expect(tasksApi.createTask).not.toHaveBeenCalled()
  })

  it('creates a task in the chosen milestone and assigns a team member', async () => {
    tasksApi.createTask.mockResolvedValue({ task: { id: 't9' } })
    const user = userEvent.setup()
    renderWithProviders(<TaskDialog open project={project} milestones={milestones} defaultMilestoneId="m1" team={team} onClose={vi.fn()} onSaved={vi.fn()} />, { user: USERS.PM })
    await user.type(screen.getByLabelText(/Task title/), 'Write test plan')
    await user.click(screen.getByRole('combobox', { name: 'Assignee' }))
    await user.click(await screen.findByRole('option', { name: 'Priya Raman' }))
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(tasksApi.createTask).toHaveBeenCalledWith('p1', {
      title: 'Write test plan', milestone_id: 'm1', status: 'TODO', assignee_person_id: 'x1', due_date: null, notes: null,
    }, expect.any(String))
  })

  it('updates a task with only the changed status and the version', async () => {
    tasksApi.updateTask.mockResolvedValue({ task: { id: 't1' } })
    const task = { id: 't1', milestone_id: 'm1', title: 'Build', status: 'TODO', assignee: null, due_date: null, notes: null, version: 2 }
    const user = userEvent.setup()
    renderWithProviders(<TaskDialog open project={project} task={task} milestones={milestones} team={team} onClose={vi.fn()} onSaved={vi.fn()} />, { user: USERS.PM })
    await user.click(screen.getByRole('combobox', { name: 'Status' }))
    await user.click(await screen.findByRole('option', { name: 'Done' }))
    await user.click(screen.getByRole('button', { name: 'Save task' }))
    expect(tasksApi.updateTask).toHaveBeenCalledWith('p1', 't1', { status: 'DONE', version: 2 })
  })
})
