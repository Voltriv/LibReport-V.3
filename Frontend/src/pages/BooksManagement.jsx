import React, { useCallback, useEffect, useRef, useState } from "react";
import AdminPageLayout from "../components/AdminPageLayout";
import api, { resolveMediaUrl } from "../api";
import BookFormModal from "../components/BookFormModal";
import DeleteConfirmModal from "../components/DeleteConfirmModal";

const BooksManagement = () => {
  const [books, setBooks] = useState([]);
  const [toast, setToast] = useState(null); // { msg, type }
  const toastTimeoutRef = useRef(null);
  // Separate dropdown state for per-card menu
  const [cardMenuOpenId, setCardMenuOpenId] = useState(null);

  // Form/UI states
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editingBook, setEditingBook] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const toggleDropdown = (id) => {
    setCardMenuOpenId((prev) => (prev === id ? null : id));
  };

  const loadCatalog = useCallback(async () => {
    try {
      const { data } = await api.get("/books");
      const items = (data || []).map((b) => {
        const rawCover = b.coverImagePath || b.imageUrl || "";
        const coverPath = resolveMediaUrl(rawCover);
        const rawPdf = b.pdfPath || b.pdfUrl || "";
        const pdfPath = resolveMediaUrl(rawPdf);
        const department = b.department || "";
        const genre = b.genre || "";
        const departmentLabel =
          department ||
          genre ||
          (Array.isArray(b.tags) && b.tags.find((tag) => tag && String(tag).trim())) ||
          "";
        return {
          id: b._id || b.id,
          title: b.title,
          author: b.author,
          bookCode: b.bookCode || "",
          department,
          departmentLabel,
          genre,
          totalCopies: b.totalCopies ?? 0,
          availableCopies: b.availableCopies ?? 0,
          coverImagePath: coverPath,
          pdfPath: pdfPath,
          createdAt: b.createdAt ? new Date(b.createdAt) : null,
          isbn: b.isbn || "",
        };
      });
      items.sort(
        (a, b) =>
          (b.createdAt ? b.createdAt.getTime() : 0) -
          (a.createdAt ? a.createdAt.getTime() : 0)
      );
      setBooks(items);
    } catch {
      setBooks([]);
      showToast("Failed to load catalog", "error");
    }
  }, []);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  const handleManualRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await loadCatalog();
      setRefreshNonce((n) => n + 1);
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, loadCatalog]);

  const showToast = (msg, type) => {
    setToast({ msg, type });
    clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToast(null), 3000);
  };

  // Create book
  async function handleCreateBook(payload) {
    setFormBusy(true);
    setFormError(null);
    try {
      await api.post("/books", payload);
      await loadCatalog();
      setIsAddOpen(false);
      setFormError(null);
      showToast("Book added", "success");
    } catch (err) {
      const msg = err?.response?.data?.error || "Failed to add book";
      setFormError(msg);
    } finally {
      setFormBusy(false);
    }
  }

  // Update book
  async function handleUpdateBook(payload) {
    if (!editingBook) return;
    setFormBusy(true);
    setFormError(null);
    try {
      await api.patch(`/books/${editingBook.id}`, payload);
      await loadCatalog();
      setEditingBook(null);
      setFormError(null);
      showToast("Book updated", "success");
    } catch (err) {
      const msg = err?.response?.data?.error || "Failed to update book";
      setFormError(msg);
    } finally {
      setFormBusy(false);
    }
  }

  // Delete book
  async function handleDeleteBook() {
    if (!deleteTarget) return;
    
    try {
      await api.delete(`/books/${deleteTarget.id}`);
      await loadCatalog();
      setDeleteTarget(null);
      showToast("Book deleted", "success");
    } catch (err) {
      const msg = err?.response?.data?.error || "Failed to delete book";
      showToast(msg, "error");
    } finally {
      
    }
  }

  const headerActions = (
    <>
      <button
        type="button"
        onClick={handleManualRefresh}
        className="inline-flex items-center gap-2 rounded-xl bg-slate-100 [[data-theme=dark]_&]:bg-stone-800 text-slate-700 [[data-theme=dark]_&]:text-stone-300 px-4 py-2 hover:bg-slate-200 [[data-theme=dark]_&]:hover:bg-stone-700 transition-colors duration-200"
      >
        <svg className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        {refreshing ? "Refreshing..." : "Refresh"}
      </button>
      <button
        type="button"
        onClick={() => setIsAddOpen(true)}
        className="inline-flex items-center gap-2 rounded-xl bg-brand-green text-white px-4 py-2 hover:bg-brand-greenDark transition-colors duration-200 shadow-lg hover:shadow-xl"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Add Book
      </button>
    </>
  );

  return (
    <AdminPageLayout
      title="Books Management"
      description="Manage your library's book collection"
      actions={headerActions}
    >
        {/* Cards + Grid (unchanged) */}
        {/* ...existing stats and cards code... */}

        {/* Books Grid */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-slate-900 [[data-theme=dark]_&]:text-stone-100">Book Collection</h2>
            <div className="text-sm text-slate-500 [[data-theme=dark]_&]:text-stone-400">
              {books.length} {books.length === 1 ? "book" : "books"} in collection
            </div>
          </div>

          {books.length === 0 ? (
            <div className="text-center py-12">
              <div className="h-24 w-24 rounded-full bg-slate-100 [[data-theme=dark]_&]:bg-stone-800 flex items-center justify-center mx-auto mb-4">
                <svg className="h-12 w-12 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-slate-900 [[data-theme=dark]_&]:text-stone-100 mb-2">No books found</h3>
              <p className="text-slate-500 [[data-theme=dark]_&]:text-stone-400 mb-6">Get started by adding your first book.</p>
              <button
                onClick={() => setIsAddOpen(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-brand-green text-white px-6 py-3 hover:bg-brand-greenDark transition-colors duration-200"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add First Book
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {books.map((book) => (
                <div key={book.id} className="group relative theme-panel rounded-2xl ring-1 ring-slate-200 [[data-theme=dark]_&]:ring-stone-700 hover:shadow-xl transition-all duration-300">
                  {/* Cover */}
                  <div className="aspect-[3/4] bg-gradient-to-br from-slate-100 to-slate-200 [[data-theme=dark]_&]:from-stone-800 [[data-theme=dark]_&]:to-stone-700 flex items-center justify-center relative overflow-hidden">
                    {/* Fallback placeholder sits behind the image */}
                    <div className="absolute inset-0 z-0 pointer-events-none flex items-center justify-center">
                      <div className="text-center p-4">
                        <svg className="h-16 w-16 text-slate-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                        </svg>
                        <p className="text-xs text-slate-500 [[data-theme=dark]_&]:text-stone-400">No cover image</p>
                      </div>
                    </div>
                    {/* Image (hidden on error) */}
                    {book.coverImagePath && (
                      <img
                        src={`${book.coverImagePath}${book.coverImagePath.includes('?') ? '&' : '?'}r=${refreshNonce}`}
                        alt={book.title}
                        loading="lazy"
                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                        className="relative z-10 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    )}

                    {/* Menu */}
                    <div className="absolute top-3 right-3 z-20">
                      <div className="relative">
                        <button
                          onClick={() => toggleDropdown(book.id)}
                          className="h-8 w-8 rounded-lg bg-white/90 [[data-theme=dark]_&]:bg-stone-900/90 backdrop-blur-sm flex items-center justify-center shadow-lg hover:bg-white [[data-theme=dark]_&]:hover:bg-stone-800 transition-colors duration-200"
                        >
                          <svg className="h-4 w-4 text-slate-600 [[data-theme=dark]_&]:text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01" />
                          </svg>
                        </button>

                        {cardMenuOpenId === book.id && (
                          <div className="absolute right-0 mt-2 w-48 rounded-xl theme-panel ring-1 ring-slate-200 [[data-theme=dark]_&]:ring-stone-700 shadow-xl p-2 z-50">
                            <button
                              onClick={() => {
                                setEditingBook(book);
                                setCardMenuOpenId(null);
                              }}
                              className="w-full text-left rounded-lg px-3 py-2 text-sm text-slate-700 [[data-theme=dark]_&]:text-stone-300 hover:bg-slate-50 [[data-theme=dark]_&]:hover:bg-stone-800 transition-colors duration-200"
                            >
                              Edit Book
                            </button>
                            <button
                              onClick={() => {
                                setDeleteTarget(book);
                                setCardMenuOpenId(null);
                              }}
                              className="w-full text-left rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50 [[data-theme=dark]_&]:hover:bg-red-900/20 transition-colors duration-200"
                            >
                              Delete Book
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Info */}
                  <div className="p-4">
                    <h3 className="font-bold text-slate-900 [[data-theme=dark]_&]:text-stone-100 text-sm mb-1 line-clamp-2">
                      {book.title}
                    </h3>
                    <p className="text-xs text-slate-600 [[data-theme=dark]_&]:text-stone-400 mb-3 line-clamp-1">
                      by {book.author}
                    </p>
                    <div className="flex items-center justify-between text-xs">
                      <span className="px-2 py-1 rounded-full bg-slate-100 [[data-theme=dark]_&]:bg-stone-800 text-slate-600 [[data-theme=dark]_&]:text-stone-400">
                        {book.departmentLabel || "No department"}
                      </span>
                      <span className="text-slate-500 [[data-theme=dark]_&]:text-stone-500">
                        {book.availableCopies || 0}/{book.totalCopies || 0} available
                      </span>
                    </div>
                    {book.genre && (
                      <div className="mt-2 text-xs text-slate-500 [[data-theme=dark]_&]:text-stone-500">
                        Genre: {book.genre}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Toast */}
        {toast && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none">
            <div
              className={`pointer-events-auto rounded-xl px-4 py-3 shadow-lg ring-1 ${
                toast.type === "success"
                  ? "bg-green-50 text-green-800 ring-green-200 [[data-theme=dark]_&]:bg-green-900/20 [[data-theme=dark]_&]:text-green-400 [[data-theme=dark]_&]:ring-green-800"
                  : "bg-red-50 text-red-800 ring-red-200 [[data-theme=dark]_&]:bg-red-900/20 [[data-theme=dark]_&]:text-red-400 [[data-theme=dark]_&]:ring-red-800"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{toast.msg}</span>
              </div>
            </div>
          </div>
        )}

        {/* Modals */}
        <BookFormModal
          open={isAddOpen}
          mode="create"
          onCancel={() => { setIsAddOpen(false); setFormError(null); }}
          onSubmit={handleCreateBook}
          busy={formBusy}
          serverError={formError}
          onClearServerError={() => setFormError(null)}
        />
        {editingBook && (
          <BookFormModal
            open
            mode="edit"
            book={editingBook}
            onCancel={() => { setEditingBook(null); setFormError(null); }}
            onSubmit={handleUpdateBook}
            busy={formBusy}
            serverError={formError}
            onClearServerError={() => setFormError(null)}
          />
        )}
        <DeleteConfirmModal
          open={!!deleteTarget}
          title={deleteTarget?.title}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleDeleteBook}
        />

    </AdminPageLayout>
  );
};

export default BooksManagement;



