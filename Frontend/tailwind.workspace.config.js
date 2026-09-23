/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  darkMode: "class",
  theme: {
    borderRadius: {
      none: "0",
      sm: "0.125rem",
      DEFAULT: "0.25rem",
      md: "0.375rem",
      lg: "0.5rem",
      xl: "0.75rem",
      "2xl": "1.25rem",
      "3xl": "1.75rem",
      full: "9999px"
    },
    extend: {
      colors: {
        brand: {
          green: "#2F5D3A",
          greenDark: "#24432B",
          gold: "#D4A72C",
          goldInk: "#8A6B16",
          cream: "#F5F1E6"
        }
      },
      fontFamily: {
        display: ["'Lora'", "serif"],
        serif: ["'Merriweather'", "serif"]
      },
      boxShadow: {
        card: "0 15px 35px rgba(15,23,42,0.08)",
        soft: "0 8px 24px rgba(15,23,42,0.08)"
      }
    }
  },
  plugins: []
};
