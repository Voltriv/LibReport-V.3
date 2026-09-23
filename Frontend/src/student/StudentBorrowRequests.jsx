import React from "react";
import api from "../api";

const STATUS_DETAILS = {
  pending: {
    label: "Pending",
    badgeClass: "bg-amber-100 text-amber-800",
    description: "Your request is awaiting review from the library team."
  },
  approved: {
    label: "Approved",
    badgeClass: "bg-emerald-100 text-emerald-700",
    description: "The request has been approved. Please check your due date below."
  },
  rejected: {
    label: "Rejected",
    badgeClass: "bg-rose-100 text-rose-700",
    description: "The request was declined. Any notes from the librarian are shown below."
  },
  cancelled: {
    label: "Cancelled",
    badgeClass: "bg-slate-200 text-slate-600",
    description: "This request has been cancelled."
  }
};

const PAGE_SIZE = 5;

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date) {
  if (!date) return "--";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

function formatDateTime(date) {
  if (!date) return "--";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

const StudentBorrowRequests = () => {
  const [requests, setRequests] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState("");
  const [page, setPage] = React.useState(1);

  const fetchRequests = React.useCallback(async ({ silent = false } = {}) => {
    if (silent) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError("");

    try {
      const { data } = await api.get("/student/borrow-requests");
      const items = Array.isArray(data?.items) ? data.items : [];

      const mapped = items.map((item, index) => ({
        id: item.id || item._id || `request-${index}`,
        status: item.status || "pending",
        requestedAt: parseDate(item.requestedAt || item.createdAt),
        processedAt: parseDate(item.processedAt || item.updatedAt),
        dueAt: parseDate(item.dueAt),
        daysRequested: typeof item.daysRequested === "number" ? item.daysRequested : null,
        message: item.message || "",
        adminNote: item.adminNote || "",
        book: item.book || null,
        processedBy: item.processedBy || null
      }));
      setRequests(mapped);
      setPage(1);
    } catch (err) {
      const fallback = "Failed to load your borrow requests. Please try again later.";
      setError(err?.response?.data?.error || fallback);
      if (!silent) {
        setRequests([]);
      }
    } finally {
      if (silent) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, []);

  React.useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const handleRefresh = React.useCallback(() => {
    if (!refreshing) {
      fetchRequests({ silent: true });
    }
  }, [fetchRequests, refreshing]);

  const totalRequests = requests.length;
  const pendingCount = React.useMemo(
    () => requests.filter((request) => request.status === "pending").length,
    [requests]
  );
  const approvedCount = React.useMemo(
    () => requests.filter((request) => request.status === "approved").length,
    [requests]
  );

  const pageCount = Math.max(1, Math.ceil(requests.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 1), pageCount);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const endIndex = startIndex + PAGE_SIZE;
  const paginatedRequests = requests.slice(startIndex, endIndex);
  const showingStart = requests.length === 0 ? 0 : startIndex + 1;
  const showingEnd = Math.min(endIndex, requests.length);

  return (
    <div className="bg-slate-50 min-h-screen">
      <div className="relative border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-12">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Borrow Requests</h1>
            <p className="mt-1 text-sm text-slate-600">
              Track the status of the books you've requested from the library.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total Requests</div>
              <div className="mt-1 text-2xl font-semibold text-slate-900">{totalRequests}</div>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-600">Pending</div>
              <div className="mt-1 text-2xl font-semibold">{pendingCount}</div>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Approved</div>
              <div className="mt-1 text-2xl font-semibold">{approvedCount}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-10">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">Request Activity</h2>
            <p className="text-sm text-slate-600">Stay up to date with processing updates and due dates.</p>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {refreshing ? (
              <svg className="h-4 w-4 animate-spin text-brand-green" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M21 12a9 9 0 1 1-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg className="h-4 w-4 text-brand-green" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M21 12a9 9 0 1 1-3.51-7.05" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <polyline points="21 3 21 9 15 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            <span>{refreshing ? "Refreshing..." : "Refresh"}</span>
          </button>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
        )}

        {loading && !requests.length ? (
          <div className="space-y-4">
            {[...Array(3)].map((_, index) => (
              <div key={index} className="animate-pulse rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-3 h-5 w-1/3 rounded bg-slate-200" />
                <div className="mb-2 h-4 w-1/2 rounded bg-slate-200" />
                <div className="h-4 w-1/4 rounded bg-slate-200" />
              </div>
            ))}
          </div>
        ) : requests.length > 0 ? (
          <div className="space-y-6">
            <div className="space-y-4">
              {paginatedRequests.map((request) => {
                const details = STATUS_DETAILS[request.status] || STATUS_DETAILS.pending;
                const bookTitle = request.book?.title || "Book unavailable";
                const bookAuthor = request.book?.author;
                const bookCode = request.book?.code;

                return (
                  <div key={request.id} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-2">
                      <span className={`inline-flex w-fit items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${details.badgeClass}`}>
                        {details.label}
                      </span>
                      <h3 className="text-lg font-semibold text-slate-900">{bookTitle}</h3>
                      {(bookAuthor || bookCode) && (
                        <p className="text-sm text-slate-600">{[bookAuthor, bookCode].filter(Boolean).join(" • ")}</p>
                      )}
                      <p className="text-xs text-slate-500">{details.description}</p>
                    </div>
                    <div className="min-w-[220px] rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
                      <div className="font-semibold text-slate-700">Requested</div>
                      <div className="mt-1 text-slate-700">{formatDateTime(request.requestedAt)}</div>
                      {request.processedAt && (
                        <div className="mt-4">
                          <div className="font-semibold text-slate-700">Processed</div>
                          <div className="mt-1 text-slate-700">{formatDateTime(request.processedAt)}</div>
                        </div>
                      )}
                      {request.dueAt && request.status === "approved" && (
                        <div className="mt-4">
                          <div className="font-semibold text-slate-700">Due Date</div>
                          <div className="mt-1 text-emerald-700">{formatDate(request.dueAt)}</div>
                        </div>
                      )}
                      {request.processedBy?.name && (
                        <div className="mt-4 text-xs text-slate-500">Handled by {request.processedBy.name}</div>
                      )}
                    </div>
                  </div>

                  {request.daysRequested ? (
                    <div className="mt-4 inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                      Requested for {request.daysRequested} {request.daysRequested === 1 ? "day" : "days"}
                    </div>
                  ) : null}

                  {request.message ? (
                    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Your Note</div>
                      <p className="mt-1 leading-relaxed">{request.message}</p>
                    </div>
                  ) : null}

                  {request.adminNote ? (
                    <div className="mt-4 rounded-xl border border-brand-gold bg-brand-gold-soft px-4 py-3 text-sm text-brand-gold-ink">
                      <div className="text-xs font-semibold uppercase tracking-wide">Librarian Note</div>
                      <p className="mt-1 leading-relaxed">{request.adminNote}</p>
                    </div>
                  ) : null}
                </div>
              );
              })}
            </div>

            <div className="flex flex-col items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm md:flex-row">
              <div>
                Showing <span className="font-semibold text-slate-900">{showingStart}</span>-
                <span className="font-semibold text-slate-900">{showingEnd}</span> of{" "}
                <span className="font-semibold text-slate-900">{requests.length}</span> requests
              </div>
              <div className="inline-flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
                  disabled={safePage <= 1}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-600 transition disabled:cursor-not-allowed disabled:opacity-40 hover:border-slate-300 hover:bg-slate-100"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m15 18-6-6 6-6" />
                  </svg>
                  Previous
                </button>
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Page <span className="text-slate-900">{safePage}</span> of <span className="text-slate-900">{pageCount}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setPage((prev) => Math.min(prev + 1, pageCount))}
                  disabled={safePage >= pageCount}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-600 transition disabled:cursor-not-allowed disabled:opacity-40 hover:border-slate-300 hover:bg-slate-100"
                >
                  Next
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m9 6 6 6-6 6" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
              <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 4h16v12H5.17L4 17.17V4z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M8 8h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M8 12h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <h3 className="mt-4 text-lg font-semibold text-slate-900">No borrow requests yet</h3>
            <p className="mt-2 text-sm text-slate-600">Request a book from the catalog to see it appear here.</p>
            <a
              href="/student/catalog"
              className="mt-4 inline-flex items-center gap-2 rounded-full bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow-lg transition hover:scale-105 hover:shadow-xl"
            >
              Browse Catalog
            </a>
          </div>
        )}
      </div>
    </div>
  );
};

export default StudentBorrowRequests;
