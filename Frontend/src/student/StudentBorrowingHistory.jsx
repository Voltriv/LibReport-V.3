import React from "react";
import api from "../api";

const PAGE_SIZE = 6;

const StudentBorrowingHistory = () => {
  const [loading, setLoading] = React.useState(true);
  const [history, setHistory] = React.useState([]);
  const [error, setError] = React.useState("");
  const [page, setPage] = React.useState(1);

  React.useEffect(() => {
    const fetchBorrowingHistory = async () => {
      try {
        setLoading(true);
        const { data } = await api.get("/student/borrowing-history");
        const entries = Array.isArray(data?.history) ? data.history : [];
        setHistory(entries);
        setPage(1);
      } catch (err) {
        setError("Failed to load your borrowing history. Please try again later.");
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchBorrowingHistory();
  }, []);

  const pageCount = Math.max(1, Math.ceil(history.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 1), pageCount);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const endIndex = startIndex + PAGE_SIZE;
  const paginatedHistory = history.slice(startIndex, endIndex);
  const showingStart = history.length === 0 ? 0 : startIndex + 1;
  const showingEnd = Math.min(endIndex, history.length);

  return (
    <div className="bg-slate-50">
      <div className="relative overflow-hidden border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-12">
          <h1 className="text-3xl font-semibold text-slate-900">Borrowing History</h1>
          <p className="text-sm text-slate-600">
            View your complete borrowing history from the library.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-10">
        {error && (
          <div className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
        )}

        {loading ? (
          <div className="space-y-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="rounded-lg bg-white p-6 shadow-sm animate-pulse">
                <div className="h-6 w-1/3 bg-slate-200 rounded mb-4"></div>
                <div className="h-4 w-1/2 bg-slate-200 rounded mb-2"></div>
                <div className="h-4 w-1/4 bg-slate-200 rounded"></div>
              </div>
            ))}
          </div>
        ) : history.length > 0 ? (
          <div className="overflow-hidden rounded-lg bg-white shadow-sm">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                    Book Title
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                    Borrowed Date
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                    Return Date
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {paginatedHistory.map((item) => {
                  const key = item.id || item._id || `${item.bookId}-${item.borrowedAt}`;
                  const title = item.title || "Untitled item";
                  const author = item.author || "Unknown author";
                  const borrowedLabel = item.borrowedAt ? new Date(item.borrowedAt).toLocaleDateString() : "--";
                  const returnedLabel = item.returnedAt ? new Date(item.returnedAt).toLocaleDateString() : "N/A";
                  return (
                    <tr key={key}>
                      <td className="whitespace-nowrap px-6 py-4">
                        <div className="text-sm font-medium text-slate-900">{title}</div>
                        <div className="text-sm text-slate-500">{author}</div>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-500">{borrowedLabel}</td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-slate-500">{returnedLabel}</td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <span
                          className={`inline-flex rounded-full px-2 text-xs font-semibold leading-5 ${
                            item.status === "Returned"
                              ? "bg-green-100 text-green-800"
                              : item.status === "Overdue"
                              ? "bg-red-100 text-red-800"
                              : "bg-blue-100 text-blue-800"
                          }`}
                        >
                          {item.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="flex flex-col items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 md:flex-row">
              <div>
                Showing <span className="font-semibold text-slate-900">{showingStart}</span>-<span className="font-semibold text-slate-900">{showingEnd}</span> of{" "}
                <span className="font-semibold text-slate-900">{history.length}</span> records
              </div>
              <div className="inline-flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
                  disabled={safePage <= 1}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
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
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
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
          <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
            <h3 className="text-lg font-medium text-slate-900">No borrowing history</h3>
            <p className="mt-2 text-sm text-slate-600">
              You haven't borrowed any books from the library yet.
            </p>
            <div className="mt-6">
              <a href="/student/catalog" className="btn-student-primary">
                Browse Catalog
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default StudentBorrowingHistory;
