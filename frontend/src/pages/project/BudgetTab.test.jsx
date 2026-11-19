import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders, USERS } from '../../test/renderWithProviders'
import BudgetTab from './BudgetTab'
import * as spendApi from '../../api/spend'
import { validateSpend, lastWeekMonday, formatWeek } from '../../utils/spend'

vi.mock('../../api/spend', () => ({ listSpend: vi.fn(), saveSpend: vi.fn() }))

const project = (perm) => ({ id: 'p1', permissions: { can_record_spend: perm } })
const entries = [
  { id: 'e1', week_starting: '2026-11-02', category: 'LABOUR', amount: 12000, note: 'Sprint 7', updated_at: '2026-11-03T10:00:00Z', updated_by: { id: 'u', display_name: 'Morgan Patel' } },
  { id: 'e2', week_starting: '2026-11-09', category: 'CONTRACTORS_VENDORS', amount: 4500, note: null, updated_at: '2026-11-10T10:00:00Z', updated_by: null },
]

describe('BudgetTab', () => {
  beforeEach(() => {
    spendApi.listSpend.mockResolvedValue({ items: entries, totals: { approved_budget: 500000, spend_to_date: 16500, planned_to_date: 20000 } })
  })
  afterEach(() => vi.clearAllMocks())

  it('renders totals and entries newest first', async () => {
    renderWithProviders(<BudgetTab project={project(false)} />, { user: USERS.EXEC })
    const table = await screen.findByRole('table', { name: 'Weekly spend' })
    const rows = within(table).getAllByRole('row')
    expect(rows[1]).toHaveTextContent('Contractors and vendors')
    expect(rows[2]).toHaveTextContent('Labour')
    expect(rows[2]).toHaveTextContent('$12,000')
    expect(screen.getByText('$500,000')).toBeInTheDocument()
    expect(screen.getByText(/Planned to date = approved budget/)).toBeInTheDocument()
  })

  it('shows no recording or edit controls without can_record_spend (e.g. a PM)', async () => {
    renderWithProviders(<BudgetTab project={project(false)} />, { user: USERS.PM })
    await screen.findByRole('table', { name: 'Weekly spend' })
    expect(screen.queryByRole('button', { name: 'Record weekly spend' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Edit/ })).not.toBeInTheDocument()
  })

  it('blocks a non-Monday week with a clear message', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BudgetTab project={project(true)} />, { user: USERS.PMO })
    await user.click(await screen.findByRole('button', { name: 'Record weekly spend' }))
    const week = screen.getByLabelText(/Week starting/)
    await user.clear(week)
    await user.type(week, '2026-11-11')
    await user.type(screen.getByLabelText(/Amount/), '100')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Week starting must be a Monday.')).toBeInTheDocument()
    expect(spendApi.saveSpend).not.toHaveBeenCalled()
  })

  it('validates future weeks', () => {
    expect(validateSpend({ week_starting: '2099-01-05', category: 'LABOUR', amount: '1', note: '' }).week_starting)
      .toBe("Week starting can't be in the future.")
    expect(validateSpend({ week_starting: lastWeekMonday(), category: 'LABOUR', amount: '1', note: '' })).toEqual({})
    expect(validateSpend({ week_starting: lastWeekMonday(), category: 'LABOUR', amount: '0', note: '' }).amount).toBeTruthy()
  })

  it('records spend and says it was recorded', async () => {
    spendApi.saveSpend.mockResolvedValue({ entry: {}, created: true })
    const user = userEvent.setup()
    renderWithProviders(<BudgetTab project={project(true)} />, { user: USERS.PMO })
    await user.click(await screen.findByRole('button', { name: 'Record weekly spend' }))
    await user.type(screen.getByLabelText(/Amount/), '2500')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(spendApi.saveSpend).toHaveBeenCalled())
    const [pid, body, key] = spendApi.saveSpend.mock.calls[0]
    expect(pid).toBe('p1')
    expect(body).toEqual({ week_starting: lastWeekMonday(), category: 'LABOUR', amount: 2500 })
    expect(key).toBeTruthy()
    expect(await screen.findByText(`Recorded spend for week of ${formatWeek(lastWeekMonday())}.`)).toBeInTheDocument()
  })

  it('edits with week and category locked, and says the existing entry was updated', async () => {
    spendApi.saveSpend.mockResolvedValue({ entry: {}, created: false })
    const user = userEvent.setup()
    renderWithProviders(<BudgetTab project={project(true)} />, { user: USERS.PMO })
    await user.click(await screen.findByRole('button', { name: /Edit Labour for week of/ }))
    expect(screen.getByLabelText(/Week starting/)).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveAttribute('aria-disabled', 'true')
    const amount = screen.getByLabelText(/Amount/)
    await user.clear(amount)
    await user.type(amount, '13000')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(`Updated the existing Labour entry for week of ${formatWeek('2026-11-02')}.`)).toBeInTheDocument()
    expect(spendApi.saveSpend.mock.calls[0][1]).toMatchObject({ week_starting: '2026-11-02', category: 'LABOUR', amount: 13000, note: 'Sprint 7' })
  })
})
