import { Outlet } from "react-router-dom";
import { AdminNavigation } from "./AdminNavigation";

export function AdminShell() {
  // A page keeps its own height rather than being stretched to the navigation's, which would spread
  // a short page's rows apart; the navigation still fills the row, because sticky needs the travel.
  return <div data-testid="admin-shell" className="grid w-full max-w-7xl gap-6 self-start lg:grid-cols-[15rem_1fr] lg:items-start lg:gap-8">
    <div className="lg:sticky lg:top-8 lg:max-h-[calc(100vh-4rem)] lg:self-stretch lg:overflow-y-auto">
      <AdminNavigation />
    </div>
    <Outlet />
  </div>;
}
