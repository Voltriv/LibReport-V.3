import React, { useEffect, useState } from "react";
import AdminPageLayout from "../components/AdminPageLayout";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import api from "../api";

const TIME_RANGES = [
  { label: "Daily", value: "daily", days: 1 },
  { label: "Weekly", value: "weekly", days: 7 },
  { label: "Monthly", value: "monthly", days: 30 },
];

const REPORT_OPTIONS = [
  { label: "Usage Report", value: "usage" },
  { label: "Overdue Report", value: "overdue" },
  { label: "Borrowed Books Summary", value: "borrowed" },
  { label: "Genre & Topic Trends", value: "genre" },
  { label: "Underutilized Titles", value: "underutilized" },
  { label: "Fine Leakage Overview", value: "fines" },
];

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const numberFormatter = new Intl.NumberFormat();
const moneyFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const Reports = () => {
  const [timeRange, setTimeRange] = useState(TIME_RANGES[0]);
  const [reportType, setReportType] = useState(REPORT_OPTIONS[0]);
  const [summaryRows, setSummaryRows] = useState([]);
  const [chartData, setChartData] = useState([]);
  const [chartColor, setChartColor] = useState("#2563eb");
  const [chartLabel, setChartLabel] = useState("");
  const [tableColumns, setTableColumns] = useState([]);
  const [tableRows, setTableRows] = useState([]);
  const [loadingReport, setLoadingReport] = useState(false);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const printReport = () => {
    try {
      // Allow layout to settle before print
      setTimeout(() => {
        window.print();
      }, 50);
    } catch {
    }
  };

  const downloadPdf = async () => {
    const root = document.getElementById('report-print-root');
    if (!root) return;
    const h2c = window.html2canvas;
    const jsPDF = window.jspdf?.jsPDF;
    if (!h2c || !jsPDF) {
      // Fallback to browser print if libs not yet loaded
      return printReport();
    }
    try {
      setDownloading(true);
      const canvas = await h2c(root, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const pdf = new jsPDF('p', 'pt', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = canvas.height * (imgWidth / canvas.width);

      let position = 0;
      let heightLeft = imgHeight;
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        position = -(imgHeight - heightLeft);
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      const fileName = `Report_${reportType.value}_${timeRange.value}_${new Date().toISOString().slice(0,10)}.pdf`;
      pdf.save(fileName);
    } finally {
      setDownloading(false);
    }
  };

  const printStyles = (
    <style>{`
        @media print {
          /* Hide sidebar and page chrome */
          .print-hide, .print-hide * { display: none !important; }
          /* Make main content full width for print */
          .print-container { margin: 0 !important; padding: 0 16px !important; }
          /* Avoid sticky gaps */
          body { background: #fff !important; }
        }
      `}</style>
  );

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

  useEffect(() => {
    let ignore = false;
    async function load() {
      setLoadingReport(true);
      setError("");

      try {
        let nextSummary = [];
        let nextChart = [];
        let nextChartLabel = "";
        let nextChartColor = "#2563eb";
        let nextColumns = [];
        let nextRows = [];

        const reportKey = reportType.value;

        if (reportKey === "usage") {
          const { data } = await api.get("/heatmap/visits", { params: { days: timeRange.days } });
          const items = data.items || [];
          const hours = new Array(24).fill(0);
          const days = new Array(7).fill(0);
          items.forEach((it) => {
            const hour = Math.max(0, Math.min(23, Number(it.hour ?? 0)));
            const dowRaw = Number(it.dow ?? 1) - 1;
            const dow = Math.max(0, Math.min(6, dowRaw));
            const count = Number(it.count || 0);
            hours[hour] += count;
            days[dow] += count;
          });

          const total = hours.reduce((acc, v) => acc + v, 0);
          let peakHourIdx = 0;
          let peakHourVal = 0;
          hours.forEach((value, idx) => {
            if (value > peakHourVal) {
              peakHourVal = value;
              peakHourIdx = idx;
            }
          });
          let peakDayIdx = 0;
          let peakDayVal = 0;
          days.forEach((value, idx) => {
            if (value > peakDayVal) {
              peakDayVal = value;
              peakDayIdx = idx;
            }
          });

          const peakHourLabel = peakHourVal > 0 ? `${String(peakHourIdx).padStart(2, "0")}:00 (${numberFormatter.format(peakHourVal)})` : "—";
          const peakDayLabel = peakDayVal > 0 ? `${DAY_LABELS[peakDayIdx]} (${numberFormatter.format(peakDayVal)})` : "—";

          nextSummary = [
            { label: "Total Library Visits", value: numberFormatter.format(total) },
            { label: "Peak Hour", value: peakHourLabel },
            { label: "Busiest Day", value: peakDayLabel },
          ];
          nextChart = hours.map((value, hour) => ({ label: `${hour}:00`, value }));
          nextChartLabel = `Visits per hour (last ${timeRange.days} day${timeRange.days === 1 ? "" : "s"})`;
          nextChartColor = "#2563eb";
          nextColumns = [
            { key: "day", label: "Day" },
            { key: "visits", label: "Visits" },
          ];
          nextRows = DAY_LABELS.map((label, idx) => ({ day: label, visits: numberFormatter.format(days[idx]) }));
        } else if (reportKey === "overdue") {
          const { data } = await api.get("/reports/overdue", { params: { days: timeRange.days, limit: 120 } });
          const items = data.items || [];
          const now = new Date();
          let oldest = 0;
          const grouped = new Map();
          let noDue = 0;
          nextRows = items.map((item) => {
            const due = item.dueAt ? new Date(item.dueAt) : null;
            const borrowed = item.borrowedAt ? new Date(item.borrowedAt) : null;
            if (due) {
              const key = due.toISOString().slice(0, 10);
              grouped.set(key, (grouped.get(key) || 0) + 1);
              const diff = Math.max(0, Math.floor((now - due) / (24 * 60 * 60 * 1000)));
              if (diff > oldest) oldest = diff;
            } else {
              noDue += 1;
            }
            return {
              borrower: item.user || "Unknown Borrower",
              title: item.title || "Untitled",
              due: due ? due.toLocaleString() : "No due date",
              borrowed: borrowed ? borrowed.toLocaleDateString() : "—",
            };
          });

          nextChart = Array.from(grouped.entries())
            .sort((a, b) => (a[0] < b[0] ? -1 : 1))
            .map(([key, value]) => ({ label: new Date(key).toLocaleDateString(), value }));
          if (noDue) {
            nextChart.push({ label: "No due date", value: noDue });
          }

          const oldestLabel = items.length
            ? oldest > 0
              ? `${oldest} day${oldest === 1 ? "" : "s"} overdue`
              : "Due today"
            : "—";

          nextSummary = [
            { label: "Total Overdue Loans", value: numberFormatter.format(items.length) },
            { label: "Oldest Overdue", value: oldestLabel },
          ];
          nextChartLabel = "Overdue loans by due date";
          nextChartColor = "#dc2626";
          nextColumns = [
            { key: "borrower", label: "Borrower" },
            { key: "title", label: "Title" },
            { key: "due", label: "Due Date" },
            { key: "borrowed", label: "Borrowed" },
          ];
        } else if (reportKey === "genre") {
          const lookbackDays = Math.max(timeRange.days, 30);
          const { data } = await api.get("/reports/genre-trends", { params: { days: lookbackDays, limit: 12 } });
          const items = data.items || [];
          const top = items[0];
          const totalLoans = Number(data.totalLoans || data.totalBorrows || 0);

          nextSummary = [
            { label: "Total Loans", value: numberFormatter.format(totalLoans) },
            {
              label: "Top Topic",
              value: top ? `${top.topic} (${numberFormatter.format(top.borrows || 0)} borrows)` : "-",
            },
            {
              label: "Top Topic Share",
              value: top ? `${Number(top.share || 0).toFixed(1)}%` : "-",
            },
          ];
          nextChart = items.map((item) => ({
            label: item.topic || "Uncategorized",
            value: Number(item.share || 0),
          }));
          nextChartLabel = `Borrow share by topic (last ${lookbackDays} day${lookbackDays === 1 ? "" : "s"})`;
          nextChartColor = "#4f46e5";
          nextColumns = [
            { key: "topic", label: "Topic" },
            { key: "borrows", label: "Borrows" },
            { key: "share", label: "Share %" },
            { key: "growth", label: "Growth %" },
            { key: "activeLoans", label: "Active Loans" },
            { key: "lastBorrowed", label: "Last Borrowed" },
          ];
          nextRows = items.map((item) => {
            const growth = Number(item.growth || 0);
            const growthLabel = `${growth > 0 ? "+" : ""}${growth.toFixed(1)}%`;
            return {
              id: item.topic,
              topic: item.topic || "Uncategorized",
              borrows: numberFormatter.format(item.borrows || 0),
              share: `${Number(item.share || 0).toFixed(1)}%`,
              growth: growthLabel,
              activeLoans: numberFormatter.format(item.activeLoans || 0),
              lastBorrowed: item.lastBorrowedAt ? new Date(item.lastBorrowedAt).toLocaleDateString() : "-",
            };
          });
        } else if (reportKey === "underutilized") {
          const inactivityThreshold = Math.max(timeRange.days, 60);
          const { data } = await api.get("/reports/underutilized", {
            params: { days: inactivityThreshold, limit: 25 },
          });
          const items = data.items || [];

          nextSummary = [
            { label: "Underutilized Titles", value: numberFormatter.format(data.totalUnderutilized || 0) },
            { label: "Never Borrowed", value: numberFormatter.format(data.neverBorrowed || 0) },
            {
              label: "Longest Dormant",
              value: data.longestDormantDays ? `${numberFormatter.format(data.longestDormantDays)} days` : "-",
            },
          ];
          nextChart = items.slice(0, 10).map((item) => ({
            label: item.title,
            value:
              item.daysSinceLastBorrowed !== null && item.daysSinceLastBorrowed !== undefined
                ? Number(item.daysSinceLastBorrowed)
                : Number(data.thresholdDays || inactivityThreshold),
          }));
          nextChartLabel = `Days since last borrow (top ${Math.min(items.length, 10)} titles)`;
          nextChartColor = "#f97316";
          nextColumns = [
            { key: "title", label: "Title" },
            { key: "status", label: "Status" },
            { key: "daysIdle", label: "Days Idle" },
            { key: "totalCopies", label: "Total Copies" },
            { key: "availableCopies", label: "Available" },
            { key: "borrowCount", label: "Lifetime Borrows" },
          ];
          nextRows = items.map((item) => ({
            id: item.bookId,
            title: item.title || "Untitled",
            status: item.status || "-",
            daysIdle:
              item.daysSinceLastBorrowed !== null && item.daysSinceLastBorrowed !== undefined
                ? numberFormatter.format(item.daysSinceLastBorrowed)
                : "Never",
            totalCopies:
              item.totalCopies !== null && item.totalCopies !== undefined
                ? numberFormatter.format(item.totalCopies)
                : "-",
            availableCopies:
              item.availableCopies !== null && item.availableCopies !== undefined
                ? numberFormatter.format(item.availableCopies)
                : "-",
            borrowCount: numberFormatter.format(item.borrowCount || 0),
          }));
        } else if (reportKey === "fines") {
          const { data } = await api.get("/reports/fines", { params: { limit: 30 } });
          const items = data.items || [];
          const totals = data.totals || {};

          nextSummary = [
            { label: "Outstanding Fines", value: moneyFormatter.format(totals.outstanding || 0) },
            { label: "Overdue Loans", value: numberFormatter.format(totals.overdueLoans || 0) },
            { label: "Average Fine", value: moneyFormatter.format(totals.averageFine || 0) },
            { label: "Avg Days Overdue", value: moneyFormatter.format(totals.averageDaysOverdue || 0) },
          ];
          nextChart = items.map((item) => ({
            label: item.borrower || "Unknown Borrower",
            value: Number(item.fine || 0),
          }));
          nextChartLabel = "Outstanding fines by borrower";
          nextChartColor = "#ef4444";
          nextColumns = [
            { key: "borrower", label: "Borrower" },
            { key: "title", label: "Title" },
            { key: "daysOverdue", label: "Days Overdue" },
            { key: "fine", label: "Fine" },
          ];
          nextRows = items.map((item) => ({
            id: item.loanId,
            borrower: item.borrower || "Unknown Borrower",
            title: item.title || "Untitled",
            daysOverdue: numberFormatter.format(item.daysOverdue || 0),
            fine: moneyFormatter.format(item.fine || 0),
          }));
        } else {
          const { data } = await api.get("/reports/top-books", { params: { days: timeRange.days, limit: 12 } });
          const items = data.items || [];
          const totalBorrows = items.reduce((acc, item) => acc + Number(item.borrows || 0), 0);
          const top = items[0];

          nextSummary = [
            { label: "Total Borrows", value: numberFormatter.format(totalBorrows) },
            {
              label: "Top Title",
              value: top ? `${top.title} (${numberFormatter.format(top.borrows || 0)})` : "—",
            },
          ];
          nextChart = items.map((item) => ({ label: item.title, value: Number(item.borrows || 0) }));
          nextChartLabel = "Borrows per title";
          nextChartColor = "#0f766e";
          nextColumns = [
            { key: "title", label: "Title" },
            { key: "author", label: "Author" },
            { key: "borrows", label: "Borrows" },
          ];
          nextRows = items.map((item) => ({
            title: item.title,
            author: item.author,
            borrows: numberFormatter.format(item.borrows || 0),
          }));
        }

        if (!ignore) {
          setSummaryRows(nextSummary);
          setChartData(nextChart);
          setChartLabel(nextChartLabel);
          setChartColor(nextChartColor);
          setTableColumns(nextColumns);
          setTableRows(nextRows);
        }
      } catch (err) {
        if (!ignore) {
          setError("Failed to load report data. Please try again.");
          setSummaryRows([]);
          setChartData([]);
          setTableColumns([]);
          setTableRows([]);
        }
      } finally {
        if (!ignore) setLoadingReport(false);
      }
    }

    load();
    return () => {
      ignore = true;
    };
  }, [reportType, timeRange]);

  return (
    <AdminPageLayout
      title="Reports"
      description="Generate comprehensive library reports and analytics"
      beforeMain={printStyles}
      actions={headerActions}
      actionsClassName="print-hide"
      mainClassName="print-container"
    >
        <section className="mt-6" id="report-print-root">
          <h2 className="text-2xl font-semibold text-slate-900 [[data-theme=dark]_&]:text-stone-100">Auto Reports</h2>

          <div className="mt-3 flex items-center gap-2 print-hide">
            {TIME_RANGES.map((range) => (
              <button
                key={range.value}
                onClick={() => setTimeRange(range)}
                className={`rounded-lg px-3 py-1.5 ring-1 ring-slate-200 [[data-theme=dark]_&]:ring-stone-700 ${
                  timeRange.value === range.value
                    ? "bg-brand-gold text-white"
                    : "theme-panel text-slate-700 [[data-theme=dark]_&]:text-stone-200"
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>

          <div className="mt-3 flex items-center gap-2 print-hide">
            <label className="text-sm text-slate-700 [[data-theme=dark]_&]:text-stone-200">Report Type:</label>
            <select
              value={reportType.value}
              onChange={(e) => {
                const next = REPORT_OPTIONS.find((opt) => opt.value === e.target.value);
                if (next) setReportType(next);
              }}
              className="rounded-lg px-3 py-1.5 theme-panel ring-1 ring-slate-200 [[data-theme=dark]_&]:ring-stone-700 text-slate-700 [[data-theme=dark]_&]:text-stone-200"
            >
              {REPORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {error && (
            <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          )}

          <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl theme-panel ring-1 ring-slate-200 [[data-theme=dark]_&]:ring-stone-700 p-4">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-600 [[data-theme=dark]_&]:text-stone-300">
                    <th className="py-2 pr-4">Metric</th>
                    <th className="py-2 pr-4">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 [[data-theme=dark]_&]:divide-slate-700">
                  {loadingReport && summaryRows.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="py-6 text-center text-slate-500 [[data-theme=dark]_&]:text-stone-300">
                        Loading summary...
                      </td>
                    </tr>
                  ) : summaryRows.length ? (
                    summaryRows.map((row) => (
                      <tr key={row.label} className="text-slate-800 [[data-theme=dark]_&]:text-stone-100">
                        <td className="py-2 pr-4">{row.label}</td>
                        <td className="py-2 pr-4">{row.value}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={2} className="py-6 text-center text-slate-500 [[data-theme=dark]_&]:text-stone-300">
                        No summary data available.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="rounded-xl theme-panel ring-1 ring-slate-200 [[data-theme=dark]_&]:ring-stone-700 p-4">
              <p className="text-sm text-slate-500 [[data-theme=dark]_&]:text-stone-300 mb-2">{chartLabel}</p>
              <div className="h-[250px]">
                {loadingReport && chartData.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500 [[data-theme=dark]_&]:text-stone-300">
                    Loading chart...
                  </div>
                ) : chartData.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" interval={chartData.length > 12 ? Math.ceil(chartData.length / 12) : 0} />
                      <YAxis allowDecimals={false} />
                      <Tooltip formatter={(value) => numberFormatter.format(value)} />
                      <Bar dataKey="value" fill={chartColor} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500 [[data-theme=dark]_&]:text-stone-300">
                    No chart data available.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-xl theme-panel ring-1 ring-slate-200 [[data-theme=dark]_&]:ring-stone-700 p-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-600 [[data-theme=dark]_&]:text-stone-300">
                  {tableColumns.map((col) => (
                    <th key={col.key} className="py-2 pr-4">
                      {col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 [[data-theme=dark]_&]:divide-slate-700">
                {loadingReport && tableRows.length === 0 ? (
                  <tr>
                    <td colSpan={Math.max(1, tableColumns.length)} className="py-6 text-center text-slate-500 [[data-theme=dark]_&]:text-stone-300">
                      Loading records...
                    </td>
                  </tr>
                ) : tableRows.length ? (
                  tableRows.map((row, idx) => (
                    <tr key={row.id || `${idx}-${reportType.value}`} className="text-slate-800 [[data-theme=dark]_&]:text-stone-100">
                      {tableColumns.map((col) => (
                        <td key={col.key} className="py-2 pr-4">
                          {row[col.key] ?? "—"}
                        </td>
                      ))}
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={Math.max(1, tableColumns.length)} className="py-6 text-center text-slate-500 [[data-theme=dark]_&]:text-stone-300">
                      No records available for the selected report.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 print-hide flex gap-2">
            <button onClick={downloadPdf} className="rounded-lg px-4 py-2 bg-brand-gold text-white hover:opacity-90 disabled:opacity-60" disabled={downloading}>
              {downloading ? 'Exporting…' : 'Download as PDF'}
            </button>
            <button onClick={printReport} className="rounded-lg px-4 py-2 ring-1 ring-slate-300 text-slate-700 [[data-theme=dark]_&]:text-stone-200 hover:bg-slate-50 [[data-theme=dark]_&]:hover:bg-stone-800">
              Print
            </button>
          </div>
        </section>
    </AdminPageLayout>
  );
};

export default Reports;
