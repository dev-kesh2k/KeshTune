/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#09090d',
        surface: '#13131a',
        surface2: '#1c1c26',
        line: '#2a2a37',
        muted: '#9d9db2',
        accent: { DEFAULT: '#8b5cf6', soft: '#a78bfa', deep: '#6d28d9' },
        lime: { x: '#c6f432' },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
