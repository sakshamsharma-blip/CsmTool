import { useRef, useState, useCallback } from "react";

export function useToast() {
  const [message, setMessage] = useState(null);
  const timer = useRef(null);
  const showToast = useCallback((msg) => {
    setMessage(msg);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 3200);
  }, []);
  return [message, showToast];
}
