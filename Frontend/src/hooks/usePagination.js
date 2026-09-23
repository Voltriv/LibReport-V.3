import React from "react";

function normalizePageSize(size) {
  const numeric = Number(size);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 1;
  }
  return Math.floor(numeric);
}

export default function usePagination(sourceItems, pageSize = 10) {
  const items = React.useMemo(
    () => (Array.isArray(sourceItems) ? sourceItems : []),
    [sourceItems]
  );
  const safePageSize = React.useMemo(() => normalizePageSize(pageSize), [pageSize]);
  const [page, setPage] = React.useState(1);

  const totalItems = items.length;

  const pageCount = React.useMemo(() => {
    if (!totalItems) return 1;
    return Math.ceil(totalItems / safePageSize);
  }, [safePageSize, totalItems]);

  const safePage = React.useMemo(() => {
    if (page < 1) return 1;
    if (page > pageCount) return pageCount;
    return page;
  }, [page, pageCount]);

  const startIndex = React.useMemo(() => {
    if (!totalItems) return 0;
    return (safePage - 1) * safePageSize;
  }, [safePage, safePageSize, totalItems]);

  const pageItems = React.useMemo(() => {
    if (!totalItems) return [];
    return items.slice(startIndex, startIndex + safePageSize);
  }, [items, safePageSize, startIndex, totalItems]);

  const showingStart = totalItems ? startIndex + 1 : 0;
  const showingEnd = totalItems ? Math.min(totalItems, startIndex + pageItems.length) : 0;

  const goToPage = React.useCallback(
    (updater) => {
      setPage((prev) => {
        const next = typeof updater === "number" ? updater : updater(prev);
        if (!Number.isFinite(next)) return prev;
        if (next <= 1) return 1;
        if (next >= pageCount) return pageCount;
        return Math.round(next);
      });
    },
    [pageCount]
  );

  const nextPage = React.useCallback(() => goToPage((prev) => prev + 1), [goToPage]);
  const prevPage = React.useCallback(() => goToPage((prev) => prev - 1), [goToPage]);

  React.useEffect(() => {
    setPage((prev) => {
      if (prev < 1) return 1;
      if (prev > pageCount) return pageCount;
      return prev;
    });
  }, [pageCount]);

  React.useEffect(() => {
    setPage(1);
  }, [items, safePageSize]);

  return {
    page: safePage,
    pageCount,
    pageItems,
    showingStart,
    showingEnd,
    totalItems,
    isFirstPage: safePage <= 1,
    isLastPage: safePage >= pageCount,
    setPage: goToPage,
    nextPage,
    prevPage
  };
}
