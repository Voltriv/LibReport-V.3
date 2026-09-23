export const surfacePanelClass =
  "interactive-card rounded-3xl bg-white/90 [[data-theme=dark]_&]:bg-stone-900/80 ring-1 ring-slate-200/70 [[data-theme=dark]_&]:ring-stone-700/80 shadow-card backdrop-blur";

export const cardAccentClass = (gradient) =>
  `rounded-3xl ring-1 ring-inset shadow-card transition transform hover:-translate-y-1 hover:shadow-xl bg-gradient-to-br ${gradient}`;

export const autoRefreshButtonClass = (active) =>
  [
    "inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium ring-1 transition-colors duration-200",
    active
      ? "bg-emerald-100 text-emerald-700 ring-emerald-300 [[data-theme=dark]_&]:bg-emerald-500/10 [[data-theme=dark]_&]:text-emerald-200 [[data-theme=dark]_&]:ring-emerald-500/40"
      : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-100 [[data-theme=dark]_&]:bg-stone-900 [[data-theme=dark]_&]:text-stone-200 [[data-theme=dark]_&]:ring-stone-700 [[data-theme=dark]_&]:hover:bg-stone-800"
  ].join(" ");

export const interactiveCardClass =
  "interactive-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold/60 focus-visible:ring-offset-2";

export const inputClass = (base = "") => ["input-control", base].filter(Boolean).join(" ");
