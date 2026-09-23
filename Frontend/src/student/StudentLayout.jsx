import React from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import logo from "../assets/logo.png";

import api, { getStoredUser } from "../api";
import { useStudentPushNotifications } from "../notifications/useStudentPush";
import ThemeToggle from "../components/ThemeToggle";

const anchorSections = [
  { id: "home", label: "Home" },
  { id: "about", label: "About" },
  { id: "sections", label: "Library Sections" },
  { id: "services", label: "Library Services" },

  { id: "ebooks", label: "Ebook Collection" },
  { id: "support", label: "Support" }
];

const EMPTY_LOAN_STATUS = {
  pending: 0,
  approved: 0,
  overdue: 0,
  returned: 0
};

const LOAN_STATUS_DEFINITIONS = [
  {
    key: "pending",
    label: "Pending Requests",
    accentClass: "bg-amber-500",
    badgeClass: "bg-amber-100 text-amber-800",
    description: "Requests waiting for librarian approval."
  },
  {
    key: "approved",
    label: "Approved",
    accentClass: "bg-emerald-500",
    badgeClass: "bg-emerald-100 text-emerald-800",
    description: "Ready for pickup or already renewed."
  },
  {
    key: "overdue",
    label: "Overdue",
    accentClass: "bg-rose-500",
    badgeClass: "bg-rose-100 text-rose-800",
    description: "Items that should be returned right away."
  },
  {
    key: "returned",
    label: "Returned",
    accentClass: "bg-sky-500",
    badgeClass: "bg-sky-100 text-sky-800",
    description: "Loans completed and checked back in."
  }
];

const StudentLayout = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [accountDropdown, setAccountDropdown] = React.useState(false);
  const [loanUpdatesOpen, setLoanUpdatesOpen] = React.useState(false);
  
  const [user, setUser] = React.useState(() => getStoredUser());
  const [activeAnchor, setActiveAnchor] = React.useState("home");
  const [loanStatusCounts, setLoanStatusCounts] = React.useState(() => ({ ...EMPTY_LOAN_STATUS }));
  const [loanStatusLoading, setLoanStatusLoading] = React.useState(false);
  const [loanStatusError, setLoanStatusError] = React.useState("");
  const loanStatusFetchedRef = React.useRef(false);
  const lastLoanStatusFetch = React.useRef(0);
  const loanStatusLoadingRef = React.useRef(false);
  const layoutMountedRef = React.useRef(true);

  React.useEffect(() => {
    layoutMountedRef.current = true;
    return () => {
      layoutMountedRef.current = false;
    };
  }, []);

  React.useEffect(() => {
    const updateUser = () => setUser(getStoredUser());

    window.addEventListener("storage", updateUser);
    window.addEventListener("lr-auth-change", updateUser);
    return () => {
      window.removeEventListener("storage", updateUser);
      window.removeEventListener("lr-auth-change", updateUser);
    };
  }, []);

  React.useEffect(() => {
    setMenuOpen(false);
    setAccountDropdown(false);
    setLoanUpdatesOpen(false);

    if (location.pathname !== "/student") {
      setActiveAnchor("");
    }
  }, [location.pathname]);

  React.useEffect(() => {
    if (location.pathname !== "/student") return undefined;

    const handleScroll = () => {
      const offset = window.scrollY + 160;
      let current = "home";
      anchorSections.forEach((section) => {
        const element = document.getElementById(section.id);
        if (!element) return;
        const top = element.getBoundingClientRect().top + window.scrollY;
        if (top <= offset) {
          current = section.id;
        }
      });
      setActiveAnchor(current);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [location.pathname]);

  const isStudent = user?.role === "student";
  const isCatalog = location.pathname.startsWith("/student/catalog");
  const isAccount = location.pathname.startsWith("/student/account");
  useStudentPushNotifications(isStudent);

  React.useEffect(() => {
    if (!isStudent) {
      setLoanStatusCounts({ ...EMPTY_LOAN_STATUS });
      setLoanStatusError("");
      setLoanStatusLoading(false);
      loanStatusFetchedRef.current = false;
      loanStatusLoadingRef.current = false;
      lastLoanStatusFetch.current = 0;
      setAccountDropdown(false);
      setLoanUpdatesOpen(false);
    }
  }, [isStudent]);

  const fetchLoanStatuses = React.useCallback(
    async ({ force = false } = {}) => {
      if (!isStudent || !layoutMountedRef.current) {
        return;
      }

      const now = Date.now();
      if (!force && loanStatusFetchedRef.current && now - lastLoanStatusFetch.current < 60000) {
        return;
      }

      loanStatusLoadingRef.current = true;
      if (layoutMountedRef.current) {
        setLoanStatusLoading(true);
        setLoanStatusError("");
      }

      try {
        const [requestsRes, overdueRes, historyRes] = await Promise.all([
          api.get("/student/borrow-requests"),
          api.get("/student/overdue-books"),
          api.get("/student/borrowing-history")
        ]);

        if (!layoutMountedRef.current) {
          return;
        }

        const requests = Array.isArray(requestsRes?.data?.items) ? requestsRes.data.items : [];
        const pending = requests.filter(
          (item) => String(item?.status || "").toLowerCase() === "pending"
        ).length;
        const approved = requests.filter(
          (item) => String(item?.status || "").toLowerCase() === "approved"
        ).length;

        const overdue = Array.isArray(overdueRes?.data?.books) ? overdueRes.data.books.length : 0;

        const history = Array.isArray(historyRes?.data?.history) ? historyRes.data.history : [];
        const returned = history.filter(
          (item) => String(item?.status || "").toLowerCase() === "returned"
        ).length;

        setLoanStatusCounts({ pending, approved, overdue, returned });
        loanStatusFetchedRef.current = true;
        lastLoanStatusFetch.current = Date.now();
      } catch (err) {
        if (layoutMountedRef.current) {
          const fallback = "Unable to load your book notifications right now.";
          setLoanStatusError(err?.response?.data?.error || fallback);
        }
      } finally {
        loanStatusLoadingRef.current = false;
        if (layoutMountedRef.current) {
          setLoanStatusLoading(false);
        }
      }
    },
    [isStudent]
  );

  React.useEffect(() => {
    if (!isStudent) {
      return;
    }
    fetchLoanStatuses({ force: true });
  }, [fetchLoanStatuses, isStudent]);

  React.useEffect(() => {
    if (!isStudent || !loanUpdatesOpen) {
      return;
    }
    const shouldRefresh =
      !loanStatusFetchedRef.current ||
      Date.now() - lastLoanStatusFetch.current > 60000 ||
      loanStatusError;
    if (shouldRefresh && !loanStatusLoadingRef.current) {
      fetchLoanStatuses({ force: true });
    }
  }, [loanUpdatesOpen, fetchLoanStatuses, isStudent, loanStatusError]);

  const handleRefreshLoanStatuses = React.useCallback(() => {
    fetchLoanStatuses({ force: true });
  }, [fetchLoanStatuses]);

  const totalLoanAlerts = React.useMemo(
    () =>
      Object.values(loanStatusCounts).reduce(
        (sum, value) => sum + (Number.isFinite(Number(value)) ? Number(value) : 0),
        0
      ),
    [loanStatusCounts]
  );
  const loanBadgeClassName =
    totalLoanAlerts > 0
      ? "bg-emerald-500 text-white shadow-sm"
      : "bg-slate-200 text-slate-600";
  const loanBadgeLabel = totalLoanAlerts > 99 ? "99+" : String(totalLoanAlerts);

  const renderLoanStatusContent = () => {
    if (loanStatusLoading) {
      return (
        <div className="space-y-2">
          {[0, 1, 2].map((idx) => (
            <div key={idx} className="h-9 w-full animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      );
    }

    return (
      <>
        <div className="space-y-2">
          {LOAN_STATUS_DEFINITIONS.map((meta) => {
            const value = Number(loanStatusCounts[meta.key] || 0);
            const isActive = value > 0;
            return (
              <div
                key={meta.key}
                className={`flex flex-col gap-2 rounded-xl border px-3 py-3 text-xs transition ${
                  isActive
                    ? "border-slate-200 bg-white text-slate-700 shadow-sm"
                    : "border-slate-100 bg-slate-50 text-slate-500"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-semibold">
                    <span
                      className={`h-2.5 w-2.5 rounded-full ${
                        isActive ? `${meta.accentClass} animate-pulse` : "bg-slate-300"
                      }`}
                    />
                    {meta.label}
                  </span>
                  <span
                    className={`inline-flex min-w-[2.25rem] justify-center rounded-full px-2 py-0.5 text-[0.65rem] font-semibold ${
                      isActive ? meta.badgeClass : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {value}
                  </span>
                </div>
                {meta.description ? (
                  <p className="text-[0.63rem] font-medium leading-relaxed text-slate-500">
                    {meta.description}
                  </p>
                ) : null}
              </div>
            );
          })}
          {!loanStatusError && totalLoanAlerts === 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[0.65rem] text-slate-500">
              You're all caught up - no pending activity.
            </div>
          )}
        </div>
        {loanStatusError ? (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[0.65rem] text-red-600">
            {loanStatusError}
          </div>
        ) : null}
      </>
    );
  };

  const scrollToSection = (target) => {
    const executeScroll = () => {
      const el = document.getElementById(target);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    if (location.pathname !== "/student") {
      navigate("/student", { state: { scrollTo: target } });
    } else {
      executeScroll();
    }
  };

  const onAnchorClick = (target) => {
    setMenuOpen(false);

    setActiveAnchor(target);

    scrollToSection(target);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 text-slate-900">

      <header className="sticky top-0 z-50 border-b border-slate-200/60 bg-white/95 backdrop-blur-md shadow-sm">

        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 lg:px-6">
          <div className="flex items-center gap-3">
            <Link to="/student" className="flex items-center gap-3 group">
              <div className="relative">
                <img src={logo} alt="LibReport" className="h-12 w-12 rounded-xl border-2 border-slate-200 shadow-sm transition-transform group-hover:scale-105" />
                <div className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-brand-green shadow-sm"></div>
              </div>
              <div className="hidden sm:block">
                <div className="text-sm font-bold uppercase tracking-wide text-brand-green">LibReport</div>
                <div className="text-xs text-slate-500 font-medium">Student Portal</div>
              </div>
            </Link>
          </div>
          <button
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200/60 px-4 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-all hover:bg-slate-50 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold lg:hidden"
            onClick={() => setMenuOpen((s) => !s)}
            aria-label="Toggle navigation"
          >
            <span>Menu</span>
            <svg className={`h-4 w-4 transition-transform ${menuOpen ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M3 5h14a1 1 0 010 2H3a1 1 0 010-2zm0 4h14a1 1 0 010 2H3a1 1 0 010-2zm0 4h14a1 1 0 010 2H3a1 1 0 010-2z" clipRule="evenodd" />
            </svg>
          </button>
          <nav className="hidden items-center gap-8 text-sm font-medium text-slate-700 lg:flex">
            {anchorSections.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onAnchorClick(item.id)}
                className={`student-nav-link transition-all duration-200 ${
                  location.pathname === "/student" && activeAnchor === item.id ? "is-active" : ""
                }`}
              >
                {item.label}
              </button>
            ))}

            <Link
              to="/student/catalog"
              className={`student-nav-link transition-all duration-200 ${isCatalog ? "is-active" : ""}`}
            >
              Catalog
            </Link>
            <ThemeToggle className="hidden lg:inline-flex lg:ml-2" hideLabel />
            {isStudent ? (
              <div className="flex items-center gap-2.5">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setLoanUpdatesOpen((prev) => !prev);
                      setAccountDropdown(false);
                    }}
                    className={`relative inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200/80 bg-white text-slate-600 transition-all duration-200 ${
                      loanUpdatesOpen ? "ring-2 ring-brand-green/40 shadow-lg text-brand-green" : "hover:shadow-md hover:text-brand-green"
                    }`}
                    >
                    <span className="sr-only">Loan updates</span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 10a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                      <path d="M12 8v4l2.5 1.5" />
                    </svg>
                    <span
                      className={`absolute -top-1 -right-1 inline-flex min-w-[1.5rem] justify-center rounded-full px-2 text-[0.65rem] font-semibold transition ${loanBadgeClassName}`}
                    >
                      {loanBadgeLabel}
                    </span>
                  </button>
                  {loanUpdatesOpen && (
                    <div className="absolute right-0 mt-3 w-64 rounded-xl bg-white/95 backdrop-blur-md py-3 shadow-xl ring-1 ring-slate-200/60 focus:outline-none z-20 animate-in slide-in-from-top-2 duration-200">
                      <div className="flex items-center justify-between px-4 text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500">
                        <span>Loan Updates</span>
                        <button
                          type="button"
                          onClick={handleRefreshLoanStatuses}
                          disabled={loanStatusLoading}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                          aria-label="Refresh loan updates"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="23 4 23 10 17 10" />
                            <polyline points="1 20 1 14 7 14" />
                            <path d="M3.51 9a9 9 0 0 1 14.63-3.36L23 10" />
                            <path d="M20.49 15a9 9 0 0 1-14.63 3.36L1 14" />
                          </svg>
                        </button>
                      </div>
                      <div className="mt-3 px-4 pb-2">{renderLoanStatusContent()}</div>
                      <div className="border-t border-slate-200/60 px-4 pt-2 text-[0.6rem] text-slate-500">
                        <button
                          type="button"
                          onClick={() => {
                            setLoanUpdatesOpen(false);
                            navigate("/student/borrow-requests");
                          }}
                          className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-100"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M4 4h16v12H5.17L4 17.17V4z" />
                            <path d="M8 8h8" />
                            <path d="M8 12h6" />
                          </svg>
                          View all requests
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="relative">
                  <button
                    onClick={() => {
                      setAccountDropdown((prev) => !prev);
                      setLoanUpdatesOpen(false);
                    }}
                    className={`btn-student-primary btn-pill-sm flex items-center gap-2 transition-all duration-200 ${isAccount ? "shadow-lg ring-2 ring-brand-gold/20" : ""}`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                    My Account
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform duration-200 ${accountDropdown ? 'rotate-180' : ''}`}>
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>
                  {accountDropdown && (
                    <div className="absolute right-0 mt-3 w-56 rounded-xl bg-white/95 backdrop-blur-md py-2 shadow-xl ring-1 ring-slate-200/60 focus:outline-none z-10 animate-in slide-in-from-top-2 duration-200">
                      <Link to="/student/account" className="flex items-center gap-3 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition-colors" onClick={() => setAccountDropdown(false)}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                          <circle cx="12" cy="7" r="4" />
                        </svg>
                        My Account
                      </Link>
                      <Link to="/student/borrow-requests" className="flex items-center gap-3 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition-colors" onClick={() => setAccountDropdown(false)}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M4 4h16v12H5.17L4 17.17V4z" />
                          <path d="M8 8h8" />
                          <path d="M8 12h6" />
                        </svg>
                        Borrow Requests
                      </Link>
                      <Link to="/student/overdue-books" className="flex items-center gap-3 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition-colors" onClick={() => setAccountDropdown(false)}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" />
                          <polyline points="12,6 12,12 16,14" />
                        </svg>
                        Overdue Books
                      </Link>
                      <Link to="/student/borrowing-history" className="flex items-center gap-3 px-4 py-3 text-sm text-slate-700 hover:bg-slate-50 transition-colors" onClick={() => setAccountDropdown(false)}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                          <path d="M3 3v5h5" />
                        </svg>
                        Borrowing History
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Link
                  to="/student/signin"
                  className="btn-student-outline btn-pill-sm transition-all duration-200 hover:shadow-md"
                >
                  Sign In
                </Link>
                <Link
                  to="/student/signup"
                  className="btn-student-primary btn-pill-sm transition-all duration-200 hover:shadow-lg hover:scale-105"
                >
                  Sign Up
                </Link>
              </div>
            )}
          </nav>
        </div>
        {menuOpen && (
          <div className="border-t border-slate-200/60 bg-white/95 backdrop-blur-md lg:hidden animate-in slide-in-from-top-2 duration-200">
            <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-4 text-sm font-medium text-slate-700">
              {anchorSections.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onAnchorClick(item.id)}
                  className={`student-nav-link w-full rounded-xl px-4 py-3 text-left hover:bg-slate-50 transition-all duration-200 ${
                    location.pathname === "/student" && activeAnchor === item.id ? "is-active bg-brand-green-soft" : ""
                  }`}
                >
                  {item.label}
                </button>
              ))}
              <Link
                to="/student/catalog"
                className={`student-nav-link w-full rounded-xl px-4 py-3 hover:bg-slate-50 transition-all duration-200 ${
                  isCatalog ? "is-active bg-brand-green-soft" : ""
                }`}
                onClick={() => setMenuOpen(false)}
              >
                Catalog
              </Link>
              <ThemeToggle className="w-full justify-center" />
              {isStudent ? (
                <>
                  <div className="px-4 py-2 font-semibold text-slate-900 text-sm uppercase tracking-wide">My Account</div>
                  <Link
                    to="/student/account"
                    className="student-nav-link w-full rounded-xl px-6 py-3 hover:bg-slate-50 text-slate-700 transition-all duration-200"
                    onClick={() => setMenuOpen(false)}
                  >
                    Profile
                  </Link>
                  <Link
                    to="/student/overdue-books"
                    className="student-nav-link w-full rounded-xl px-6 py-3 hover:bg-slate-50 text-slate-700 transition-all duration-200"
                    onClick={() => setMenuOpen(false)}
                  >
                    Overdue Books
                  </Link>
                  <Link
                    to="/student/borrowing-history"
                    className="student-nav-link w-full rounded-xl px-6 py-3 hover:bg-slate-50 text-slate-700 transition-all duration-200"
                    onClick={() => setMenuOpen(false)}
                  >
                    Borrowing History
                  </Link>
                </>
              ) : (
                <>
                  <Link
                    to="/student/signin"
                    className="btn-student-outline btn-pill-sm w-full justify-center transition-all duration-200 hover:shadow-md"
                    onClick={() => setMenuOpen(false)}
                  >
                    Sign In
                  </Link>
                  <Link
                    to="/student/signup"
                    className="btn-student-primary btn-pill-sm w-full justify-center transition-all duration-200 hover:shadow-lg"
                    onClick={() => setMenuOpen(false)}
                  >
                    Sign Up
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      <main className="min-h-[calc(100vh-4rem)]">
        <Outlet />
      </main>

      <footer className="mt-16 border-t border-slate-200/60 bg-gradient-to-r from-white via-slate-50 to-white">
        <div className="mx-auto max-w-7xl px-4 py-12 text-sm text-slate-600 lg:px-6">
          <div className="grid gap-8 md:grid-cols-3">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <img src={logo} alt="LibReport" className="h-8 w-8 rounded-lg border border-slate-200" />
                <div>
                  <div className="text-sm font-bold uppercase tracking-wide text-brand-green">LibReport</div>
                  <div className="text-xs text-slate-500">Student Portal</div>
                </div>
              </div>
              <p className="text-sm text-slate-600">
                Your gateway to academic resources, digital collections, and library services.
              </p>
            </div>
            
            <div className="space-y-4">
              <h3 className="font-semibold text-slate-900">Quick Links</h3>
              <div className="space-y-2">
                <Link to="/student" className="block text-sm text-slate-600 hover:text-brand-green transition-colors">Home</Link>
                <Link to="/student/catalog" className="block text-sm text-slate-600 hover:text-brand-green transition-colors">Catalog</Link>
                <Link to="/student/signin" className="block text-sm text-slate-600 hover:text-brand-green transition-colors">Sign In</Link>
                <Link to="/student/signup" className="block text-sm text-slate-600 hover:text-brand-green transition-colors">Sign Up</Link>
              </div>
            </div>
            
            <div className="space-y-4">
              <h3 className="font-semibold text-slate-900">Support</h3>
              <div className="space-y-2">
                <Link to="/signin" className="block text-sm text-slate-600 hover:text-brand-green transition-colors">Admin Portal</Link>
                <a href="mailto:library@phinmaed.com" className="block text-sm text-slate-600 hover:text-brand-green transition-colors">Contact Librarians</a>
                <p className="text-xs text-slate-500">Monday-Friday: 7:30 AM - 6:00 PM</p>
              </div>
            </div>
          </div>
          
          <div className="mt-8 border-t border-slate-200/60 pt-6">
            <p className="text-center text-sm text-slate-500">&copy; {new Date().getFullYear()} LibReport Student Portal. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default StudentLayout;
