import { isEmail } from './format'

/**
 * Validate the sign-in form.
 * @param {{email: string, password: string}} values
 * @returns {{email?: string, password?: string}} field errors
 */
export function validateLogin({ email, password }) {
  const errors = {}
  if (!email.trim()) errors.email = 'Enter your email address.'
  else if (!isEmail(email)) errors.email = 'Enter a valid email address, like name@acme.example.'
  if (!password) errors.password = 'Enter your password.'
  return errors
}
