import React from "react";
import { surfacePanelClass, interactiveCardClass } from "../designSystem/classes";

const CollapsibleSection = ({
  title,
  subtitle,
  defaultOpen = true,
  actions = null,
  children,
  className = "",
}) => {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <section className={`${surfacePanelClass} ${interactiveCardClass} ${className}`}>
      <button
        type="button"
        className="collapsible-trigger"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        <div>
          <h3 className="text-lg font-bold text-slate-900 [[data-theme=dark]_&]:text-stone-100">{title}</h3>
          {subtitle && <p className="text-sm text-slate-600 [[data-theme=dark]_&]:text-stone-400">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          <span className="collapsible-chevron" data-open={open}>
            <svg className="h-5 w-5 text-slate-500" viewBox="0 0 24 24" stroke="currentColor" fill="none">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </span>
        </div>
      </button>
      <div
        className={`transition-all duration-300 overflow-hidden ${open ? "max-h-[4000px] opacity-100" : "max-h-0 opacity-0"}`}
        aria-hidden={!open}
      >
        <div className="pt-4">{children}</div>
      </div>
    </section>
  );
};

export default CollapsibleSection;

