import { useCallback, useState } from "react";

export function useRetry(): [number, () => void] {
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((current) => current + 1), []);
  return [attempt, retry];
}
