import React from "react";
import api from "../api";

const PAGE_SIZE = 3;

const StudentOverdueBooks = () => {
  const [loading, setLoading] = React.useState(true);
  const [books, setBooks] = React.useState([]);
  const [error, setError] = React.useState("");

  const [returning, setReturning] = React.useState(false);
  const [returnSuccess, setReturnSuccess] = React.useState(null);
  const [page, setPage] = React.useState(1);

  React.useEffect(() => {
    const fetchOverdueBooks = async () => {
      try {
        setLoading(true);
        const { data } = await api.get("/student/overdue-books");
        const items = Array.isArray(data?.books) ? data.books : [];
        setBooks(items);
        setPage(1);
      } catch (err) {
        setError("Failed to load your overdue books. Please try again later.");
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchOverdueBooks();
  }, []);

  const handleReturnBook = React.useCallback(async (bookId, bookTitle) => {
    if (returning) return;

    setReturning(true);
    setError("");

    try {
      await api.post("/student/return", { bookId });

      setReturnSuccess({
        title: bookTitle
      });

      const { data } = await api.get("/student/overdue-books");
      const items = Array.isArray(data?.books) ? data.books : [];
      setBooks(items);
      setPage((prev) => {
        const nextPageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
        return Math.min(Math.max(prev, 1), nextPageCount);
      });
    } catch (err) {
      setError(err.response?.data?.error || "Failed to return book. Please try again.");
    } finally {
      setReturning(false);
    }
  }, [returning]);

  const pageCount = Math.max(1, Math.ceil(books.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 1), pageCount);
  const startIndex = (safePage - 1) * PAGE_SIZE;
  const endIndex = startIndex + PAGE_SIZE;
  const paginatedBooks = books.slice(startIndex, endIndex);
  const showingStart = books.length === 0 ? 0 : startIndex + 1;
  const showingEnd = Math.min(endIndex, books.length);

  return (
    <div className="bg-slate-50">
      <div className="relative overflow-hidden border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-12">
          <h1 className="text-3xl font-semibold text-slate-900">Overdue Books</h1>
          <p className="text-sm text-slate-600">
            View and manage your overdue books that need to be returned to the library.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-10">
        {error && (
          <div className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
        )}

        {returnSuccess && (
          <div className="mb-6 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            <div className="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22,4 12,14.01 9,11.01" />
              </svg>
              <span>
                <strong>Success!</strong> You have returned "{returnSuccess.title}".
              </span>
            </div>
            <button
              onClick={() => setReturnSuccess(null)}
              className="mt-2 text-green-600 underline hover:text-green-800"
            >
              Dismiss
            </button>
          </div>
        )}

        {loading ? (
          <div className="space-y-4">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="rounded-lg bg-white p-6 shadow-sm animate-pulse">
                <div className="mb-4 h-6 w-1/3 rounded bg-slate-200"></div>
                <div className="mb-2 h-4 w-1/2 rounded bg-slate-200"></div>
                <div className="h-4 w-1/4 rounded bg-slate-200"></div>
              </div>
            ))}
          </div>
        ) : books.length > 0 ? (
          <div className="space-y-4">
            {paginatedBooks.map((book) => {
              const key = book.id || book._id || book.bookId || `overdue-${book.title}`;
              const title = book.title || "Untitled item";
              const author = book.author || "Unknown author";
              const dueLabel = book.dueAt ? new Date(book.dueAt).toLocaleDateString() : "--";
              const borrowedLabel = book.borrowedAt ? new Date(book.borrowedAt).toLocaleDateString() : "--";
              const canManage = Boolean(book.bookId);
              return (
                <div key={key} className="rounded-lg border-l-4 border-red-500 bg-white p-6 shadow-sm">
                  <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                      <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
                      <p className="text-sm text-slate-600">By {author}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span className="inline-flex items-center rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700">
                          Due: {dueLabel}
                        </span>
                        <span className="inline-flex items-center rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700">
                          Days Overdue: {book.daysOverdue}
                        </span>
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                          Fine: ${book.fine.toFixed(2)}
                        </span>
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                          Borrowed: {borrowedLabel}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="btn-student-primary btn-pill-sm disabled:cursor-not-allowed disabled:opacity-50"
                        onClick={() => canManage && handleReturnBook(book.bookId, title)}
                        disabled={returning || !canManage}
                      >
                        {returning ? "Returning..." : "Return Now"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            <div className="flex flex-col items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm md:flex-row">
              <div>
                Showing <span className="font-semibold text-slate-900">{showingStart}</span>-<span className="font-semibold text-slate-900">{showingEnd}</span> of{" "}
                <span className="font-semibold text-slate-900">{books.length}</span> overdue books
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
            <h3 className="text-lg font-medium text-slate-900">No overdue books</h3>
            <p className="mt-2 text-sm text-slate-600">
              Great job! You don't have any overdue books at the moment.
            </p>
            <div className="mt-6">
              <a href="/student/requests" className="btn-student-primary">
                View Borrow Requests
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default StudentOverdueBooks;
