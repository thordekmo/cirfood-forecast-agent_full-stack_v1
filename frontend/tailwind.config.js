/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#0A8F4A", dark: "#086C38", soft: "#E6F4ED", accent: "#00B28F" }
      }
    },
  },
  plugins: [],
}
