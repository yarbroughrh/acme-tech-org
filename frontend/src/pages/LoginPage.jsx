import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Alert, Box, Button, CircularProgress, IconButton, InputAdornment, Paper, Stack, TextField, Typography,
} from '@mui/material'
import Visibility from '@mui/icons-material/Visibility'
import VisibilityOff from '@mui/icons-material/VisibilityOff'
import { useAuth } from '../auth/AuthContext'
import { homeFor } from '../auth/roles'
import { validateLogin } from '../utils/validation'

/** Sign-in page. Server errors are shown generically (never reveal whether an email exists). */
export default function LoginPage() {
  const { login, expired } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [values, setValues] = useState({ email: '', password: '' })
  const [errors, setErrors] = useState({})
  const [touched, setTouched] = useState({})
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState('')

  const handleChange = (field) => (event) => {
    const next = { ...values, [field]: event.target.value }
    setValues(next)
    if (touched[field]) setErrors(validateLogin(next))
  }

  const handleBlur = (field) => () => {
    setTouched((t) => ({ ...t, [field]: true }))
    setErrors(validateLogin(values))
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    const found = validateLogin(values)
    setErrors(found)
    setTouched({ email: true, password: true })
    if (Object.keys(found).length) return
    setSubmitting(true)
    setServerError('')
    try {
      const user = await login(values.email.trim(), values.password)
      if (user.must_change_password) navigate('/change-password', { replace: true })
      else navigate(location.state?.from && location.state.from !== '/login' ? location.state.from : homeFor(user.role), { replace: true })
    } catch (err) {
      setServerError(err.message || 'Sign-in failed. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2, bgcolor: 'background.default' }}>
      <Paper component="main" sx={{ p: { xs: 3, sm: 4 }, width: '100%', maxWidth: 420 }}>
        <Typography variant="h1" component="h1" gutterBottom>Beacon</Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>Sign in to see portfolio health.</Typography>
        {expired && !serverError && (
          <Alert severity="info" role="status" sx={{ mb: 2 }}>Your session expired. Please sign in again.</Alert>
        )}
        {serverError && <Alert severity="error" sx={{ mb: 2 }} role="alert">{serverError}</Alert>}
        <Box component="form" noValidate onSubmit={handleSubmit}>
          <Stack spacing={2}>
            <TextField
              id="email"
              label="Email"
              type="email"
              autoComplete="username"
              required
              fullWidth
              size="medium"
              value={values.email}
              onChange={handleChange('email')}
              onBlur={handleBlur('email')}
              error={Boolean(touched.email && errors.email)}
              helperText={touched.email && errors.email ? errors.email : ' '}
              disabled={submitting}
              autoFocus
            />
            <TextField
              id="password"
              label="Password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              fullWidth
              size="medium"
              value={values.password}
              onChange={handleChange('password')}
              onBlur={handleBlur('password')}
              error={Boolean(touched.password && errors.password)}
              helperText={touched.password && errors.password ? errors.password : ' '}
              disabled={submitting}
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        onClick={() => setShowPassword((s) => !s)}
                        edge="end"
                      >
                        {showPassword ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />
            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={submitting}
              startIcon={submitting ? <CircularProgress size={18} color="inherit" /> : undefined}
            >
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </Stack>
        </Box>
      </Paper>
    </Box>
  )
}
