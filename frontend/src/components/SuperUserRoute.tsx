import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useSession } from "../api/queries";
import { isSuperUser } from "../state/access";
import { routes } from "../routes";

/**
 * Gate for the admin panel: the super user's. An admin goes to the queue of their departments;
 * anyone else on to the applicant list (which sends a signed-out visitor to sign in). The backend
 * enforces the same rule.
 */
export default function SuperUserRoute({ children }: { children: ReactNode }) {
  const { data: user } = useSession();
  if (user?.role !== "reviewer") return <Navigate to={routes.assessments()} replace />;
  if (!isSuperUser(user)) return <Navigate to={routes.reviewer()} replace />;
  return children;
}
