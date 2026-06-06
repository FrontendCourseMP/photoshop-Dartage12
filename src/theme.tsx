import { createTheme } from '@mui/material/styles';

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#4f9dff' },
    background: {
      default: '#1e1e1e',
      paper: '#252526',
    },
  },
  typography: {
    fontSize: 13,
  },
  components: {
    MuiButton: {
      defaultProps: { size: 'small' },
      styleOverrides: { root: { textTransform: 'none' } },
    },
    MuiToolbar: {
      styleOverrides: { dense: { minHeight: 48 } },
    },
  },
});
