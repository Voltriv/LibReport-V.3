const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const isWatch = process.argv.includes("--watch");
const tailwindArgs = [
  "-i",
  "./src/index.css",
  "-o",
  "./src/tailwind.css",
  "--config",
  "./tailwind.workspace.config.js"
];
if (isWatch) tailwindArgs.push("--watch");

const tailwindCli = path.resolve(__dirname, "../node_modules/@tailwindcss/cli/dist/index.mjs");
const tailwind = spawn(process.execPath, [tailwindCli, ...tailwindArgs], { stdio: "inherit" });

const cssPath = path.resolve(__dirname, "../src/tailwind.css");
const replaceInfinity = () => {
  if (!fs.existsSync(cssPath)) return;
  try {
    const css = fs.readFileSync(cssPath, "utf8");
    const next = css.replace(/calc\(infinity \* 1px\)/g, "9999px");
    if (next !== css) {
      fs.writeFileSync(cssPath, next, "utf8");
    }
  } catch (err) {
    console.warn("[tailwind-fix] unable to update rounded-full:", err.message);
  }
};

if (isWatch) {
  // Debounce writes because Tailwind touches the file frequently.
  let timer = null;
  const scheduleFix = () => {
    clearTimeout(timer);
    timer = setTimeout(replaceInfinity, 40);
  };
  fs.watch(path.dirname(cssPath), (eventType, filename) => {
    if (filename === path.basename(cssPath) && eventType === "change") {
      scheduleFix();
    }
  });
  replaceInfinity();
} else {
  tailwind.on("exit", (code) => {
    if (code === 0) replaceInfinity();
    process.exit(code);
  });
}

tailwind.on("exit", (code) => {
  if (isWatch) process.exit(code ?? 0);
});
