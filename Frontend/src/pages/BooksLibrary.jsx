import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AdminPageLayout from "../components/AdminPageLayout";
import api, { resolveMediaUrl } from "../api";

const PAGE_SIZE = 24;
const DEPARTMENT_TAGS = ["CAHS", "CITE", "CCJE", "CEA", "CELA", "COL", "SHS"];

const deriveStats = (list) => {
  let withPdf = 0;
  for (const item of list) {
    if (item?.hasPdf) withPdf += 1;
  }
  return { total: list.length, withPdf };
};

const formatCount = (value) => {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number.toLocaleString() : "0";
};

const toMediaUrl = (path) => {
  if (!path) return null;
  const value = String(path).trim();
  if (!value) return null;
  return resolveMediaUrl(value);
};

const isLikelyFileUrl = (url) => {
  if (!url) return false;
  const source = String(url);
  if (/\/api\/files\/[a-f0-9]{24}(?:\/|$)/i.test(source)) return true;
  if (/\/uploads\/.+\.(?:pdf|png|jpg|jpeg|webp)(?:\?|$)/i.test(source)) return true;
  return false;
};

function IconSearch(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m21 21-3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconStackedBooks(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M3 5.75h12a1.75 1.75 0 0 1 0 3.5H3z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M3 10.75h12a1.75 1.75 0 0 1 0 3.5H3z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M3 15.75h12a1.75 1.75 0 0 1 0 3.5H3z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M18 5.75h3v3.5h-3z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M18 10.75h3v3.5h-3z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M18 15.75h3v3.5h-3z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconDocument(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M14 3v5h5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M9 13h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M9 17h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function IconCompass(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="m15.6 8.6-2.3 5.5-5.6 2.3 2.3-5.6 5.6-2.2Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}

function IconEmptyState(props) {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" {...props}>
      <rect
        x="8"
        y="14"
        width="48"
        height="36"
        rx="8"
        stroke="currentColor"
        strokeWidth="3"
        strokeDasharray="6 6"
      />
      <path d="M20 28h24" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M20 38h14" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

const BooksLibrary = () => {
  const sentinelRef = useRef(null);
  const skipRef = useRef(0);
  const loadingRef = useRef(false);

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [stats, setStats] = useState(deriveStats([]));
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [appliedFilters, setAppliedFilters] = useState({ q: "", tag: "", withPdf: false });

  const { q, tag, withPdf } = appliedFilters;

  useEffect(() => {
    setSearchTerm(q);
  }, [q]);

  const pdfShare = useMemo(() => {
    if (!stats.total) return 0;
    return Math.round((stats.withPdf / stats.total) * 100);
  }, [stats.total, stats.withPdf]);

  const placeholders = useMemo(() => Array.from({ length: 8 }), []);

  const hasFilters = Boolean(q || tag || withPdf);
  const showSkeleton = loading && items.length === 0;
  const showEmptyState = !loading && items.length === 0 && !error;

  const load = useCallback(
    async ({ reset = false } = {}) => {
      if (loadingRef.current) return;

      if (reset) {
        skipRef.current = 0;
        setItems([]);
        setStats(deriveStats([]));
        setError(null);
      }

      loadingRef.current = true;
      setLoading(true);

      try {
        const currentSkip = skipRef.current;
        const params = { limit: PAGE_SIZE, skip: reset ? 0 : currentSkip };
        const trimmedQuery = (q || "").trim();
        if (trimmedQuery) params.q = trimmedQuery;
        if (tag) params.tag = tag;
        if (withPdf) params.withPdf = true;

        const { data } = await api.get("/books/library", { params });
        const newItems = data?.items || [];

        setItems((prev) => {
          const nextItems = reset ? newItems : [...prev, ...newItems];
          setStats(deriveStats(nextItems));
          return nextItems;
        });

        const baseSkip = reset ? 0 : currentSkip;
        const nextSkip = baseSkip + newItems.length;
        skipRef.current = nextSkip;
        setHasMore(newItems.length === PAGE_SIZE);
        setError(null);
      } catch (err) {
        console.error("Failed to load library books", err);
        if (reset) {
          setItems([]);
          setStats(deriveStats([]));
          skipRef.current = 0;
        }
        setHasMore(false);
        setError("We ran into a problem loading the library. Please try again.");
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [q, tag, withPdf]
  );

  useEffect(() => {
    skipRef.current = 0;
    setHasMore(true);
    load({ reset: true });
  }, [load]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const shouldLoad = entries.some((entry) => entry.isIntersecting);
        if (shouldLoad && hasMore && !loadingRef.current) {
          load();
        }
      },
      { rootMargin: "280px 0px 280px 0px" }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, load]);

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    const trimmed = searchTerm.trim();
    setAppliedFilters((prev) => {
      if (prev.q === trimmed) return prev;
      return { ...prev, q: trimmed };
    });
  };

  const handleSelectChange = (event) => {
    const value = event.target.value;
    setAppliedFilters((prev) => {
      if (prev.tag === value) return prev;
      return { ...prev, tag: value };
    });
  };

  const handleQuickTag = (value) => {
    setAppliedFilters((prev) => {
      const nextTag = prev.tag === value ? "" : value;
      if (prev.tag === nextTag) return prev;
      return { ...prev, tag: nextTag };
    });
  };

  const handlePdfToggle = (event) => {
    const checked = event.target.checked;
    setAppliedFilters((prev) => {
      if (prev.withPdf === checked) return prev;
      return { ...prev, withPdf: checked };
    });
  };

  const handleClearFilters = useCallback(() => {
    setAppliedFilters((prev) => {
      if (!prev.q && !prev.tag && !prev.withPdf) return prev;
      return { q: "", tag: "", withPdf: false };
    });
    setSearchTerm("");
  }, []);

  const handleRetry = useCallback(() => {
    setHasMore(true);
    load({ reset: items.length === 0 });
  }, [items.length, load]);

  return (
    <AdminPageLayout
      title="Library Catalogue"
      description="Explore and curate digital-ready and physical titles across every department."
    >
        <div className="space-y-8">
          <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-green via-brand-greenDark to-slate-900 text-white shadow-xl">
            <div className="pointer-events-none absolute -left-16 top-10 h-48 w-48 rounded-full bg-white/10 blur-3xl" />
            <div className="pointer-events-none absolute right-6 bottom-0 h-40 w-40 rounded-full bg-brand-gold/30 blur-3xl" />
            <div className="relative z-10 flex flex-col gap-6 px-6 py-10 sm:px-10 lg:px-12">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white/80">
                <span className="inline-flex h-2 w-2 rounded-full bg-brand-gold" /> Curated catalogue
              </div>
              <div className="max-w-3xl space-y-3">
                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl lg:text-[2.75rem]">
                  Explore the LibReport library experience
                </h1>
                <p className="text-sm text-white/80 sm:text-base">
                  Surface new arrivals, spotlight hidden gems, and share digital-ready titles across every department. Fine-tune your view with rich filters to curate the perfect reading list for your community.
                </p>
                {q && (
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/60">
                    Active search · “{q}”
                  </p>
                )}
              </div>
              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="flex flex-col gap-3 rounded-2xl bg-white/10 p-4 backdrop-blur">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white">
                    <IconStackedBooks className="h-5 w-5" />
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-[0.25em] text-white/70">
                      Titles in view
                    </dt>
                    <dd className="mt-1 text-2xl font-semibold">{formatCount(stats.total)}</dd>
                    <p className="text-xs text-white/70">Loaded from the latest catalogue sync.</p>
                  </div>
                </div>
                <div className="flex flex-col gap-3 rounded-2xl bg-white/10 p-4 backdrop-blur">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white">
                    <IconDocument className="h-5 w-5" />
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-[0.25em] text-white/70">
                      PDF ready
                    </dt>
                    <dd className="mt-1 text-2xl font-semibold">
                      {formatCount(stats.withPdf)}
                      <span className="ml-2 text-sm font-medium text-white/70">{stats.total ? `${pdfShare}% of view` : "—"}</span>
                    </dd>
                    <p className="text-xs text-white/70">Digital copies available for instant access.</p>
                  </div>
                </div>
                <div className="flex flex-col gap-3 rounded-2xl bg-white/10 p-4 backdrop-blur">
                  <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white">
                    <IconCompass className="h-5 w-5" />
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-[0.25em] text-white/70">
                      Focus
                    </dt>
                    <dd className="mt-1 text-2xl font-semibold">
                      {tag ? tag : "All departments"}
                    </dd>
                    <p className="text-xs text-white/70">
                      {withPdf ? "Digital-ready highlights" : "Physical & digital collections"}
                    </p>
                  </div>
                </div>
              </dl>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200/70 bg-white/90 p-6 shadow-sm backdrop-blur  ">
            <form onSubmit={handleSearchSubmit} className="flex flex-col gap-4 lg:flex-row lg:items-end">
              <label className="flex-1">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 ">
                  Search collection
                </span>
                <div className="mt-2 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm transition focus-within:border-brand-gold focus-within:ring-2 focus-within:ring-brand-gold  ">
                  <IconSearch className="h-4 w-4 text-slate-400" />
                  <input
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Search by title, author, or ISBN"
                    className="flex-1 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400 "
                  />
                </div>
              </label>

              <label className="lg:w-48">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 ">
                  Department focus
                </span>
                <select
                  value={tag}
                  onChange={handleSelectChange}
                  className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm transition focus:border-brand-gold focus:outline-none focus:ring-2 focus:ring-brand-gold   "
                >
                  <option value="">All departments</option>
                  {DEPARTMENT_TAGS.map((department) => (
                    <option key={department} value={department}>
                      {department}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-600 transition hover:border-brand-gold hover:text-brand-gold   ">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300 text-brand-gold focus:ring-brand-gold"
                    checked={withPdf}
                    onChange={handlePdfToggle}
                  />
                  With PDFs only
                </label>
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-full bg-brand-gold px-5 py-2 text-sm font-semibold uppercase tracking-[0.2em] text-white transition hover:opacity-90"
                >
                  Apply search
                </button>
                <button
                  type="button"
                  onClick={handleClearFilters}
                  disabled={!hasFilters && !searchTerm}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-5 py-2 text-sm font-semibold uppercase tracking-[0.2em] text-slate-500 transition hover:border-brand-gold hover:text-brand-gold disabled:cursor-not-allowed disabled:opacity-50  "
                >
                  Clear
                </button>
              </div>
            </form>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 ">
                Quick focus
              </span>
              {DEPARTMENT_TAGS.map((department) => {
                const isActive = tag === department;
                return (
                  <button
                    key={department}
                    type="button"
                    onClick={() => handleQuickTag(department)}
                    className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] transition ${
                      isActive
                        ? "bg-brand-green text-white shadow-sm"
                        : "border border-slate-200 bg-white text-slate-600 hover:border-brand-gold hover:text-brand-gold   "
                    }`}
                  >
                    {department}
                  </button>
                );
              })}
            </div>

            {hasFilters && (
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400 ">
                  Active filters
                </span>
                {q && (
                  <button
                    type="button"
                    onClick={() => {
                      setAppliedFilters((prev) => ({ ...prev, q: "" }));
                      setSearchTerm("");
                    }}
                    className="group inline-flex items-center gap-2 rounded-full bg-brand-green-soft px-3 py-1 font-semibold text-brand-green transition hover:bg-brand-green hover:text-white"
                  >
                    Search: “{q}” <span className="text-xs font-bold">×</span>
                  </button>
                )}
                {tag && (
                  <button
                    type="button"
                    onClick={() => handleQuickTag(tag)}
                    className="group inline-flex items-center gap-2 rounded-full bg-brand-green-soft px-3 py-1 font-semibold text-brand-green transition hover:bg-brand-green hover:text-white"
                  >
                    {tag} <span className="text-xs font-bold">×</span>
                  </button>
                )}
                {withPdf && (
                  <button
                    type="button"
                    onClick={() => setAppliedFilters((prev) => ({ ...prev, withPdf: false }))}
                    className="group inline-flex items-center gap-2 rounded-full bg-brand-green-soft px-3 py-1 font-semibold text-brand-green transition hover:bg-brand-green hover:text-white"
                  >
                    With PDFs <span className="text-xs font-bold">×</span>
                  </button>
                )}
              </div>
            )}

            {error && (
              <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-rose-200/70 bg-rose-50/80 px-4 py-3 text-sm text-rose-700 shadow-sm   ">
                <span>{error}</span>
                <button
                  type="button"
                  onClick={handleRetry}
                  className="inline-flex items-center gap-2 rounded-full bg-rose-600 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-rose-700"
                >
                  Try again
                </button>
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-slate-200/70 bg-white/90 p-6 shadow-sm backdrop-blur  ">
            {showSkeleton && (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {placeholders.map((_, index) => (
                  <div
                    key={index}
                    className="flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm  "
                  >
                    <div className="aspect-[3/4] animate-pulse bg-slate-200/80 " />
                    <div className="space-y-3 p-4">
                      <div className="h-3 w-3/4 animate-pulse rounded-full bg-slate-200/90 " />
                      <div className="h-3 w-2/3 animate-pulse rounded-full bg-slate-200/80 " />
                      <div className="h-3 w-1/2 animate-pulse rounded-full bg-slate-200/70 " />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!showSkeleton && items.length > 0 && (
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {items.map((book) => {
                  const key = book._id || `${book.title}-${book.bookCode}`;
                  const imageUrl = toMediaUrl(book.imageUrl || book.coverImagePath);
                  const pdfCandidate = toMediaUrl(book.pdfUrl);
                  const pdf = isLikelyFileUrl(pdfCandidate) ? pdfCandidate : null;
                  const author = book.author?.trim() || "Unknown author";
                  const genre = book.genre?.trim();
                  const bookCode = book.bookCode?.trim();

                  return (
                    <article
                      key={key}
                      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-xl  "
                    >
                      <div className="relative">
                        <div className="aspect-[3/4] overflow-hidden bg-slate-100 ">
                          {imageUrl ? (
                            <img
                              src={imageUrl}
                              alt={book.title}
                              className="h-full w-full object-cover transition duration-500 ease-out group-hover:scale-105"
                              loading="lazy"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-sm font-medium text-slate-400 ">
                              No cover available
                            </div>
                          )}
                        </div>
                        {book.department && (
                          <span className="absolute left-3 top-3 inline-flex items-center rounded-full bg-white/90 px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-slate-700 shadow-sm  ">
                            {book.department}
                          </span>
                        )}
                        {book.hasPdf && (
                          <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-brand-green px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-white shadow-sm">
                            <IconDocument className="h-3.5 w-3.5" /> PDF
                          </span>
                        )}
                      </div>
                      <div className="flex flex-1 flex-col gap-3 p-4">
                        <div>
                          <h2 className="text-sm font-semibold text-slate-900 transition group-hover:text-brand-green ">
                            <span className="line-clamp-2">{book.title}</span>
                          </h2>
                          <p className="mt-1 text-xs text-slate-500 ">{author}</p>
                        </div>
                        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 text-[0.7rem] uppercase tracking-[0.2em] text-slate-400 ">
                          <div className="flex flex-wrap items-center gap-2">
                            {genre && <span>{genre}</span>}
                            {bookCode && (
                              <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[0.65rem] font-semibold text-slate-500  ">
                                {bookCode}
                              </span>
                            )}
                          </div>
                          {pdf && (
                            <a
                              href={pdf}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-2 rounded-full bg-brand-green px-3 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.2em] text-white transition hover:bg-brand-greenDark"
                            >
                              <IconDocument className="h-3.5 w-3.5" /> Open PDF
                            </a>
                          )}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {showEmptyState && (
              <div className="flex flex-col items-center justify-center gap-4 rounded-3xl border border-slate-200/70 bg-white/80 px-6 py-12 text-center shadow-sm  ">
                <IconEmptyState className="h-16 w-16 text-slate-300 " />
                <div className="space-y-2">
                  <h3 className="text-lg font-semibold text-slate-900 ">No books found</h3>
                  <p className="text-sm text-slate-500 ">
                    Adjust your filters or reset the search to explore more of the collection.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleClearFilters}
                  className="inline-flex items-center gap-2 rounded-full bg-brand-gold px-5 py-2 text-sm font-semibold uppercase tracking-[0.2em] text-white transition hover:opacity-90"
                >
                  Reset filters
                </button>
              </div>
            )}

            <div ref={sentinelRef} className="h-1" />

            {loading && items.length > 0 && (
              <div className="flex justify-center py-6 text-sm font-medium text-slate-500 ">
                Loading more titles…
              </div>
            )}

            {!loading && !hasMore && items.length > 0 && (
              <div className="flex justify-center py-6 text-sm font-medium text-slate-500 ">
                You have reached the end of the catalogue.
              </div>
            )}
          </section>
        </div>
    </AdminPageLayout>
  );
};

export default BooksLibrary;
