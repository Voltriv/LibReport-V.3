
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import CollapsibleSection from "../components/CollapsibleSection";
import AdminPageLayout from "../components/AdminPageLayout";
import api from "../api";
import usePagination from "../hooks/usePagination";
import { surfacePanelClass, autoRefreshButtonClass, inputClass } from "../designSystem/classes";

const DEFAULT_RANGE_HOURS = 24;
const PAGE_SIZE_DEFAULT = 15;
const AUTO_REFRESH_INTERVAL = 60000;
const STUDENT_ID_PATTERN = /^\d{2}-\d{4}-\d{6}$/;

const STATUS_CLASSES = {
  Active: "bg-emerald-600"
};

const STATUS_OPTIONS = [
  { value: "all", label: "All" },
  { value: "Active", label: "Present" }
];

const createDefaultStats = () => ({
  inbound: { total: 0, today: 0, range: 0 },
  outbound: { total: 0, today: 0, range: 0 },
  overdue: 0,
  active: 0,
  activeLoans: 0,
  rangeHours: DEFAULT_RANGE_HOURS,
  rangeSince: null,
  startOfDay: null
});

function formatDate(value) {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "-";
  return dt.toLocaleString();
}

function formatStudentId(raw) {
  const digits = String(raw || "").replace(/\D/g, "").slice(0, 12);
  const part1 = digits.slice(0, 2);
  const part2 = digits.slice(2, 6);
  const part3 = digits.slice(6, 12);
  return [part1, part2, part3].filter(Boolean).join("-");
}

function toVisitPayload(code) {
  const normalized = formatStudentId(code);
  if (!STUDENT_ID_PATTERN.test(normalized)) return null;
  return { studentId: normalized };
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
    oscillator.start();
    setTimeout(() => {
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.08);
      oscillator.stop(ctx.currentTime + 0.1);
    }, 80);
  } catch {
    /* noop */
  }
}

function mapLogRow(row, index) {
  const enteredLabel = formatDate(row.enteredAt || row.borrowedAt);
  const branch = row.branch || row.material || "Main";
  const visitor = row.name || row.user || row.studentId || row.barcode || `Visitor ${index + 1}`;

  return {
    id: row.id || row.visitId || row.studentId || `log-${index}`,
    status: "Active",
    borrowedAtLabel: enteredLabel,
    dueAtLabel: `Entered ${enteredLabel}`,
    material: branch,
    user: visitor
  };
}

function mapRecentVisit(row, index) {
  const enteredLabel = formatDate(row.enteredAt);
  return {
    id: row.studentId || row.barcode || `visit-${index}`,
    name: row.name || row.studentId || row.barcode || "Unknown visitor",
    branch: row.branch || "Main",
    enteredAt: enteredLabel,
    isActive: true
  };
}

const Attendance = () => {
  const routeLocation = useLocation();

  const [stats, setStats] = useState(() => createDefaultStats());
  const [statsError, setStatsError] = useState("");

  const [logs, setLogs] = useState([]);
  const [logsDays, setLogsDays] = useState(30);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState("");
  const [pageSize, setPageSize] = useState(PAGE_SIZE_DEFAULT);
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  const [manualInput, setManualInput] = useState("");
  const [manualTouched, setManualTouched] = useState(false);
  const [manualBusy, setManualBusy] = useState(false);
  const [manualMessage, setManualMessage] = useState("");

  const [recentVisits, setRecentVisits] = useState([]);
  const [recentMinutes, setRecentMinutes] = useState(180);
  const [recentLoading, setRecentLoading] = useState(false);
  const [recentError, setRecentError] = useState("");

  const [autoRefresh, setAutoRefresh] = useState(false);

  const statsRangeLabel = stats.rangeHours ? `Last ${stats.rangeHours}h` : null;
  const statsSinceLabel = useMemo(() => {
    if (!stats.rangeSince) return null;
    const dt = new Date(stats.rangeSince);
    if (Number.isNaN(dt.getTime())) return null;
    return dt.toLocaleString();
  }, [stats.rangeSince]);
  const startOfDayLabel = useMemo(() => {
    if (!stats.startOfDay) return null;
    const dt = new Date(stats.startOfDay);
    if (Number.isNaN(dt.getTime())) return null;
    return dt.toLocaleString();
  }, [stats.startOfDay]);
  const headerMeta =
    statsRangeLabel || startOfDayLabel
      ? `${statsRangeLabel ? `${statsRangeLabel} window since ${statsSinceLabel || "recently"}. ` : ""}${
          startOfDayLabel ? `Daily counts reset at midnight (${startOfDayLabel}).` : ""
        }`
      : null;

  const refreshStats = useCallback(async () => {
    setStatsError("");
    try {
      const { data } = await api.get("/tracker/stats", { params: { hours: DEFAULT_RANGE_HOURS } });
      const next = createDefaultStats();
      next.inbound = {
        total: data?.totals?.inbound ?? data?.inbound ?? 0,
        today: data?.today?.inbound ?? 0,
        range: data?.inbound ?? 0
      };
      next.outbound = {
        total: data?.totals?.outbound ?? data?.outbound ?? 0,
        today: data?.today?.outbound ?? 0,
        range: data?.outbound ?? 0
      };
      next.overdue = data?.overdue ?? 0;
      next.active = data?.active ?? 0;
      next.activeLoans = data?.activeLoans ?? 0;
      next.rangeHours = data?.range?.hours ?? next.rangeHours;
      next.rangeSince = data?.range?.since ?? null;
      next.startOfDay = data?.today?.startOfDay ?? null;
      setStats(next);
    } catch (err) {
      console.error("Failed to load attendance stats", err);
      setStats(createDefaultStats());
      setStatsError("Unable to load attendance stats right now.");
    }
  }, []);

  const refreshLogs = useCallback(async () => {
    setLogsLoading(true);
    setLogsError("");
    try {
      const minutes = Math.max(60, logsDays * 24 * 60);
      const { data } = await api.get("/visits/recent", { params: { minutes } });
      const items = Array.isArray(data?.items) ? data.items.map(mapLogRow) : [];
      setLogs(items);
    } catch (err) {
      console.error("Failed to load attendance logs", err);
      setLogs([]);
      setLogsError("Unable to load attendance logs right now.");
    } finally {
      setLogsLoading(false);
    }
  }, [logsDays]);

  const refreshRecentVisits = useCallback(async () => {
    setRecentLoading(true);
    setRecentError("");
    try {
      const { data } = await api.get("/visits/recent", { params: { minutes: recentMinutes } });
      const items = Array.isArray(data?.items) ? data.items.map(mapRecentVisit) : [];
      setRecentVisits(items);
    } catch (err) {
      console.error("Failed to load recent visits", err);
      setRecentVisits([]);
      setRecentError("Unable to load recent visits right now.");
    } finally {
      setRecentLoading(false);
    }
  }, [recentMinutes]);

  const handleRefreshAll = useCallback(() => {
    refreshStats();
    refreshLogs();
    refreshRecentVisits();
  }, [refreshLogs, refreshRecentVisits, refreshStats]);

  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  useEffect(() => {
    refreshLogs();
  }, [refreshLogs]);

  useEffect(() => {
    refreshRecentVisits();
  }, [refreshRecentVisits]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const timer = setInterval(() => {
      refreshStats();
      refreshLogs();
      refreshRecentVisits();
    }, AUTO_REFRESH_INTERVAL);
    return () => clearInterval(timer);
  }, [autoRefresh, refreshLogs, refreshRecentVisits, refreshStats]);

  useEffect(() => {
    if (routeLocation.hash === "#attendance-history") {
      const anchor = document.getElementById("attendance-history");
      if (anchor) {
        anchor.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }, [routeLocation]);
  const filteredLogs = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return logs.filter((log) => {
      const statusMatch = statusFilter === "all" || log.status === statusFilter;
      if (!statusMatch) return false;
      if (!term) return true;
      return (
        log.user.toLowerCase().includes(term) ||
        log.material.toLowerCase().includes(term) ||
        log.borrowedAtLabel.toLowerCase().includes(term) ||
        log.dueAtLabel.toLowerCase().includes(term)
      );
    });
  }, [logs, searchTerm, statusFilter]);

  const statusCounts = useMemo(() => {
    return { Active: logs.length };
  }, [logs]);

  const pagination = usePagination(filteredLogs, pageSize);
  const {
    page,
    pageCount,
    pageItems: pagedLogs,
    showingStart,
    showingEnd,
    totalItems,
    isFirstPage,
    isLastPage,
    prevPage,
    nextPage
  } = pagination;

  const logsRangeDescription = useMemo(() => {
    if (!logsDays) return null;
    return `Attendance recorded over the last ${logsDays} days`;
  }, [logsDays]);

  const normalizedManualInput = manualInput.trim();
  const manualInputInvalid = !normalizedManualInput || !STUDENT_ID_PATTERN.test(normalizedManualInput);
  const manualInputError = !manualTouched
    ? ""
    : !normalizedManualInput
    ? "Student ID is required."
    : manualInputInvalid
    ? "Student ID must match 00-0000-000000."
    : "";
  const manualInputHelpId = "attendance-manual-entry-help";


  const handleManualSubmit = useCallback(
    async () => {
      setManualTouched(true);
      const payload = toVisitPayload(manualInput);
      if (!payload) {
        setManualMessage("Student ID must match 00-0000-000000");
        return;
      }
      setManualInput(payload.studentId);
      setManualBusy(true);
      setManualMessage("");
      try {
        const timestamp = new Date();
        const { data } = await api.post("/visit/enter", payload);
        setManualMessage(`Entered: ${data?.user?.fullName || payload.studentId}`);
        beep();
        const manualLog = mapLogRow({
          id: `manual-${Date.now()}`,
          enteredAt: timestamp.toISOString(),
          exitedAt: null,
          material: "Manual Entry",
          name: payload.studentId
        });
        setLogs((prev) => [manualLog, ...prev].slice(0, 500));
        refreshStats();
        refreshRecentVisits();
        refreshLogs();
      } catch (err) {
        const fallback = "Enter failed";
        setManualMessage(err?.response?.data?.error || fallback);
      } finally {
        setManualBusy(false);
      }
    },
    [manualInput, refreshLogs, refreshRecentVisits, refreshStats]
  );

  const handleExport = useCallback(() => {
    if (!filteredLogs.length) return;
    const headers = ["Status", "Borrowed Date", "Due / Return", "Material", "User"];
    const rows = filteredLogs.map((log) =>
      [
        log.status,
        log.borrowedAtLabel,
        log.dueAtLabel,
        log.material,
        log.user
      ].map((value) => `"${String(value || "").replace(/"/g, '""')}"`).join(",")
    );
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `attendance-history-${Date.now()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [filteredLogs]);

  const headerActions = (
    <>
      <button
        type="button"
        onClick={() => setAutoRefresh((prev) => !prev)}
        className={autoRefreshButtonClass(autoRefresh)}
      >
        <span className={`inline-flex h-2.5 w-2.5 rounded-full ${autoRefresh ? "bg-emerald-500" : "bg-slate-300"}`} />
        Auto refresh
      </button>
      <button
        type="button"
        onClick={handleRefreshAll}
        className="inline-flex items-center gap-2 rounded-xl bg-slate-100 [[data-theme=dark]_&]:bg-stone-800 text-slate-700 [[data-theme=dark]_&]:text-stone-300 px-4 py-2 hover:bg-slate-200 [[data-theme=dark]_&]:hover:bg-stone-700 transition-colors duration-200"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        Refresh
      </button>
      <Link
        to="/tracker"
        className="inline-flex items-center gap-2 rounded-xl bg-white/90 [[data-theme=dark]_&]:bg-stone-900/80 ring-1 ring-slate-200 [[data-theme=dark]_&]:ring-stone-700 px-4 py-2 text-sm font-medium text-slate-600 [[data-theme=dark]_&]:text-stone-200 hover:bg-white [[data-theme=dark]_&]:hover:bg-stone-900 transition-colors duration-200"
      >
        Back to Tracker
      </Link>
    </>
  );

  return (
    <AdminPageLayout
      title="Attendance"
      description="Detailed tracker for library visits and activity history."
      meta={headerMeta}
      actions={headerActions}
    >

        {statsError && (
          <div className="mb-8 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-700 [[data-theme=dark]_&]:border-amber-500/40 [[data-theme=dark]_&]:bg-amber-500/10 [[data-theme=dark]_&]:text-amber-300">
            {statsError}
          </div>
        )}

        <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <section id="attendance-history" className={`${surfacePanelClass} p-6`}>
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between mb-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-900 [[data-theme=dark]_&]:text-stone-100">Attendance</h2>
                <p className="text-sm text-slate-600 [[data-theme=dark]_&]:text-stone-400">
                  {logsRangeDescription || "Recorded student attendance for the selected range"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-xs font-medium text-slate-600 [[data-theme=dark]_&]:text-stone-300">
                  Last
                  <select
                    value={logsDays}
                    onChange={(event) => setLogsDays(Number(event.target.value) || 30)}
                    className="ml-2 rounded-lg border border-slate-300 [[data-theme=dark]_&]:border-stone-600 theme-panel px-2 py-1 text-xs text-slate-700 [[data-theme=dark]_&]:text-stone-200 focus:outline-none focus:ring-2 focus:ring-brand-green"
                  >
                    <option value={7}>7 days</option>
                    <option value={30}>30 days</option>
                    <option value={90}>90 days</option>
                    <option value={180}>180 days</option>
                  </select>
                </label>
                <label className="text-xs font-medium text-slate-600 [[data-theme=dark]_&]:text-stone-300">
                  Rows per page
                  <select
                    value={pageSize}
                    onChange={(event) => setPageSize(Number(event.target.value) || PAGE_SIZE_DEFAULT)}
                    className="ml-2 rounded-lg border border-slate-300 [[data-theme=dark]_&]:border-stone-600 theme-panel px-2 py-1 text-xs text-slate-700 [[data-theme=dark]_&]:text-stone-200 focus:outline-none focus:ring-2 focus:ring-brand-green"
                  >
                    <option value={10}>10</option>
                    <option value={15}>15</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 mb-4">
              {STATUS_OPTIONS.map((option) => {
                const isActive = statusFilter === option.value;
                const displayCount =
                  option.value === "all" ? logs.length : statusCounts[option.value] || 0;
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold transition ${
                      isActive
                        ? "bg-slate-900 text-white shadow"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200 [[data-theme=dark]_&]:bg-stone-800 [[data-theme=dark]_&]:text-stone-200 [[data-theme=dark]_&]:hover:bg-stone-700"
                    }`}
                    onClick={() => setStatusFilter(option.value)}
                  >
                    {option.label}
                    <span className="inline-flex h-5 min-w-[1.5rem] items-center justify-center rounded-full bg-white/80 px-2 text-[0.7rem] text-slate-700 [[data-theme=dark]_&]:bg-stone-900/70 [[data-theme=dark]_&]:text-stone-200">
                      {displayCount}
                    </span>
                  </button>
                );
              })}
              <div className="relative flex-1 min-w-[12rem] w-full md:w-auto md:ml-auto">
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search visitor or branch"
                  className="w-full rounded-xl border border-slate-200 [[data-theme=dark]_&]:border-stone-600 theme-panel px-4 py-2 text-sm text-slate-700 [[data-theme=dark]_&]:text-stone-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-green"
                />
                <svg
                  className="absolute inset-y-0 right-3 my-auto h-4 w-4 text-slate-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35m0 0A7 7 0 1010.5 17a7 7 0 006.15-3.35z" />
                </svg>
              </div>
              <button
                type="button"
                onClick={handleExport}
                disabled={!filteredLogs.length}
                className="inline-flex w-full justify-center md:w-auto items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 [[data-theme=dark]_&]:bg-stone-900 [[data-theme=dark]_&]:text-stone-200 [[data-theme=dark]_&]:ring-stone-700 [[data-theme=dark]_&]:hover:bg-stone-800"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Export CSV
              </button>
            </div>
            {logsError && (
              <div className="mb-4 rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700 [[data-theme=dark]_&]:border-rose-500/40 [[data-theme=dark]_&]:bg-rose-500/10 [[data-theme=dark]_&]:text-rose-300">
                {logsError}
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-600 [[data-theme=dark]_&]:text-stone-300">
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Entered At</th>
                    <th className="py-2 pr-4">Entry Note</th>
                    <th className="py-2 pr-4">Location</th>
                    <th className="py-2 pr-4">Visitor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 [[data-theme=dark]_&]:divide-stone-700">
                  {logsLoading ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-slate-500 [[data-theme=dark]_&]:text-stone-400">
                        Loading attendance logs...
                      </td>
                    </tr>
                  ) : pagedLogs.length > 0 ? (
                    pagedLogs.map((log) => (
                      <tr key={log.id} className="text-slate-800 [[data-theme=dark]_&]:text-stone-100 transition hover:bg-slate-50/60 [[data-theme=dark]_&]:hover:bg-stone-800/60">
                        <td className="py-3 pr-4">
                          <span
                            className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold text-white ${
                              STATUS_CLASSES[log.status] || "bg-emerald-600"
                            }`}
                          >
                            {log.status}
                          </span>
                        </td>
                        <td className="py-3 pr-4">{log.borrowedAtLabel}</td>
                        <td className="py-3 pr-4">{log.dueAtLabel}</td>
                        <td className="py-3 pr-4">{log.material}</td>
                        <td className="py-3 pr-4">{log.user}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="py-6 text-center text-slate-500 [[data-theme=dark]_&]:text-stone-400">
                        No history logs available for the selected filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex flex-col gap-3 border-t border-slate-200 pt-3 text-xs text-slate-500 [[data-theme=dark]_&]:border-stone-700 [[data-theme=dark]_&]:text-stone-400 sm:flex-row sm:items-center sm:justify-between">
              <span>
                {totalItems === 0
                  ? "No logs to display"
                  : `Showing ${showingStart}-${showingEnd} of ${totalItems} ${
                      totalItems === 1 ? "entry" : "entries"
                    }`}
              </span>
              <div className="flex items-center gap-2 text-sm text-slate-600 [[data-theme=dark]_&]:text-stone-300">
                <button
                  type="button"
                  onClick={prevPage}
                  disabled={isFirstPage || totalItems === 0}
                  className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 transition-colors duration-200 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 [[data-theme=dark]_&]:bg-stone-900 [[data-theme=dark]_&]:text-stone-200 [[data-theme=dark]_&]:ring-stone-700 [[data-theme=dark]_&]:hover:bg-stone-800"
                >
                  Prev
                </button>
                <span className="text-xs">
                  Page {page} of {pageCount}
                </span>
                <button
                  type="button"
                  onClick={nextPage}
                  disabled={isLastPage || totalItems === 0}
                  className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 transition-colors duration-200 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 [[data-theme=dark]_&]:bg-stone-900 [[data-theme=dark]_&]:text-stone-200 [[data-theme=dark]_&]:ring-stone-700 [[data-theme=dark]_&]:hover:bg-stone-800"
                >
                  Next
                </button>
              </div>
            </div>
          </section>

          <div className="space-y-6">
            <section className={`${surfacePanelClass} p-6`}>
              <div className="flex items-center gap-3 mb-6">
                <div className="h-10 w-10 rounded-xl bg-brand-green flex items-center justify-center">
                  <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900 [[data-theme=dark]_&]:text-stone-100">Manual Entry</h3>
                  <p className="text-sm text-slate-600 [[data-theme=dark]_&]:text-stone-400">Record visits without scanning</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 [[data-theme=dark]_&]:text-stone-300 mb-2">
                    Student ID
                  </label>
                  <input
                    value={manualInput}
                    onChange={(event) => {
                      if (!manualTouched) setManualTouched(true);
                      setManualInput(formatStudentId(event.target.value));
                    }}
                    onBlur={() => setManualTouched(true)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleManualSubmit();
                      }
                    }}
                    inputMode="numeric"
                    maxLength={14}
                    placeholder="03-0000-000000"
                    aria-invalid={manualInputError ? "true" : "false"}
                    aria-describedby={manualInputError ? manualInputHelpId : undefined}
                    data-error={manualInputError ? "true" : "false"}
                    className={inputClass("theme-panel text-slate-900 [[data-theme=dark]_&]:text-stone-100 placeholder-slate-400 font-mono")}
                  />
                  {manualInputError ? (
                    <p id={manualInputHelpId} className="input-feedback error">
                      {manualInputError}
                    </p>
                  ) : manualTouched && !manualInputInvalid && normalizedManualInput ? (
                    <p className="input-feedback success">Ready to record visits for {normalizedManualInput}.</p>
                  ) : null}
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <button
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors duration-200 font-medium"
                    disabled={manualBusy || manualInputInvalid}
                    onClick={handleManualSubmit}
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Enter Library
                  </button>
                </div>
              </div>
              {manualMessage && (
                <div className="mt-4 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700 [[data-theme=dark]_&]:bg-stone-800 [[data-theme=dark]_&]:text-stone-200">
                  {manualMessage}
                </div>
              )}
            </section>

            <CollapsibleSection
              className="p-6"
              title="Recent Visits"
              subtitle={`Visitors recorded in the last ${recentMinutes} minutes`}
              actions={
                <div className="flex items-center gap-2">
                  <select
                    value={recentMinutes}
                    onChange={(event) => setRecentMinutes(Number(event.target.value) || 60)}
                    className="rounded-lg border border-slate-300 [[data-theme=dark]_&]:border-stone-600 theme-panel px-2 py-1 text-xs text-slate-700 [[data-theme=dark]_&]:text-stone-200 focus:outline-none focus:ring-2 focus:ring-brand-green"
                  >
                    <option value={60}>60 min</option>
                    <option value={120}>2 hours</option>
                    <option value={180}>3 hours</option>
                    <option value={360}>6 hours</option>
                  </select>
                  <button
                    type="button"
                    onClick={refreshRecentVisits}
                    className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-100 [[data-theme=dark]_&]:bg-stone-900 [[data-theme=dark]_&]:text-stone-200 [[data-theme=dark]_&]:ring-stone-700 [[data-theme=dark]_&]:hover:bg-stone-800"
                  >
                    Refresh
                  </button>
                </div>
              }
            >
              {recentError && (
                <div className="mb-4 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 [[data-theme=dark]_&]:border-rose-500/40 [[data-theme=dark]_&]:bg-rose-500/10 [[data-theme=dark]_&]:text-rose-300">
                  {recentError}
                </div>
              )}

              <ul className="divide-y divide-slate-200 [[data-theme=dark]_&]:divide-stone-700 text-sm">
                {recentLoading ? (
                  <li className="py-4 text-slate-500 [[data-theme=dark]_&]:text-stone-400">Loading recent visits…</li>
                ) : recentVisits.length === 0 ? (
                  <li className="py-4 text-slate-500 [[data-theme=dark]_&]:text-stone-400">No visits recorded for the selected window.</li>
                ) : (
                  recentVisits.map((visit) => (
                    <li key={visit.id} className="py-3 flex flex-col gap-1">
                      <div className="flex items-center justify-between text-slate-800 [[data-theme=dark]_&]:text-stone-100">
                        <span className="font-semibold">{visit.name}</span>
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold bg-emerald-100 text-emerald-700 [[data-theme=dark]_&]:bg-emerald-500/10 [[data-theme=dark]_&]:text-emerald-200">
                          Present
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-3 text-xs text-slate-500 [[data-theme=dark]_&]:text-stone-300">
                        <span>Entered {visit.enteredAt}</span>
                        <span>Branch: {visit.branch}</span>
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </CollapsibleSection>
          </div>
        </div>
    </AdminPageLayout>
  );
};

export default Attendance;
