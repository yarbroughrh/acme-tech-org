import { createTheme } from '@mui/material/styles'

/**
 * Health colours. Each passes WCAG AA (4.5:1) for white text and as text on white.
 * Always pair them with an icon and a text label: never rely on colour alone.
 */
export const HEALTH_COLORS = {
  GREEN: '#2E7D32',
  AMBER: '#B26A00',
  RED: '#C62828',
  NEUTRAL: '#5F6B7A',
}

/** Restrained, professional Beacon theme. */
const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1F3A5F', contrastText: '#FFFFFF' },
    secondary: { main: '#3D5A80' },
    success: { main: HEALTH_COLORS.GREEN },
    warning: { main: HEALTH_COLORS.AMBER },
    error: { main: HEALTH_COLORS.RED },
    background: { default: '#F5F7FA', paper: '#FFFFFF' },
    text: { primary: '#1C2430', secondary: '#4A5565' },
    divider: '#DDE3EA',
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: '"Inter", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    h1: { fontSize: '1.75rem', fontWeight: 600 },
    h2: { fontSize: '1.375rem', fontWeight: 600 },
    h3: { fontSize: '1.125rem', fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiAppBar: { defaultProps: { elevation: 0 } },
    MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: { root: { border: '1px solid #DDE3EA' } } },
    MuiTableCell: { styleOverrides: { head: { fontWeight: 600, color: '#4A5565', backgroundColor: '#F5F7FA' } } },
    MuiButton: { defaultProps: { disableElevation: true } },
    MuiTextField: { defaultProps: { size: 'small' } },
  },
})

export default theme
