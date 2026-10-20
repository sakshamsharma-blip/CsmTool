import { useState } from "react";

// Client-side paging for long tables. Jumps back to page 1 whenever the list it's given changes length (a
// filter was applied), so nobody lands on an empty page 7 after narrowing things down.
export function usePaged(items, pageSize = 25) {
  const [page, setPage] = useState(1);
  const [seenLength, setSeenLength] = useState(items.length);
  if (items.length !== seenLength) {
    setSeenLength(items.length);
    setPage(1);
  }
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(page, pages);
  return {
    page: current,
    pages,
    setPage,
    pageItems: items.slice((current - 1) * pageSize, current * pageSize),
    total: items.length,
    pageSize,
  };
}
