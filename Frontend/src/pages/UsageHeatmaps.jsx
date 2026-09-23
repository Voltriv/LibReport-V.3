import React, { useCallback, useEffect, useMemo, useState } from "react";
import AdminPageLayout from "../components/AdminPageLayout";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import api from "../api";

const ranges = [
  { label: "Last 7 days", value: 7 },
  { label: "Last 30 days", value: 30 },
  { label: "Last 90 days", value: 90 },
];

const UsageHeatmaps = () => {
  const [range, setRange] = useState(ranges[1]);
  const [view, setView] = useState("daily");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (days) => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/heatmap/visits", { params: { days } });
      setItems(data.items || []);
    } catch {
      setItems([]);
      setError("Failed to load usage data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(range.value);
  }, [load, range]);

  const dailySeries = useMemo(() => {
    const sums = new Array(7).fill(0);
    for (const it of items) {
      const dow = (it.dow ?? 1) - 1;
      if (dow >= 0 && dow < 7) sums[dow] += it.count || 0;
    }
    const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return labels.map((label, idx) => ({ label, value: sums[idx] }));
  }, [items]);

  const hourlySeries = useMemo(() => {
    const sums = new Array(24).fill(0);
    for (const it of items) {
      const hour = it.hour ?? 0;
      if (hour >= 0 && hour < 24) sums[hour] += it.count || 0;
    }
    return sums.map((value, hour) => ({ label: `${hour}:00`, value }));
  }, [items]);

  const summary = useMemo(() => {
    const total = items.reduce((acc, it) => acc + (it.count || 0), 0);
    const peakDay = dailySeries.reduce((best, row) => (row.value > best.value ? row : best), {
      label: "-",
      value: 0,
    });
    const peakHour = hourlySeries.reduce((best, row) => (row.value > best.value ? row : best), {
      label: "-",
      value: 0,
    });
    return { total, peakDay, peakHour };
  }, [dailySeries, hourlySeries, items]);

  const chartData = view === "hourly" ? hourlySeries : dailySeries;
  const chartLabel = view === "hourly" ? "Visits by Hour" : "Visits by Day of Week";

  const headerActions = (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className="inline-flex items-center gap-2 rounded-xl bg-slate-100 [[data-theme=dark]_&]:bg-stone-800 text-slate-700 [[data-theme=dark]_&]:text-stone-300 px-4 py-2 hover:bg-slate-200 [[data-theme=dark]_&]:hover:bg-stone-700 transition-colors duration-200"
    >
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
      Refresh
    </button>
  );

  return (
    <AdminPageLayout
      title="Usage Heatmaps"
      description="Visualize library usage patterns and trends"
      actions={headerActions}
    >
        <section className="mt-6 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-xl theme-panel ring-1 ring-slate-200 [[data-theme=dark]_&]:ring-stone-700 p-4">
              <p className="text-sm text-slate-500 [[data-theme=dark]_&]:text-stone-300">Total Visits</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900 [[data-theme=dark]_&]:text-stone-100">{summary.total}</p>
            </div>
            <div className="rounded-xl theme-panel ring-1 ring-slate-200 [[data-theme=dark]_&]:ring-stone-700 p-4">
              <p className="text-sm text-slate-500 [[data-theme=dark]_&]:text-stone-300">Busiest Day</p>
              <p className="mt-1 text-lg font-semibold text-slate-900 [[data-theme=dark]_&]:text-stone-100">
                {summary.peakDay.label} ({summary.peakDay.value})
              </p>
            </div>
            <div className="rounded-xl theme-panel ring-1 ring-slate-200 [[data-theme=dark]_&]:ring-stone-700 p-4">
              <p className="text-sm text-slate-500 [[data-theme=dark]_&]:text-stone-300">Peak Hour</p>
              <p className="mt-1 text-lg font-semibold text-slate-900 [[data-theme=dark]_&]:text-stone-100">
                {summary.peakHour.label} ({summary.peakHour.value})
              </p>
            </div>
          </div>

          <div className="rounded-xl theme-panel ring-1 ring-slate-200 [[data-theme=dark]_&]:ring-stone-700 p-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h2 className="text-2xl font-semibold text-slate-900 [[data-theme=dark]_&]:text-stone-100">Usage Heatmaps</h2>
                <p className="text-sm text-slate-500 [[data-theme=dark]_&]:text-stone-300">{chartLabel}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-lg bg-slate-100 [[data-theme=dark]_&]:bg-stone-800 p-1">
                  <button
                    className={`rounded-md px-3 py-1.5 text-sm font-medium ${view === "daily" ? "theme-panel text-slate-900 [[data-theme=dark]_&]:text-stone-100 shadow" : "text-slate-600 [[data-theme=dark]_&]:text-stone-300"}`}
                    onClick={() => setView("daily")}
                  >
                    Day of week
                  </button>
                  <button
                    className={`rounded-md px-3 py-1.5 text-sm font-medium ${view === "hourly" ? "theme-panel text-slate-900 [[data-theme=dark]_&]:text-stone-100 shadow" : "text-slate-600 [[data-theme=dark]_&]:text-stone-300"}`}
                    onClick={() => setView("hourly")}
                  >
                    Hour of day
                  </button>
                </div>
                <select
                  className="rounded-lg border border-slate-300 [[data-theme=dark]_&]:border-stone-600 theme-panel px-3 py-1.5 text-sm text-slate-700 [[data-theme=dark]_&]:text-stone-200"
                  value={range.value}
                  onChange={(e) => {
                    const next = ranges.find((r) => r.value === Number(e.target.value));
                    if (next) setRange(next);
                  }}
                >
                  {ranges.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {error && (
              <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
            )}

            <div className="mt-4 h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis allowDecimals={false} />
                  <Tooltip formatter={(value) => [value, "Visits"]} />
                  <Line type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={!loading} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <p className="mt-2 text-xs text-slate-500 [[data-theme=dark]_&]:text-stone-400">
              Showing visitor check-ins {range.label.toLowerCase()}.
            </p>
          </div>
        </section>
    </AdminPageLayout>
  );
};

export default UsageHeatmaps;
