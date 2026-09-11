/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#f0f5fa',
          100: '#dbe7f2',
          200: '#b8d2e6',
          300: '#8db7d6',
          400: '#5c96c2',
          500: '#3a78ab',
          600: '#2b5e8c',
          700: '#234b70',
          800: '#1d3f5e',
          900: '#002147', // RGMCET Signature Academic Navy Blue
          950: '#00142d',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        'academic': '0 2px 10px -2px rgba(0, 33, 71, 0.08), 0 1px 4px -1px rgba(0, 33, 71, 0.04)',
        'academic-hover': '0 8px 25px -4px rgba(0, 33, 71, 0.12), 0 3px 8px -2px rgba(0, 33, 71, 0.06)',
      }
    },
  },
  plugins: [],
}
