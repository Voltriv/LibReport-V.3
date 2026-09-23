import React, { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import logo from "../assets/fav_logo.png";
import api, { getStoredUser } from "../api";
import ThemeToggle from "./ThemeToggle";

const Sidebar = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isDesktopCollapsed, setIsDesktopCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem("lr_admin_sidebar_collapsed") === "1";
    } catch {
      return false;
    }
  });
  const [healthState, setHealthState] = useState({ status: "checking", time: null });

  const refreshHealth = useCallback(async () => {
    setHealthState((current) => ({ ...current, status: "checking" }));
    try {
      const response = await api.get("/health");
      const data = response?.data || {};
      const isOnline = Boolean(data.ok) && (typeof data.db === "undefined" || Boolean(data.db));
      setHealthState({
        status: isOnline ? "online" : "offline",
        time: data.time || new Date().toISOString(),
      });
    } catch {
      setHealthState({
        status: "offline",
        time: new Date().toISOString(),
      });
    }
  }, []);

  // Ensure admin pages reserve space for the fixed sidebar
  useLayoutEffect(() => {
    if (typeof document === "undefined") return undefined;
    const { body } = document;
    body.classList.add("has-admin-sidebar");
    return () => {
      body.classList.remove("has-admin-sidebar");
      body.classList.remove("admin-sidebar-collapsed");
    };
  }, []);

  // Persist collapsed state and mirror it on the document body
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.body.classList.toggle("admin-sidebar-collapsed", isDesktopCollapsed);
    }
    try {
      localStorage.setItem("lr_admin_sidebar_collapsed", isDesktopCollapsed ? "1" : "0");
    } catch {}
  }, [isDesktopCollapsed]);

  // Poll backend health once a minute to keep the indicator fresh
  useEffect(() => {
    refreshHealth();
    const timer = setInterval(refreshHealth, 60000);
    return () => clearInterval(timer);
  }, [refreshHealth]);

  const handleMenuToggle = useCallback(() => {
    if (typeof window !== "undefined" && window.innerWidth >= 768) {
      setIsDesktopCollapsed(false);
      setIsOpen(false);
      return;
    }
    setIsOpen((prev) => !prev);
  }, []);

  const toggleButtonLabel = isDesktopCollapsed ? "Expand menu" : isOpen ? "Close menu" : "Open menu";
  const sidebarTranslate = isOpen ? "translate-x-0" : "-translate-x-full";
  const desktopTranslate = isDesktopCollapsed ? "md:-translate-x-full" : "md:translate-x-0";
  const toggleButtonClassName = [
    "fixed top-3 left-3 z-50 inline-flex h-10 w-10 items-center justify-center rounded-md bg-white/90 [[data-theme=dark]_&]:bg-stone-900/80 ring-1 ring-slate-200 [[data-theme=dark]_&]:ring-stone-700 shadow transition",
    isDesktopCollapsed ? "md:inline-flex" : "md:hidden",
  ].join(" ");

  const baseLink =
    "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-white/90 hover:bg-white/10 hover:text-white transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 group";
  const activeLink = "bg-white/20 text-white shadow-lg ring-1 ring-white/20";
  const primaryNav = [
    { to: "/dashboard", label: "Dashboard", icon: "" },
    { to: "/tracker", label: "Tracker", icon: "" },
    { to: "/attendance", label: "Attendance", icon: "" },
    { to: "/usage-heatmaps", label: "Usage Heatmaps", icon: "" },
    { to: "/reports", label: "Reports", icon: "" },
    { to: "/library", label: "Library", icon: "" },
  ];
  const managementNav = [
    { to: "/usermanagement", label: "User Management", icon: "" },
    { to: "/booksmanagement", label: "Books Management", icon: "" },
    { to: "/borrowing", label: "Borrow Management", icon: "" },

    { to: "/admins", label: "Admins", icon: "" },
  ];

  return (
    <>
      {/* Mobile hamburger */}
      <button
        className={toggleButtonClassName}
        onClick={handleMenuToggle}
        aria-label={toggleButtonLabel}
        aria-expanded={isDesktopCollapsed ? false : isOpen}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6 text-slate-700 [[data-theme=dark]_&]:text-stone-200">
          <path fillRule="evenodd" d="M3.75 5.25a.75.75 0 01.75-.75h15a.75.75 0 010 1.5h-15a.75.75 0 01-.75-.75zm0 6a.75.75 0 01.75-.75h15a.75.75 0 010 1.5h-15a.75.75 0 01-.75-.75zm0 6a.75.75 0 01.75-.75h15a.75.75 0 010 1.5h-15a.75.75 0 01-.75-.75z" clipRule="evenodd" />
        </svg>
      </button>

      <aside
        className={`sidebar-scroll sidebar-surface fixed top-0 left-0 h-full w-80 transform transition-all duration-300 ease-out text-white shadow-2xl z-40 overflow-y-auto ${sidebarTranslate} ${desktopTranslate}`}
      >
        <div className="flex items-center justify-between gap-4 p-6 border-b border-white/20 backdrop-blur-sm">
          <div className="flex items-center gap-4">
            <div className="relative rounded-2xl bg-white/95 p-1 shadow-lg ring-1 ring-brand-gold/40">
              <img src={logo} alt="Logo" className="h-10 w-10 rounded-xl object-contain" />
              <div className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-brand-gold shadow-sm"></div>
            </div>
            <div>
              <span className="text-xl font-bold">LibReport</span>
              <div className="text-xs text-white/70 font-medium">Admin Portal</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              className="md:hidden inline-flex h-10 w-10 items-center justify-center rounded-md bg-white/10 text-white shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
              onClick={() => setIsOpen(false)}
              aria-label="Close menu"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
                <path
                  fillRule="evenodd"
                  d="M6.225 4.811a.75.75 0 011.06 0L12 9.525l4.716-4.714a.75.75 0 111.06 1.06L13.06 10.586l4.716 4.714a.75.75 0 11-1.06 1.061L12 11.646l-4.715 4.715a.75.75 0 11-1.06-1.061l4.714-4.714-4.714-4.714a.75.75 0 010-1.061z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
            <button
              className="hidden md:inline-flex h-10 w-10 items-center justify-center rounded-md bg-white/10 text-white shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
              onClick={() => {
                setIsDesktopCollapsed(true);
                setIsOpen(false);
              }}
              aria-label="Collapse sidebar"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
                <path
                  fillRule="evenodd"
                  d="M20.03 19.53a.75.75 0 01-1.06 0l-6.25-6.25a.75.75 0 010-1.06l6.25-6.25a.75.75 0 111.06 1.06L14.31 12l5.72 5.72a.75.75 0 010 1.06z"
                  clipRule="evenodd"
                />
                <path d="M10.5 5.25a.75.75 0 01-.75.75h-5a.75.75 0 010-1.5h5a.75.75 0 01.75.75zm0 6a.75.75 0 01-.75.75h-5a.75.75 0 010-1.5h5a.75.75 0 01.75.75zm0 6a.75.75 0 01-.75.75h-5a.75.75 0 010-1.5h5a.75.75 0 01.75.75z" />
              </svg>
            </button>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="space-y-2">
            <h3 className="px-4 py-2 text-xs font-bold text-white/60 uppercase tracking-wider">Overview</h3>
            {primaryNav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setIsOpen(false)}
                className={({ isActive }) => `${baseLink} ${isActive ? activeLink : ""}`}
              >
                <span className="text-lg group-hover:scale-110 transition-transform duration-200">{item.icon}</span>
                {item.label}
              </NavLink>
            ))}
          </div>

          <div className="border-t border-white/20 pt-6">
            <h3 className="px-4 py-2 text-xs font-bold text-white/60 uppercase tracking-wider">Management</h3>
            <div className="space-y-2">
              {(getStoredUser()?.role === 'librarian_staff' ? managementNav.filter((i) => i.to !== '/admins') : managementNav).map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  onClick={() => setIsOpen(false)}
                  className={({ isActive }) => `${baseLink} ${isActive ? activeLink : ""}`}
                >
                  <span className="text-lg group-hover:scale-110 transition-transform duration-200">{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
        </nav>

        <div className="border-t border-white/10 px-6 py-5 text-xs text-white/80 space-y-4">
          <ThemeToggle variant="sidebar" className="w-full justify-between" />
          <div className="flex items-center justify-between text-white">
            <span className="font-semibold uppercase tracking-wider text-[0.65rem] text-white/70">
              System Status
            </span>
            {healthState.status === "checking" ? (
              <span className="inline-flex items-center gap-2 text-[0.65rem] text-white/70">
                <span className="h-2 w-2 animate-pulse rounded-full bg-white/80" />
                Checking...
              </span>
            ) : (
              <span
                className={`inline-flex items-center gap-2 text-[0.65rem] font-semibold ${
                  healthState.status === "online" ? "text-emerald-200" : "text-red-200"
                }`}
              >
                <span
                  className={`h-2.5 w-2.5 rounded-full ${
                    healthState.status === "online" ? "bg-emerald-400" : "bg-red-400"
                  } animate-pulse`}
                />
                {healthState.status === "online" ? "Connected" : "Offline"}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={refreshHealth}
            className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/20 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-widest text-white/80 transition hover:border-white/40 hover:text-white"
          >
            Refresh
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0114.13-3.36L23 10" />
              <path d="M20.49 15a9 9 0 01-14.13 3.36L1 14" />
            </svg>
          </button>
          {healthState.time && (
            <p className="mt-3 text-[0.6rem] uppercase tracking-widest text-white/50">
              Updated {new Date(healthState.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
        </div>
      </aside>

      {/* Spacer for layout on md+ */}
      <div className={`hidden md:block ${isDesktopCollapsed ? 'w-0' : 'w-80'} shrink-0 transition-[width] duration-300`} />
    </>
  );
};

export default Sidebar;
