import { formatDate, formatDateTime, formatUsd, isEmail } from './format'
import { validateLogin } from './validation'

describe('format helpers', () => {
  it('formats USD without cents and handles missing values', () => {
    expect(formatUsd(1250000)).toBe('$1,250,000')
    expect(formatUsd(null)).toBe('—')
    expect(formatUsd('abc')).toBe('—')
  })

  it('formats ISO dates in UTC', () => {
    expect(formatDate('2026-11-19')).toBe('19 Nov 2026')
    expect(formatDate(null)).toBe('—')
    expect(formatDate('nonsense')).toBe('—')
    expect(formatDateTime(null)).toBe('—')
    expect(formatDateTime('bad')).toBe('—')
    expect(formatDateTime('2026-11-19T10:00:00Z')).toMatch(/2026/)
  })

  it('validates email format', () => {
    expect(isEmail('pm@acme.example')).toBe(true)
    expect(isEmail('not-an-email')).toBe(false)
  })

  it('validates the login form', () => {
    expect(validateLogin({ email: '', password: '' })).toEqual({ email: 'Enter your email address.', password: 'Enter your password.' })
    expect(validateLogin({ email: 'x', password: 'p' }).email).toMatch(/valid email/)
    expect(validateLogin({ email: 'a@b.co', password: 'p' })).toEqual({})
  })
})
