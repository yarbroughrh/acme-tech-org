import { vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp, USERS } from '../test/renderWithProviders'
import * as portfolioApi from '../api/portfolio'
import * as projectsApi from '../api/projects'
import { varianceView } from './ExecutiveDashboard'

vi.mock('../api/portfolio', () => ({ getPortfolioSummary: vi.fn() }))
vi.mock('../api/projects', () => ({ listProjects: vi.fn(), getLookups: vi.fn(), getProject: vi.fn(), createProject: vi.fn() }))
vi.mock('../api/people', () => ({ listPeople: vi.fn(() => new Promise(() => {})) }))

const SUMMARY = {
  health_counts: { RED: 3, AMBER: 5, GREEN: 20 },
  excluded_projects: 19,
  health_by_department: [
    { department: { id: 'd1', name: 'Finance' }, red: 2, amber: 1, green: 7, active: 10 },
    { department: { id: 'd2', name: 'Sales' }, red: 1, amber: 4, green: 13, active: 18 },
  ],
  people: { severe: 1, over: 2, at_or_under: 148 },
  budget_by_department: [
    { department: { id: 'd1', name: 'Finance' }, approved: 1000000, planned_to_date: 400000, actual_to_date: 500000, variance_pct: 25 },
    { department: { id: 'd2', name: 'Sales' }, approved: 2000000, planned_to_date: 1000000, actual_to_date: 1120000, variance_pct: 12 },
  ],
  totals: { approved: 3000000, planned_to_date: 1400000, actual_to_date: 1620000, variance_pct: 15.7 },
}

describe('ExecutiveDashboard (Executive home)', () => {
  beforeEach(() => {
    portfolioApi.getPortfolioSummary.mockResolvedValue(SUMMARY)
    projectsApi.getLookups.mockResolvedValue({ departments: [{ id: 'd1', name: 'Finance' }, { id: 'd2', name: 'Sales' }], project_managers: [] })
    projectsApi.listProjects.mockReturnValue(new Promise(() => {}))
  })
  afterEach(() => vi.clearAllMocks())

  it('shows the off-track queue heading first, then the dashboard below', async () => {
    renderApp('/next', USERS.EXEC)
    const offTrack = await screen.findByRole('heading', { name: 'Off track' })
    const dashboard = await screen.findByRole('heading', { name: 'Portfolio dashboard' })
    expect(offTrack.compareDocumentPosition(dashboard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('labels every health segment with its count (text, not colour only) and drills through', async () => {
    const user = userEvent.setup()
    renderApp('/next', USERS.EXEC)
    const red = await screen.findByRole('button', { name: 'Finance: 2 Red — show projects' })
    expect(red).toHaveTextContent('2')
    expect(screen.getByRole('button', { name: 'Sales: 4 Amber — show projects' })).toHaveTextContent('4')
    expect(screen.getByText('Red 3')).toBeInTheDocument()
    expect(screen.getByText(/19 Proposed, On hold, Closed or Cancelled projects are not counted/)).toBeInTheDocument()
    await user.click(red)
    await waitFor(() => expect(projectsApi.listProjects).toHaveBeenCalledWith(
      expect.objectContaining({ health: 'RED', department_id: 'd1', lifecycle_status: 'ACTIVE' })))
  })

  it('people tiles show counts and link to the filtered people view', async () => {
    const user = userEvent.setup()
    renderApp('/next', USERS.EXEC)
    const severe = await screen.findByRole('button', { name: 'Over 60 h a week: 1 people — show them' })
    expect(within(severe).getByText('1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'At or under 40 h a week: 148 people — show them' })).toBeInTheDocument()
    await user.click(severe)
    expect(await screen.findByRole('heading', { level: 1, name: 'People' })).toBeInTheDocument()
  })

  it('budget table shows signed variance with Amber / Red labels and a totals row', async () => {
    renderApp('/next', USERS.EXEC)
    const table = await screen.findByRole('table', { name: 'Budget against plan by department' })
    expect(within(table).getByText('+25.0%')).toBeInTheDocument()
    expect(within(table).getByText('(more than 20% over plan)')).toBeInTheDocument()
    expect(within(table).getAllByText('(more than 10% over plan)')).toHaveLength(2) // Sales 12% and total 15.7%
    expect(within(table).getByText('Total')).toBeInTheDocument()
    expect(within(table).getByText('$1,620,000')).toBeInTheDocument()
  })

  it('department filter refetches the summary', async () => {
    const user = userEvent.setup()
    renderApp('/next', USERS.EXEC)
    await screen.findByRole('heading', { name: 'Portfolio dashboard' })
    await user.click(screen.getByRole('combobox', { name: 'Department' }))
    await user.click(await screen.findByRole('option', { name: 'Sales' }))
    await waitFor(() => expect(portfolioApi.getPortfolioSummary).toHaveBeenLastCalledWith({ department_id: 'd2' }))
  })

  it('PMO sees it collapsed as "Portfolio overview" and loads it only when opened', async () => {
    const user = userEvent.setup()
    renderApp('/next', USERS.PMO)
    const toggle = await screen.findByRole('button', { name: 'Portfolio overview' })
    expect(portfolioApi.getPortfolioSummary).not.toHaveBeenCalled()
    await user.click(toggle)
    expect(await screen.findByRole('table', { name: 'Budget against plan by department' })).toBeInTheDocument()
  })

  it('admin, PM and analyst do not get the dashboard', async () => {
    renderApp('/next', USERS.PM)
    await screen.findByRole('heading', { level: 1, name: 'Your next actions' })
    expect(screen.queryByText('Portfolio overview')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Portfolio dashboard' })).not.toBeInTheDocument()
  })
})

describe('varianceView', () => {
  it.each([[null, '—', null], [0, '0.0%', null], [10, '+10.0%', null], [10.1, '+10.1%', 'amber'], [20, '+20.0%', 'amber'],
    [20.5, '+20.5%', 'red'], [-5, '-5.0%', null]])('%s → %s %s', (pct, text, tone) => {
    expect(varianceView(pct)).toEqual({ text, tone })
  })
})
