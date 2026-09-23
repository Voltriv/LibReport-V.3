import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Sidebar from "./Sidebar";
import profileImage from "../assets/pfp.png";
import { broadcastAuthChange, clearAuthSession, getStoredUser } from "../api";

const LogoutModal = ({ open, onCancel, onConfirm }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl theme-panel ring-1 ring-slate-200 [[data-theme=dark]_&]:ring-stone-700 p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-xl bg-red-100 [[data-theme=dark]_&]:bg-red-900/20 flex items-center justify-center">
            <svg className="h-5 w-5 text-red-600 [[data-theme=dark]_&]:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-slate-900 [[data-theme=dark]_&]:text-stone-100">Confirm Logout</h3>
        </div>
        <p className="text-slate-600 [[data-theme=dark]_&]:text-stone-400 mb-6">
          Are you sure you want to logout? You'll need to sign in again to access the admin panel.
        </p>
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            className="rounded-xl px-4 py-2 ring-1 ring-slate-200 [[data-theme=dark]_&]:ring-stone-700 theme-panel text-slate-700 [[data-theme=dark]_&]:text-stone-200 hover:bg-slate-50 [[data-theme=dark]_&]:hover:bg-stone-800 transition-colors duration-200"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-xl px-4 py-2 bg-red-600 text-white hover:bg-red-700 transition-colors duration-200 flex items-center gap-2"
            onClick={onConfirm}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Logout
          </button>
        </div>
      </div>
    </div>
  );
};

const AdminPageLayout = ({
  title,
  eyebrow,
  description,
  meta,
  actions,
  actionsClassName = "",
  beforeHeader = null,
  beforeMain = null,
  children,
  hideUserMenu = false,
  mainClassName = "",
}) => {
  const navigate = useNavigate();
  const [userName, setUserName] = useState("Account");
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const stored = getStoredUser();
    if (!stored) return;
    const name = stored.fullName || stored.name || (stored.email ? String(stored.email).split("@")[0] : "");
    if (name) setUserName(name);
  }, []);

  useEffect(() => {
    if (!isMenuOpen) return undefined;
    const handleClick = (event) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target)) {
        setIsMenuOpen(false);
      }
    };
    const handleKey = (event) => {
      if (event.key === "Escape") {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [isMenuOpen]);

  const requestLogout = useCallback(() => {
    setShowLogoutModal(true);
    setIsMenuOpen(false);
  }, []);

  const handleLogout = useCallback(() => {
    setShowLogoutModal(false);
    clearAuthSession();
    broadcastAuthChange();
    navigate("/signin", { replace: true });
  }, [navigate]);

  const headerHasActions = Boolean(actions) || (!hideUserMenu);

  return (
    <div className="min-h-screen theme-shell">
      <Sidebar />
      {beforeMain}
      <main
        className={`admin-main pl-16 pr-6 pt-16 pb-8 md:pl-8 md:pr-8 md:pt-8 lg:pl-10 ${mainClassName}`}
      >
        {beforeHeader}
        {(title || description || headerHasActions) && (
          <header className="mb-8 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex-1">
              {eyebrow ? (
                <p className="text-sm font-semibold uppercase tracking-wide text-brand-green-muted [[data-theme=dark]_&]:text-brand-gold-soft">
                  {eyebrow}
                </p>
              ) : null}
              {title ? (
                <h1 className="text-3xl font-bold text-slate-900 [[data-theme=dark]_&]:text-stone-100">{title}</h1>
              ) : null}
              {description ? (
                <p className="text-slate-600 [[data-theme=dark]_&]:text-stone-400 mt-1">{description}</p>
              ) : null}
              {meta ? <div className="mt-2 text-sm text-slate-500 [[data-theme=dark]_&]:text-stone-400">{meta}</div> : null}
            </div>
            {headerHasActions ? (
              <div className={`flex flex-wrap items-center gap-3 ${actionsClassName}`}>
                {actions}
                {!hideUserMenu && (
                  <div className="relative" ref={menuRef}>
                    <button
                      type="button"
                      onClick={() => setIsMenuOpen((prev) => !prev)}
                      className="inline-flex items-center gap-3 rounded-xl bg-white/90 [[data-theme=dark]_&]:bg-stone-900/80 ring-1 ring-slate-200 [[data-theme=dark]_&]:ring-stone-700 px-4 py-2 shadow-lg hover:shadow-xl transition-all duration-200"
                      aria-haspopup="menu"
                      aria-expanded={isMenuOpen}
                    >
                      <img src={profileImage} alt="Profile" className="h-9 w-9 rounded-full ring-2 ring-brand-gold/20" />
                      <span className="text-sm font-medium text-slate-700 [[data-theme=dark]_&]:text-stone-200 max-w-[12rem] truncate" title={userName}>
                        {userName}
                      </span>
                      <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {isMenuOpen && (
                      <div className="absolute right-0 mt-3 w-52 rounded-xl theme-panel ring-1 ring-slate-200 [[data-theme=dark]_&]:ring-stone-700 shadow-xl p-2 z-50">
                        <button
                          type="button"
                          className="w-full text-left rounded-lg px-4 py-3 text-sm text-red-600 hover:bg-red-50 [[data-theme=dark]_&]:hover:bg-red-900/20 transition-colors duration-200 flex items-center gap-2"
                          onClick={requestLogout}
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                          </svg>
                          Logout
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : null}
          </header>
        )}
        {children}
      </main>
      <LogoutModal open={showLogoutModal} onCancel={() => setShowLogoutModal(false)} onConfirm={handleLogout} />
    </div>
  );
};

export default AdminPageLayout;
