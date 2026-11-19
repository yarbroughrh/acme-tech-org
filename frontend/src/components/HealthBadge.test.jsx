import { render, screen } from '@testing-library/react'
import HealthBadge from './HealthBadge'

describe('HealthBadge', () => {
  it.each([
    ['GREEN', 'Green'],
    ['AMBER', 'Amber'],
    ['RED', 'Red'],
  ])('shows %s with a text label and an icon, not colour alone', (health, label) => {
    render(<HealthBadge health={health} lifecycleStatus="ACTIVE" />)
    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.getByTestId(`health-icon-${health}`)).toBeInTheDocument()
  })

  it('includes the reasons in the accessible label and is focusable', () => {
    const reasons = ['Budget: spend is 14% ahead of plan.', "Milestones: 'UAT sign-off' is due in 3 days and 40% complete."]
    render(<HealthBadge health="AMBER" reasons={reasons} lifecycleStatus="ACTIVE" />)
    const badge = screen.getByRole('img', { name: /Health: Amber/ })
    expect(badge).toHaveAttribute('aria-label', expect.stringContaining('spend is 14% ahead of plan'))
    expect(badge).toHaveAttribute('aria-label', expect.stringContaining('UAT sign-off'))
    expect(badge).toHaveAttribute('tabindex', '0')
  })

  it('shows the lifecycle status for non-active projects', () => {
    render(<HealthBadge health="RED" lifecycleStatus="ON_HOLD" />)
    expect(screen.getByText('On hold')).toBeInTheDocument()
    expect(screen.queryByText('Red')).not.toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Health not calculated: project is On hold')
  })

  it('shows "Not calculated" for an active project without health', () => {
    render(<HealthBadge health={null} lifecycleStatus="ACTIVE" />)
    expect(screen.getByText('Not calculated')).toBeInTheDocument()
  })
})
