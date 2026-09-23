import React from "react";
import { applyTheme, getActiveTheme, nextTheme } from "../theme";

const ICON_SIZE = 16;

const SunIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={ICON_SIZE}
    height={ICON_SIZE}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="5" />
    <path d="M12 1v2" />
    <path d="M12 21v2" />
    <path d="m4.22 4.22 1.42 1.42" />
    <path d="m18.36 18.36 1.42 1.42" />
    <path d="M1 12h2" />
    <path d="M21 12h2" />
    <path d="m4.22 19.78 1.42-1.42" />
    <path d="m18.36 5.64 1.42-1.42" />
  </svg>
);

const MoonIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={ICON_SIZE}
    height={ICON_SIZE}
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 7 7 0 1 0 21 14.5Z" />
  </svg>
);

const ThemeToggle = ({ className = "", hideLabel = false, variant = "default" }) => {
  const readTheme = React.useCallback(() => getActiveTheme(), []);
  const [theme, setTheme] = React.useState(() => readTheme());

  React.useEffect(() => {
    setTheme(readTheme());
    if (typeof window === "undefined") return undefined;
    const handleThemeChange = (event) => {
      const next = event?.detail?.theme;
      setTheme(next || readTheme());
    };
    window.addEventListener("lr:theme-change", handleThemeChange);
    return () => window.removeEventListener("lr:theme-change", handleThemeChange);
  }, [readTheme]);

  const toggleTheme = React.useCallback(() => {
    setTheme((prev) => {
      const next = nextTheme(prev);
      applyTheme(next);
      return next;
    });
  }, []);

  const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  const readable = theme === "dark" ? "Dark mode" : "Light mode";
  const icon = theme === "dark" ? <MoonIcon /> : <SunIcon />;

  return (
    <button
      type="button"
      className={`theme-toggle inline-flex items-center gap-3 text-xs font-semibold uppercase tracking-wide ${className}`.trim()}
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      data-variant={variant}
    >
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand-gold-soft text-brand-gold shadow-sm">
        {icon}
      </span>
      {!hideLabel && <span className="mode-label">{readable}</span>}
    </button>
  );
};

export default ThemeToggle;
