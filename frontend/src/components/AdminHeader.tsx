import { useNavigate } from "react-router-dom";
import PageHeader from "./PageHeader";
import { BankIcon, GridIcon, UsersIcon } from "./icons";
import { routes } from "../routes";

type View = "overview" | "users" | "departments";

/**
 * The admin panel's title and its views. The current view's tab is marked; it stays a button so a
 * user's detail page can go back to the list from it.
 */

export default function AdminHeader({ active, sub }: { active: View; sub: string }) {
  const navigate = useNavigate();
  const tab = (key: View, label: string, icon: React.ReactNode, to: string) => (
    <button
      type="button"
      className={`admin-tab${active === key ? " is-active" : ""}`}
      aria-current={active === key ? "page" : undefined}
      onClick={() => navigate(to)}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <>
      <PageHeader title="Admin panel" sub={sub} />
      <nav className="reviewer-tabs admin-tabs" aria-label="Admin panel">
        {tab("overview", "Overview", <GridIcon size={15} />, routes.reviewerAdmin())}
        {tab("users", "Users", <UsersIcon size={15} />, routes.reviewerAdminUsers())}
        {tab("departments", "Departments", <BankIcon size={15} />, routes.reviewerAdminDepartments())}
      </nav>
    </>
  );
}
