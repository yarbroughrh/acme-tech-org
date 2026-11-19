import { checkPassword, MIN_PASSWORD_LENGTH } from './passwordPolicy'

const failed = (pw) => checkPassword(pw).results.filter((r) => !r.met).map((r) => r.id)

describe('checkPassword', () => {
  it('accepts a 12-character password with every character class', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(12)
    expect(checkPassword('Abcdefghij1!').valid).toBe(true)
  })

  it('rejects 11 characters even with every class', () => {
    const result = checkPassword('Abcdefghi1!')
    expect(result.valid).toBe(false)
    expect(failed('Abcdefghi1!')).toEqual(['length'])
  })

  it.each([
    ['upper', 'abcdefghij1!'],
    ['lower', 'ABCDEFGHIJ1!'],
    ['digit', 'Abcdefghijk!'],
    ['symbol', 'Abcdefghijk1'],
  ])('reports a missing %s', (rule, pw) => {
    expect(checkPassword(pw).valid).toBe(false)
    expect(failed(pw)).toEqual([rule])
  })

  it('treats an empty value as failing every rule', () => {
    expect(failed('')).toEqual(['length', 'upper', 'lower', 'digit', 'symbol'])
    expect(checkPassword().valid).toBe(false)
  })
})
