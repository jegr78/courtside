import type { ReactNode } from "react";
import { Alert } from "./Alert";

export function SuccessFeedback({ children, testId }: { children: ReactNode; testId?: string }) {
  return <Alert tone="success" testId={testId}>{children}</Alert>;
}
