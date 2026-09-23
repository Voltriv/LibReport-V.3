const tailwindConfig = require("./tailwind.workspace.config.js");

module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./app/**/*.{js,jsx,ts,tsx}"],
  theme: tailwindConfig.theme,
  darkMode: tailwindConfig.darkMode || "class"
};
