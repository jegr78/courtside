import { Outlet } from "react-router-dom";
import { AdminNavigation } from "./AdminNavigation";

export function AdminShell() {
  return <div data-testid="admin-shell" className="grid w-full max-w-7xl gap-6 self-start lg:grid-cols-[15rem_1fr] lg:gap-8">
    <div className="lg:sticky lg:top-8 lg:max-h-[calc(100vh-4rem)] lg:overflow-y-auto">
      <AdminNavigation />
    </div>
    <Outlet />
  </div>;
}
