import React, { useEffect, useMemo, useState } from "react";
import ReportModal from "../components/GenReports";
import CollapsibleSection from "../components/CollapsibleSection";
import AdminPageLayout from "../components/AdminPageLayout";
import StatTile from "../components/StatTile";
import api, { getStoredUser } from "../api";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const numberFormatter = new Intl.NumberFormat();

const Dashboard = () => {
  const [showReport, setShowReport] = useState(false);
  const [userName, setUserName] = useState("Account");

  const [counts, setCounts] = useState({
    users: 0,
    disabledUsers: 0,
    totalUsers: 0,
    books: 0,
    activeLoans: 0,
    visitsToday: 0,
    overdue: 0
  });
  const [topBooks, setTopBooks] = useState([]);
  const [heat, setHeat] = useState([]);
  const [topBorrowers, setTopBorrowers] = useState([]);

  useEffect(() => {
    // Load dashboard summary
    api.get('/dashboard').then(r => setCounts(c => ({ ...c, ...r.data.counts }))).catch(() => {});
    api.get('/reports/top-books').then(r => setTopBooks(r.data.items || [])).catch(() => {});
    api.get('/heatmap/visits', { params: { days: 7 } }).then(r => setHeat(r.data.items || [])).catch(() => {});
    api.get('/reports/overdue').then(r => setCounts(c => ({ ...c, overdue: (r.data.items || []).length })) ).catch(() => {});
    api.get('/reports/top-borrowers', { params: { limit: 6, days: 90 } })
      .then((r) => setTopBorrowers(Array.isArray(r.data?.items) ? r.data.items : []))
      .catch(() => {});
  }, []);

  const chartData = useMemo(() => {
    const names = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const sums = new Array(7).fill(0);
    for (const row of heat) {
      // dow from Mongo $dayOfWeek is 1..7 (Sun..Sat)
      const idx = (row.dow ?? 1) - 1;
      sums[idx] += row.count || 0;
    }
    return names.map((name, i) => ({ day: name, value: sums[i] }));
  }, [heat]);

  useEffect(() => {
    const stored = getStoredUser();
    if (stored) {
      const name = stored?.fullName || stored?.name || (stored?.email ? String(stored.email).split('@')[0] : null);
      if (name) setUserName(name);
    }
  }, []);

  const totalKnownUsers = counts.totalUsers || counts.users + counts.disabledUsers;
  const overviewTiles = [
    {
      id: "books",
      title: "Total Books",
      value: numberFormatter.format(counts.books),
      subtitle: "In library collection",
      tone: "blue",
      icon: (
        <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
      ),
      to: "/booksmanagement",
      ariaLabel: "Go to Books Management to view all books",
    },
    {
      id: "borrowed",
      title: "Books Borrowed",
      value: numberFormatter.format(counts.activeLoans),
      subtitle: "Currently checked out",
      tone: "green",
      icon: (
        <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
        </svg>
      ),
      to: "/borrowing",
      ariaLabel: "Open Borrow Management to review borrowed books",
    },
    {
      id: "overdue",
      title: "Overdue Books",
      value: numberFormatter.format(counts.overdue),
      subtitle: "Need attention",
      tone: "red",
      icon: (
        <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
      ),
      to: "/borrowing",
      ariaLabel: "View overdue loans in Borrow Management",
    },
    {
      id: "users",
      title: "Active Users",
      value: numberFormatter.format(counts.users),
      subtitle: `Disabled: ${numberFormatter.format(counts.disabledUsers)} · Total: ${numberFormatter.format(totalKnownUsers)}`,
      tone: "purple",
      icon: (
        <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
        </svg>
      ),
      to: "/usermanagement",
      ariaLabel: "Open User Management to review active users",
    },
  ];

  return (
    <AdminPageLayout
      title="Dashboard"
      description={`Welcome back, ${userName}! Here's your library overview.`}
    >
        {/* Stats Cards */}
        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6 mb-8">
          {overviewTiles.map((tile) => (
            <StatTile key={tile.id} {...tile} />
          ))}
        </section>

        {/* Usage Chart */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-2xl font-bold text-slate-900 [[data-theme=dark]_&]:text-stone-100">Weekly Usage</h3>
              <p className="text-slate-600 [[data-theme=dark]_&]:text-stone-400 mt-1">Library visits over the past week</p>
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-500 [[data-theme=dark]_&]:text-stone-400">
              <div className="h-3 w-3 rounded-full bg-brand-green"></div>
              <span>Library Visits</span>
            </div>
          </div>
          <div className="rounded-2xl theme-panel ring-1 ring-slate-200 [[data-theme=dark]_&]:ring-stone-700 p-6 shadow-lg">
            <ResponsiveContainer width="100%" height={350}>
              <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis 
                  dataKey="day" 
                  stroke="#64748b"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis 
                  stroke="#64748b"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip 
                  contentStyle={{
                    backgroundColor: 'white',
                    border: '1px solid #e2e8f0',
                    borderRadius: '12px',
                    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)'
                  }}
                />
                <Line 
                  type="monotone" 
                  dataKey="value" 
                  stroke="#10b981" 
                  strokeWidth={3} 
                  dot={{ r: 6, fill: '#10b981', strokeWidth: 2, stroke: 'white' }}
                  activeDot={{ r: 8, stroke: '#10b981', strokeWidth: 2, fill: 'white' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        {/* Bottom Section */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          {/* Quick Reports Card */}
          <div className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-50 to-amber-100 [[data-theme=dark]_&]:from-amber-900/20 [[data-theme=dark]_&]:to-amber-800/20 ring-1 ring-amber-200 [[data-theme=dark]_&]:ring-amber-800 p-6 hover:shadow-xl transition-all duration-300">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-amber-500 flex items-center justify-center">
                  <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-bold text-amber-900 [[data-theme=dark]_&]:text-amber-100">Quick Reports</h3>
                  <p className="text-sm text-amber-600 [[data-theme=dark]_&]:text-amber-400">Generate comprehensive reports</p>
                </div>
              </div>
            </div>
            <p className="text-sm text-amber-700 [[data-theme=dark]_&]:text-amber-300 mb-4">Create detailed reports for library usage, overdue books, and user activity.</p>
            <button 
              className="inline-flex items-center gap-2 rounded-xl bg-amber-500 text-white font-medium px-4 py-2 hover:bg-amber-600 transition-colors duration-200 group-hover:scale-105 transform" 
              onClick={() => setShowReport(true)}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Generate Report
            </button>
          </div>

          <CollapsibleSection
            className="h-full"
            title="Popular Books"
            subtitle="Most borrowed titles"
            actions={
              <div className="h-10 w-10 rounded-xl bg-brand-green flex items-center justify-center">
                <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              </div>
            }
          >
            <div className="space-y-3">
              {topBooks.slice(0, 5).map((b, index) => (
                <div
                  key={b.bookId || b.title}
                  className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 [[data-theme=dark]_&]:bg-stone-800 hover:bg-slate-100 [[data-theme=dark]_&]:hover:bg-stone-700 transition-colors duration-200"
                >
                  <div className="flex-shrink-0 h-8 w-8 rounded-lg bg-brand-green/10 flex items-center justify-center">
                    <span className="text-sm font-bold text-brand-green">#{index + 1}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 [[data-theme=dark]_&]:text-stone-100 truncate">{b.title}</p>
                    <p className="text-xs text-slate-500 [[data-theme=dark]_&]:text-stone-400">by {b.author}</p>
                  </div>
                  <div className="flex-shrink-0">
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-brand-green/10 text-brand-green">
                      {b.borrows} borrows
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            className="h-full"
            title="Frequent Borrowers"
            subtitle="Top patrons by loan volume"
            actions={
              <div className="h-10 w-10 rounded-xl bg-indigo-600 flex items-center justify-center">
                <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-1a4 4 0 00-4-4h-1m-4 5v-1a4 4 0 014-4h0m-4 5H7v-1a4 4 0 014-4h0m0 5v-1a4 4 0 014-4h0m-4-7a4 4 0 110-8 4 4 0 010 8z" />
                </svg>
              </div>
            }
          >
            <div className="space-y-3">
              {topBorrowers.length ? (
                topBorrowers.slice(0, 5).map((b, index) => {
                  const shareValue = Number(b.share || 0);
                  return (
                    <div
                      key={b.userId || `borrower-${index}`}
                      className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 [[data-theme=dark]_&]:bg-stone-800 hover:bg-slate-100 [[data-theme=dark]_&]:hover:bg-stone-700 transition-colors duration-200"
                    >
                      <div className="flex-shrink-0 h-8 w-8 rounded-lg bg-indigo-50 [[data-theme=dark]_&]:bg-indigo-900/30 flex items-center justify-center">
                        <span className="text-sm font-bold text-indigo-600 [[data-theme=dark]_&]:text-indigo-200">#{index + 1}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900 [[data-theme=dark]_&]:text-stone-100 truncate">{b.fullName}</p>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 [[data-theme=dark]_&]:text-stone-400">
                          <span>{numberFormatter.format(b.borrows || 0)} loans</span>
                          <span>Active {numberFormatter.format(b.activeLoans || 0)}</span>
                          {b.overdueLoans ? (
                            <span className="text-red-500 [[data-theme=dark]_&]:text-red-400">
                              {numberFormatter.format(b.overdueLoans)} overdue
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <div className="flex-shrink-0">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-indigo-100 [[data-theme=dark]_&]:bg-indigo-900/30 text-indigo-700 [[data-theme=dark]_&]:text-indigo-200">
                          {shareValue.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-xl bg-slate-50 [[data-theme=dark]_&]:bg-stone-800 p-4 text-sm text-slate-500 [[data-theme=dark]_&]:text-stone-400">
                  No borrower data yet. Approve more loans to see top patrons here.
                </div>
              )}
            </div>
          </CollapsibleSection>
        </section>

      {showReport && <ReportModal onClose={() => setShowReport(false)} />}
    </AdminPageLayout>
  );
};

export default Dashboard;


