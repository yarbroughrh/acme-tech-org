import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, USERS } from '../test/renderWithProviders'
import PeoplePage from './PeoplePage'
import * as peopleApi from '../api/people'
import * as projectsApi from '../api/projects'

vi.mock('../api/people', () => ({ listPeople: vi.fn() }))
vi.mock('../api/projects', () => ({ getLookups: vi.fn() }))

const person = {
  id: 'x2', full_name: 'Marcus Webb', job_title: 'Integration Lead', department: { id: 'd1', name: 'Finance' },
  total_hours: 64, available_hours: 0, load_status: 'SEVERE',
  allocations: [{ project: { id: 'p1', name: 'Payments Gateway Upgrade' }, hours_per_week: 20 }],
}
const lastRequest = () => peopleApi.listPeople.mock.calls.at(-1)[0]

describe('PeoplePage', () => {
  beforeEach(() => {
    peopleApi.listPeople.mockResolvedValue({ items: [person], page: 1, page_size: 25, total: 1 })
    projectsApi.getLookups.mockResolvedValue({ departments: [{ id: 'd1', name: 'Finance' }] })
  })
  afterEach(() => vi.clearAllMocks())

  it('sends the load filter from the URL and shows the person', async () => {
    renderWithProviders(<PeoplePage />, { path: '/people?load=SEVERE', user: USERS.PMO })
    const table = await screen.findByRole('table', { name: 'People' })
    expect(lastRequest()).toMatchObject({ load: 'SEVERE', page: 1 })
    expect(within(table).getByText('Severely over-allocated +24h')).toBeInTheDocument()
    expect(within(table).getByRole('link', { name: 'Payments Gateway Upgrade' })).toHaveAttribute('href', '/portfolio/p1?tab=team')
    expect(screen.getByRole('button', { name: 'Severely over-allocated' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('changes the load filter from the chips', async () => {
    const user = userEvent.setup()
    renderWithProviders(<PeoplePage />, { path: '/people', user: USERS.PM })
    await screen.findByRole('table', { name: 'People' })
    expect(lastRequest()).not.toHaveProperty('load')
    await user.click(screen.getByRole('button', { name: 'Available capacity' }))
    await waitFor(() => expect(lastRequest()).toMatchObject({ load: 'UNDER', page: 1 }))
    await user.click(screen.getByRole('button', { name: 'All' }))
    await waitFor(() => expect(lastRequest()).not.toHaveProperty('load'))
  })

  it('shows an empty state', async () => {
    peopleApi.listPeople.mockResolvedValue({ items: [], page: 1, page_size: 25, total: 0 })
    renderWithProviders(<PeoplePage />, { path: '/people', user: USERS.EXEC })
    expect(await screen.findByText('No people match')).toBeInTheDocument()
  })
})
