/* eslint-disable react-hooks/exhaustive-deps, no-unused-vars */
import React, { useCallback, useEffect, useState } from "react";
import Sidebar from "../components/Sidebar";
import CollapsibleSection from "../components/CollapsibleSection";
import profileImage from "../assets/pfp.png";
import { Link, useNavigate } from "react-router-dom";
import api, { clearAuthSession, broadcastAuthChange, getStoredUser } from "../api";
import { surfacePanelClass, inputClass } from "../designSystem/classes";

const STUDENT_ID_PATTERN = /^\d{2}-\d{4}-\d{6}$/;
const DEFAULT_RANGE_HOURS = 24;
const PAGE_SIZE = 10;

const createDefaultStaffing = () => ({
  averageDailyVisits: 0,
  totalVisits: 0,
  visitsPerStaff: 0,
  lookbackDays: 0,
  peakHours: [],
  busyDays: [],
  recommendations: [],
  window: null
});

const createDefaultStats = () => ({
  inbound: { total: 0, today: 0, range: 0 },
  outbound: { total: 0, today: 0, range: 0 },
  overdue: 0,
  active: 0,
  activeLoans: 0,
  rangeHours: DEFAULT_RANGE_HOURS,
  rangeSince: null,
  startOfDay: null,
  staffing: createDefaultStaffing()
});

function formatStudentId(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 12);
  const part1 = digits.slice(0, 2);
  const part2 = digits.slice(2, 6);
  const part3 = digits.slice(6, 12);
  return [part1, part2, part3].filter(Boolean).join('-');
}

const Tracker = () => {
  const [showDropdown, setShowDropdown] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);
  const [userName, setUserName] = useState('Account');
  const navigate = useNavigate();

  const handleLogout = () => {
    setShowLogoutModal(false);
    setShowDropdown(false);
    clearAuthSession();
    broadcastAuthChange();
    navigate("/signin", { replace: true });
  };

  const [logs, setLogs] = useState([]);
  const [logsPage, setLogsPage] = useState(1);
  const [stats, setStats] = useState(() => createDefaultStats());
  const [feed, setFeed] = useState([]);
  const [input, setInput] = useState('');
  const [inputTouched, setInputTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const refreshStats = useCallback(async () => {
    try {
      const { data } = await api.get('/tracker/stats', { params: { hours: DEFAULT_RANGE_HOURS } });
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
      if (data?.staffing) {
        const staffingData = data.staffing;
        next.staffing = {
          ...createDefaultStaffing(),
          averageDailyVisits: Number(staffingData.averageDailyVisits || 0),
          totalVisits: Number(staffingData.totalVisits || 0),
          visitsPerStaff: Number(staffingData.visitsPerStaff || 0),
          lookbackDays: Number(staffingData.lookbackDays || 0),
          peakHours: Array.isArray(staffingData.peakHours) ? staffingData.peakHours : [],
          busyDays: Array.isArray(staffingData.busyDays) ? staffingData.busyDays : [],
          recommendations: Array.isArray(staffingData.recommendations) ? staffingData.recommendations : [],
          window: staffingData.window || null
        };
      } else {
        next.staffing = createDefaultStaffing();
      }
      setStats(next);
    } catch {
      setStats(createDefaultStats());
    }
  }, []);

  const refreshLogs = useCallback(async () => {
    try {
      const { data } = await api.get('/tracker/logs', { params: { limit: 25 } });
      const items = (data.items || []).map((row) => ({
        status: row.status,
        borrowedDate: row.borrowedAt ? new Date(row.borrowedAt).toLocaleString() : '-',
        dueDate: row.returnedAt
          ? `Returned ${new Date(row.returnedAt).toLocaleString()}`
          : row.dueAt
          ? new Date(row.dueAt).toLocaleString()
          : '-',
        material: row.material || 'Unknown material',
        user: row.user || 'Unknown user'
      }));
      setLogs(items);
      setLogsPage(1);
    } catch {
      setLogs([]);
      setLogsPage(1);
    }
  }, []);

  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  useEffect(() => {
    refreshLogs();
    const timer = setInterval(refreshLogs, 30000);
    return () => clearInterval(timer);
  }, [refreshLogs]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil((logs.length || 0) / PAGE_SIZE));
    setLogsPage((prev) => {
      if (prev > maxPage) return maxPage;
      if (prev < 1) return 1;
      return prev;
    });
  }, [logs]);

  useEffect(() => {
    let t;
    const tick = async () => {
      try {
        const { data } = await api.get('/visits/recent', { params: { minutes: 180 } });
        setFeed((data.items || []).map(v => ({
          name: v.name || v.studentId,
          enteredAt: v.enteredAt ? new Date(v.enteredAt).toLocaleTimeString() : '-',
          exitedAt: v.exitedAt ? new Date(v.exitedAt).toLocaleTimeString() : null,
          branch: v.branch
        })));
      } catch { setFeed([]); }
      t = setTimeout(tick, 5000);
    };
    tick();
    return () => { if (t) clearTimeout(t); };
  }, []);

  function beep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = 880;
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
      o.start();
      setTimeout(() => { g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.08); o.stop(ctx.currentTime + 0.1); }, 80);
    } catch {}
  }

  useEffect(() => {
    const stored = getStoredUser();
    if (stored) {
      const name = stored?.fullName || stored?.name || (stored?.email ? String(stored.email).split('@')[0] : null);
      if (name) setUserName(name);
    }
  }, []);

  function toPayload(code) {
    const normalized = formatStudentId(code);
    if (!STUDENT_ID_PATTERN.test(normalized)) return null;
    return { studentId: normalized };
  }

  async function doEnter() {
    setInputTouched(true);
    const payload = toPayload(input);
    if (!payload) {
      setMessage('Student ID must match 00-0000-000000');
      return;
    }
    setInput(payload.studentId);
    setBusy(true); setMessage('');
    try {
      const { data } = await api.post('/visit/enter', payload);
      setMessage(`Entered: ${data?.user?.fullName || payload.studentId || payload.barcode}`);
      beep();
      refreshStats();
      refreshLogs();
    } catch (e) {
      setMessage(e?.response?.data?.error || 'Enter failed');
    } finally { setBusy(false); }
  }
  async function doExit() {
    setInputTouched(true);
    const payload = toPayload(input);
    if (!payload) {
      setMessage('Student ID must match 00-0000-000000');
      return;
    }
    setInput(payload.studentId);
    setBusy(true); setMessage('');
    try {
      const { data } = await api.post('/visit/exit', payload);
      setMessage(`Exited at ${new Date(data.exitedAt).toLocaleTimeString()}`);
      beep();
      refreshStats();
      refreshLogs();
    } catch (e) {
      setMessage(e?.response?.data?.error || 'Exit failed');
    } finally { setBusy(false); }
  }

  const formatNumber = (value) => {
    const num = Number(value ?? 0);
    return Number.isFinite(num) ? num.toLocaleString() : '0';
  };

  const rangeLabel = stats.rangeHours ? `Last ${stats.rangeHours}h` : null;
  const rangeSinceLabel = (() => {
    if (!stats.rangeSince) return null;
    const dt = new Date(stats.rangeSince);
    return Number.isNaN(dt.getTime()) ? null : dt.toLocaleString();
  })();
  const startOfDayLabel = (() => {
    if (!stats.startOfDay) return null;
    const dt = new Date(stats.startOfDay);
    return Number.isNaN(dt.getTime()) ? null : dt.toLocaleDateString();
  })();
  const staffing = stats.staffing || createDefaultStaffing();
  const staffingWindowLabel = (() => {
    const since = staffing?.window?.since;
    if (!since) return null;
    const dt = new Date(since);
    return Number.isNaN(dt.getTime()) ? null : dt.toLocaleDateString();
  })();
  const staffingHasInsights =
    (Array.isArray(staffing.peakHours) && staffing.peakHours.length > 0) ||
    (Array.isArray(staffing.busyDays) && staffing.busyDays.length > 0) ||
    (Array.isArray(staffing.recommendations) && staffing.recommendations.length > 0);
  const inboundSubtitle = [
    `Today: ${formatNumber(stats.inbound.today)}`,
    rangeLabel ? `${rangeLabel}: ${formatNumber(stats.inbound.range)}` : null
  ]
    .filter(Boolean)
    .join(' \u2022 ');
  const outboundSubtitle = [
    `Today: ${formatNumber(stats.outbound.today)}`,
    rangeLabel ? `${rangeLabel}: ${formatNumber(stats.outbound.range)}` : null
  ]
    .filter(Boolean)
    .join(' \u2022 ');
  const logsPageCount = Math.max(1, Math.ceil((logs.length || 0) / PAGE_SIZE));
  const safeLogsPage = Math.min(Math.max(logsPage, 1), logsPageCount);
  const logsStartIndex = (safeLogsPage - 1) * PAGE_SIZE;
  const paginatedLogs = logs.slice(logsStartIndex, logsStartIndex + PAGE_SIZE);
  const logsShowingStart = logs.length === 0 ? 0 : logsStartIndex + 1;
  const logsShowingEnd = Math.min(logsStartIndex + PAGE_SIZE, logs.length);
  const trackerCards = [
    {
      label: 'Total Outbound',
      value: stats.outbound.total,
      color: 'blue',
      icon: '?',
      subtitle: outboundSubtitle,
      to: '/attendance#attendance-history'
    },
    {
      label: 'Total Inbound',
      value: stats.inbound.total,
      color: 'green',
      icon: '?',
      subtitle: inboundSubtitle,
      to: '/attendance#attendance-history'
    },
    {
      label: 'Overdue',
      value: stats.overdue,
      color: 'red',
      icon: '?',
      subtitle: 'Loans past due',
      to: '/attendance#attendance-history'
    },
    {
      label: 'Active Visits',
      value: stats.active,
      color: 'purple',
      icon: '??',
      subtitle: `Active loans: ${formatNumber(stats.activeLoans)}`,
      to: '/attendance#attendance-history'
    }
  ];
  const manualInputHelpId = "tracker-manual-entry-help";
  const normalizedInput = String(input).trim();
  const manualEntryInvalid = !normalizedInput || !STUDENT_ID_PATTERN.test(normalizedInput);
  const manualEntryError = !inputTouched
    ? ""
    : !normalizedInput
    ? "Student ID is required."
    : manualEntryInvalid
    ? "Student ID must match 00-0000-000000."
    : "";

  return (
    <div className="min-h-screen theme-shell">
      <Sidebar />

      <main className="admin-main px-6 md:pl-8 lg:pl-10 pr-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 [[data-theme=dark]_&]:text-stone-100">Tracker</h1>
            <p className="text-slate-600 [[data-theme=dark]_&]:text-stone-400 mt-1">Monitor library visits and user activity</p>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-100 [[data-theme=dark]_&]:bg-stone-800 text-slate-700 [[data-theme=dark]_&]:text-stone-300 px-4 py-2 hover:bg-slate-200 [[data-theme=dark]_&]:hover:bg-stone-700 transition-colors duration-200"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
            <div className="relative">
              <button onClick={() => setShowDropdown(!showDropdown)} className="inline-flex items-center gap-3 rounded-xl bg-white/90 [[data-theme=dark]_&]:bg-stone-900/80 ring-1 ring-slate-200 [[data-theme=dark]_&]:ring-stone-700 px-4 py-2 shadow-lg hover:shadow-xl transition-all duration-200">
                <img src={profileImage} alt="Profile" className="h-9 w-9 rounded-full ring-2 ring-brand-gold/20" />
                <span className="text-sm font-medium text-slate-700 [[data-theme=dark]_&]:text-stone-200 max-w-[12rem] truncate" title={userName}>{userName}</span>
                <svg className="w-4 h-4 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showDropdown && (
                <div className="absolute right-0 mt-3 w-48 rounded-xl theme-panel ring-1 ring-slate-200 [[data-theme=dark]_&]:ring-stone-700 shadow-xl p-2 z-50">
                  <button className="w-full text-left rounded-lg px-4 py-3 text-sm text-red-600 hover:bg-red-50 [[data-theme=dark]_&]:hover:bg-red-900/20 transition-colors duration-200 flex items-center gap-2" onClick={() => setShowLogoutModal(true)}>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    Logout
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-3">
          {trackerCards.map((c) => (
            <Link
              key={c.label}
              to={c.to || '/attendance'}
              className={`group relative overflow-hidden rounded-2xl bg-gradient-to-br ${
              c.color === 'blue' ? 'from-blue-50 to-blue-100 [[data-theme=dark]_&]:from-blue-900/20 [[data-theme=dark]_&]:to-blue-800/20 ring-1 ring-blue-200 [[data-theme=dark]_&]:ring-blue-800' :
              c.color === 'green' ? 'from-green-50 to-green-100 [[data-theme=dark]_&]:from-green-900/20 [[data-theme=dark]_&]:to-green-800/20 ring-1 ring-green-200 [[data-theme=dark]_&]:ring-green-800' :
              c.color === 'red' ? 'from-red-50 to-red-100 [[data-theme=dark]_&]:from-red-900/20 [[data-theme=dark]_&]:to-red-800/20 ring-1 ring-red-200 [[data-theme=dark]_&]:ring-red-800' :
              'from-purple-50 to-purple-100 [[data-theme=dark]_&]:from-purple-900/20 [[data-theme=dark]_&]:to-purple-800/20 ring-1 ring-purple-200 [[data-theme=dark]_&]:ring-purple-800'
            } p-6 hover:shadow-xl transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-slate-400`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className={`text-sm font-medium ${
                    c.color === 'blue' ? 'text-blue-600 [[data-theme=dark]_&]:text-blue-400' :
                    c.color === 'green' ? 'text-green-600 [[data-theme=dark]_&]:text-green-400' :
                    c.color === 'red' ? 'text-red-600 [[data-theme=dark]_&]:text-red-400' :
                    'text-purple-600 [[data-theme=dark]_&]:text-purple-400'
                  }`}>{c.label}</p>
                  <p className={`mt-2 text-3xl font-bold ${
                    c.color === 'blue' ? 'text-blue-900 [[data-theme=dark]_&]:text-blue-100' :
                    c.color === 'green' ? 'text-green-900 [[data-theme=dark]_&]:text-green-100' :
                    c.color === 'red' ? 'text-red-900 [[data-theme=dark]_&]:text-red-100' :
                    'text-purple-900 [[data-theme=dark]_&]:text-purple-100'
                  }`}>{formatNumber(c.value)}</p>
                  {c.subtitle && (
                    <p className={`text-xs mt-1 ${
                      c.color === 'blue' ? 'text-blue-500 [[data-theme=dark]_&]:text-blue-300' :
                      c.color === 'green' ? 'text-green-500 [[data-theme=dark]_&]:text-green-300' :
                      c.color === 'red' ? 'text-red-500 [[data-theme=dark]_&]:text-red-300' :
                      'text-purple-500 [[data-theme=dark]_&]:text-purple-300'
                    }`}>{c.subtitle}</p>
                  )}
                </div>
                <div className={`h-12 w-12 rounded-xl ${
                  c.color === 'blue' ? 'bg-blue-500' :
                  c.color === 'green' ? 'bg-green-500' :
                  c.color === 'red' ? 'bg-red-500' :
                  'bg-purple-500'
                } flex items-center justify-center group-hover:scale-110 transition-transform duration-300`}>
                  <span className="text-2xl" aria-hidden="true">{c.icon}</span>
                </div>
              </div>
            </Link>
          ))}
        </section>
        {(rangeSinceLabel || startOfDayLabel) && (
          <p className="text-xs text-slate-500 [[data-theme=dark]_&]:text-stone-400 mb-5">
            {rangeLabel ? `${rangeLabel} window since ${rangeSinceLabel || 'recently'}. ` : ''}
            {startOfDayLabel ? `Daily counts reset at midnight (${startOfDayLabel}).` : ''}
          </p>
        )}

        {staffingHasInsights && (
          <section className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-8">
            <div className="rounded-2xl theme-panel ring-1 ring-slate-200 [[data-theme=dark]_&]:ring-stone-700 p-6 shadow-lg">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-10 w-10 rounded-xl bg-emerald-500 flex items-center justify-center">
                  <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900 [[data-theme=dark]_&]:text-stone-100">Staffing Planner</h3>
                  <p className="text-sm text-slate-600 [[data-theme=dark]_&]:text-stone-400">
                    Rolling {formatNumber(staffing.lookbackDays || 7)}-day window
                    {staffingWindowLabel ? ` starting ${staffingWindowLabel}` : ''}
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
                <div className="rounded-xl bg-emerald-50 [[data-theme=dark]_&]:bg-emerald-900/20 px-4 py-3">
                  <p className="text-xs font-medium text-emerald-600 [[data-theme=dark]_&]:text-emerald-300 uppercase tracking-wide">
                    Avg Daily Visits
                  </p>
                  <p className="mt-1 text-lg font-semibold text-emerald-900 [[data-theme=dark]_&]:text-emerald-200">
                    {Number(staffing.averageDailyVisits || 0).toFixed(1)}
                  </p>
                </div>
                <div className="rounded-xl bg-emerald-50 [[data-theme=dark]_&]:bg-emerald-900/20 px-4 py-3">
                  <p className="text-xs font-medium text-emerald-600 [[data-theme=dark]_&]:text-emerald-300 uppercase tracking-wide">
                    Visits / Staff
                  </p>
                  <p className="mt-1 text-lg font-semibold text-emerald-900 [[data-theme=dark]_&]:text-emerald-200">
                    {formatNumber(staffing.visitsPerStaff || 0)}
                  </p>
                </div>
                <div className="rounded-xl bg-emerald-50 [[data-theme=dark]_&]:bg-emerald-900/20 px-4 py-3">
                  <p className="text-xs font-medium text-emerald-600 [[data-theme=dark]_&]:text-emerald-300 uppercase tracking-wide">
                    Total Visits
                  </p>
                  <p className="mt-1 text-lg font-semibold text-emerald-900 [[data-theme=dark]_&]:text-emerald-200">
                    {formatNumber(staffing.totalVisits || 0)}
                  </p>
                </div>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-700 [[data-theme=dark]_&]:text-stone-200 mb-3">Peak Hours</h4>
                {Array.isArray(staffing.peakHours) && staffing.peakHours.length ? (
                  <ul className="space-y-3">
                    {staffing.peakHours.map((slot) => (
                      <li
                        key={slot.label}
                        className="flex items-center justify-between rounded-xl bg-white/90 [[data-theme=dark]_&]:bg-stone-900/70 ring-1 ring-slate-100 [[data-theme=dark]_&]:ring-stone-700 px-4 py-3 shadow-sm"
                      >
                        <div>
                          <p className="text-sm font-medium text-slate-900 [[data-theme=dark]_&]:text-stone-100">{slot.label}</p>
                          <p className="text-xs text-slate-500 [[data-theme=dark]_&]:text-stone-400">
                            Avg {Number(slot.avgVisits || 0).toFixed(1)} visits \u2022 Staff goal {formatNumber(slot.recommendedStaff || 0)}
                          </p>
                        </div>
                        <div className="h-8 w-8 flex items-center justify-center rounded-lg bg-emerald-100 [[data-theme=dark]_&]:bg-emerald-900/40 text-emerald-700 [[data-theme=dark]_&]:text-emerald-200 text-sm font-semibold">
                          {formatNumber(slot.recommendedStaff || 0)}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500 [[data-theme=dark]_&]:text-stone-400">
                    Not enough visit data to plot peak hours yet.
                  </p>
                )}
              </div>
            </div>
            <div className="rounded-2xl theme-panel ring-1 ring-slate-200 [[data-theme=dark]_&]:ring-stone-700 p-6 shadow-lg">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-10 w-10 rounded-xl bg-sky-500 flex items-center justify-center">
                  <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10m-11 9h12a2 2 0 002-2V7a2 2 0 00-2-2h-1M7 5H6a2 2 0 00-2 2v11a2 2 0 002 2h1" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900 [[data-theme=dark]_&]:text-stone-100">Coverage Notes</h3>
                  <p className="text-sm text-slate-600 [[data-theme=dark]_&]:text-stone-400">
                    Guide shifts around busiest days and queues
                  </p>
                </div>
              </div>
              <div className="mb-5">
                <h4 className="text-sm font-semibold text-slate-700 [[data-theme=dark]_&]:text-stone-200 mb-3">Busy Days</h4>
                {Array.isArray(staffing.busyDays) && staffing.busyDays.length ? (
                  <ul className="space-y-2">
                    {staffing.busyDays.map((day) => (
                      <li
                        key={day.label}
                        className="flex items-center justify-between rounded-xl bg-white/90 [[data-theme=dark]_&]:bg-stone-900/70 ring-1 ring-slate-100 [[data-theme=dark]_&]:ring-stone-700 px-4 py-2 text-sm text-slate-700 [[data-theme=dark]_&]:text-stone-200 shadow-sm"
                      >
                        <span>{day.label}</span>
                        <span>{Number(day.avgVisits || 0).toFixed(1)} visits/day</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500 [[data-theme=dark]_&]:text-stone-400">
                    Not enough visit data to highlight weekly trends yet.
                  </p>
                )}
              </div>
              <div>
                <h4 className="text-sm font-semibold text-slate-700 [[data-theme=dark]_&]:text-stone-200 mb-3">Recommendations</h4>
                {Array.isArray(staffing.recommendations) && staffing.recommendations.length ? (
                  <ul className="list-disc list-inside space-y-2 text-sm text-slate-600 [[data-theme=dark]_&]:text-stone-300">
                    {staffing.recommendations.map((note, idx) => (
                      <li key={idx}>{note}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500 [[data-theme=dark]_&]:text-stone-400">
                    Staffing insights will appear after a few days of tracker usage.
                  </p>
                )}
              </div>
            </div>
          </section>
        )}

        {/* Manual Entry */}
        <section className="grid grid-cols-1 gap-6 mb-8">
          <CollapsibleSection
            title="Manual Entry"
            subtitle="Track student visits manually"
            actions={
              <div className="h-10 w-10 rounded-xl bg-brand-green flex items-center justify-center">
                <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
                </svg>
              </div>
            }
          >
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 [[data-theme=dark]_&]:text-stone-300 mb-2">Enter Student ID</label>
                <input
                  value={input}
                  onChange={(e) => {
                    const formatted = formatStudentId(e.target.value);
                    if (!inputTouched) setInputTouched(true);
                    setInput(formatted);
                  }}
                  onBlur={() => setInputTouched(true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      doEnter();
                    }
                  }}
                  inputMode="numeric"
                  maxLength={14}
                  placeholder="03-0000-000000"
                  data-error={manualEntryError ? "true" : "false"}
                  aria-invalid={manualEntryError ? "true" : "false"}
                  aria-describedby={manualEntryError ? manualInputHelpId : undefined}
                  className={inputClass("theme-panel text-slate-900 [[data-theme=dark]_&]:text-stone-100 placeholder-slate-400 font-mono")}
                />
                {manualEntryError ? (
                  <p id={manualInputHelpId} className="input-feedback error">
                    {manualEntryError}
                  </p>
                ) : inputTouched && !manualEntryInvalid && normalizedInput ? (
                  <p className="input-feedback success">Ready to record visits for {normalizedInput}.</p>
                ) : null}
              </div>
              
              <div className="flex gap-3">
                <button 
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors duration-200 font-medium" 
                  disabled={busy || manualEntryInvalid} 
                  onClick={doEnter}
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Enter Library
                </button>
                <button 
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors duration-200 font-medium" 
                  disabled={busy || manualEntryInvalid} 
                  onClick={doExit}
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Exit Library
                </button>
              </div>
            </div>
            {message && <div className="mt-3 text-sm text-slate-700 [[data-theme=dark]_&]:text-stone-200">{message}</div>}
          </CollapsibleSection>
        </section>

        {/* Quick logs */}
        <section className={`${surfacePanelClass} mt-6 p-4`}>
          <h3 className="text-lg font-semibold text-slate-900 [[data-theme=dark]_&]:text-stone-100">Quick Logs</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-600 [[data-theme=dark]_&]:text-stone-300">
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Borrowed Date</th>
                  <th className="py-2 pr-4">Due Date</th>
                  <th className="py-2 pr-4">Material</th>
                  <th className="py-2 pr-4">User</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 [[data-theme=dark]_&]:divide-slate-700">
                {paginatedLogs.map((log, i) => (
                  <tr key={logsStartIndex + i} className="text-slate-800 [[data-theme=dark]_&]:text-stone-100">
                    <td className="py-2 pr-4">
                      <span
                        className={`inline-flex items-center rounded px-2 py-0.5 text-xs text-white ${
                          log.status === 'Overdue'
                            ? 'bg-rose-600'
                            : log.status === 'Returned'
                            ? 'bg-emerald-600'
                            : 'bg-indigo-600'
                        }`}
                      >
                        {log.status}
                      </span>
                    </td>
                    <td className="py-2 pr-4">{log.borrowedDate}</td>
                    <td className="py-2 pr-4">{log.dueDate}</td>
                    <td className="py-2 pr-4">{log.material}</td>
                    <td className="py-2 pr-4">{log.user}</td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-3 text-center text-slate-500 [[data-theme=dark]_&]:text-stone-400">
                      No recent loan activity.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-col gap-3 border-t border-slate-200 pt-3 text-xs text-slate-500 [[data-theme=dark]_&]:border-stone-700 [[data-theme=dark]_&]:text-stone-400 sm:flex-row sm:items-center sm:justify-between">
            <span>
              {logs.length === 0
                ? 'No logs to display'
                : `Showing ${logsShowingStart}-${logsShowingEnd} of ${logs.length} ${logs.length === 1 ? 'log' : 'logs'}`}
            </span>
            <div className="flex items-center gap-2 text-sm text-slate-600 [[data-theme=dark]_&]:text-stone-300">
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 transition-colors duration-200 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 [[data-theme=dark]_&]:bg-stone-900 [[data-theme=dark]_&]:text-stone-200 [[data-theme=dark]_&]:ring-stone-700 [[data-theme=dark]_&]:hover:bg-stone-800"
                onClick={() => setLogsPage((prev) => Math.max(1, prev - 1))}
                disabled={logs.length === 0 || safeLogsPage <= 1}
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Prev
              </button>
              <span className="text-xs font-medium">
                Page {logs.length === 0 ? 0 : safeLogsPage} of {logs.length === 0 ? 0 : logsPageCount}
              </span>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200 transition-colors duration-200 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 [[data-theme=dark]_&]:bg-stone-900 [[data-theme=dark]_&]:text-stone-200 [[data-theme=dark]_&]:ring-stone-700 [[data-theme=dark]_&]:hover:bg-stone-800"
                onClick={() => setLogsPage((prev) => Math.min(logsPageCount, prev + 1))}
                disabled={logs.length === 0 || safeLogsPage >= logsPageCount}
              >
                Next
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-500 [[data-theme=dark]_&]:text-stone-400">Active loans: {stats.activeLoans}</p>
        </section>

        {/* Recent visits feed */}
        <section className="mt-6 rounded-xl theme-panel ring-1 ring-slate-200 [[data-theme=dark]_&]:ring-stone-700 p-4">
          <h3 className="text-lg font-semibold text-slate-900 [[data-theme=dark]_&]:text-stone-100">Recent Visits</h3>
          <ul className="mt-2 divide-y divide-slate-200 [[data-theme=dark]_&]:divide-slate-700">
            {feed.map((v, i) => (
              <li key={i} className="py-2 text-sm text-slate-700 [[data-theme=dark]_&]:text-stone-200 flex items-center justify-between">
                <span>{v.name} <span className="text-slate-500">@ {v.branch}</span></span>
                <span className="text-slate-500">{v.enteredAt}{v.exitedAt ? ` \u2192 ${v.exitedAt}` : ''}</span>
              </li>
            ))}
          </ul>
        </section>

        
      </main>

      {showLogoutModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl theme-panel ring-1 ring-slate-200 [[data-theme=dark]_&]:ring-stone-700 p-6">
            <h3 className="text-lg font-semibold text-slate-900 [[data-theme=dark]_&]:text-stone-100">Are you sure you want to logout?</h3>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button className="rounded-lg px-4 py-2 ring-1 ring-slate-200 [[data-theme=dark]_&]:ring-stone-700 theme-panel text-slate-700 [[data-theme=dark]_&]:text-stone-200" onClick={() => setShowLogoutModal(false)}>Close</button>
              <button className="rounded-lg px-4 py-2 bg-red-600 text-white hover:bg-red-500" onClick={handleLogout}>Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Tracker;






