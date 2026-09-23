import React from "react";
import { Link } from "react-router-dom";

const defaultTone = "blue";

const iconFallback = (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 6h.01" />
  </svg>
);

const StatTile = ({
  title,
  value,
  subtitle = "",
  tone = defaultTone,
  icon,
  to,
  ariaLabel,
  className = "",
}) => {
  const Component = to ? Link : "div";
  const componentProps = {
    className: ["stat-tile", className].filter(Boolean).join(" "),
    "data-tone": tone,
  };
  if (to) {
    componentProps.to = to;
    if (ariaLabel) componentProps["aria-label"] = ariaLabel;
  }

  return (
    <Component {...componentProps}>
      <div>
        <p className="stat-tile__label">{title}</p>
        <p className="stat-tile__value">{value}</p>
        {subtitle ? <p className="stat-tile__meta">{subtitle}</p> : null}
      </div>
      <div className="stat-tile__icon">{icon || iconFallback}</div>
    </Component>
  );
};

export default StatTile;
