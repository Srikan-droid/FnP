import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { keys, switchUser, useSession } from "./api/queries";
import { ApiError } from "./api/client";
import { Loading } from "./components/LoadState";
import AppShell from "./components/AppShell";
import Toaster from "./components/Toaster";
import ApplicantRoute from "./components/ApplicantRoute";
import ReviewerRoute from "./components/ReviewerRoute";
import LoginPage from "./pages/LoginPage";
import AssessmentsPage from "./pages/AssessmentsPage";
import ApplyPage from "./pages/ApplyPage";
import ReviewPage from "./pages/ReviewPage";
import StatusPage from "./pages/StatusPage";
import AuthenticationPage from "./pages/AuthenticationPage";
import ResultPage from "./pages/ResultPage";
import ReviewerQueuePage from "./pages/ReviewerQueuePage";
import ReviewerAuthenticationPage from "./pages/ReviewerAuthenticationPage";
import ReviewerResultPage from "./pages/ReviewerResultPage";
import QuestionConfigPage from "./pages/QuestionConfigPage";
import NewAssessmentPage from "./pages/NewAssessmentPage";
import AdminOverviewPage from "./pages/AdminOverviewPage";
import AdminUsersPage from "./pages/AdminUsersPage";
import AdminUserPage from "./pages/AdminUserPage";
import AdminDepartmentsPage from "./pages/AdminDepartmentsPage";
import SuperUserRoute from "./components/SuperUserRoute";
import { ROUTE_PATTERNS } from "./routes";
import "./styles/app.css";

/**
 * The backend answers 401 once the session has ended (it expires after a period without use).
 * Everything cached belonged to that session, so it is dropped, and the route gates send the user
 * to sign in, which tells them why.
 */
function endSessionOn401(error: unknown) {
  if (!(error instanceof ApiError)) return;
  // Refused as not allowed: the session may now belong to someone else (signed in from another
  // tab), so check who is signed in; the route gates then follow.
  if (error.status === 403) queryClient.invalidateQueries({ queryKey: keys.session });
  if (error.status !== 401) return;
  switchUser(queryClient, null);
  queryClient.setQueryData(keys.sessionEnded, true);
}

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: endSessionOn401 }),
  mutationCache: new MutationCache({ onError: endSessionOn401 }),
  defaultOptions: {
    queries: {
      // Data is fresh for a few seconds; switching back to the tab refreshes it.
      staleTime: 5000,
      // A 4xx will not succeed on a retry; a network blip might.
      retry: (count, error) => count < 2 && !(error && "status" in error && Number(error.status) < 500),
    },
  },
});

/** Nothing renders until the session is known, so no page flashes a sign-in redirect. */
function SessionGate({ children }: { children: ReactNode }) {
  const session = useSession();
  return session.isPending ? <Loading /> : children;
}

const applicant = (page: ReactNode) => <ApplicantRoute>{page}</ApplicantRoute>;
const reviewer = (page: ReactNode) => <ReviewerRoute>{page}</ReviewerRoute>;
// The admin panel is the super user's.
const superUser = (page: ReactNode) => <SuperUserRoute>{page}</SuperUserRoute>;

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SessionGate>
          <AppShell>
            <Routes>
              <Route path={ROUTE_PATTERNS.login} element={<LoginPage />} />
              <Route path={ROUTE_PATTERNS.assessments} element={<AssessmentsPage />} />
              <Route
                path={ROUTE_PATTERNS.newApplication}
                element={applicant(<NewAssessmentPage mode="applicant" />)}
              />

              <Route path={ROUTE_PATTERNS.apply} element={applicant(<ApplyPage />)} />
              <Route path={ROUTE_PATTERNS.applyReview} element={applicant(<ReviewPage />)} />
              <Route path={ROUTE_PATTERNS.applyStatus} element={applicant(<StatusPage />)} />
              <Route
                path={ROUTE_PATTERNS.applyAuthentication}
                element={applicant(<AuthenticationPage />)}
              />
              <Route path={ROUTE_PATTERNS.applyResult} element={applicant(<ResultPage />)} />

              <Route path={ROUTE_PATTERNS.reviewer} element={reviewer(<ReviewerQueuePage />)} />
              <Route
                path={ROUTE_PATTERNS.reviewerQuestions}
                element={reviewer(<QuestionConfigPage />)}
              />
              <Route
                path={ROUTE_PATTERNS.reviewerNewAssessment}
                element={reviewer(<NewAssessmentPage mode="reviewer" />)}
              />
              <Route
                path={ROUTE_PATTERNS.reviewerAuthentication}
                element={reviewer(<ReviewerAuthenticationPage />)}
              />
              <Route
                path={ROUTE_PATTERNS.reviewerResult}
                element={reviewer(<ReviewerResultPage />)}
              />
              <Route path={ROUTE_PATTERNS.reviewerAdmin} element={superUser(<AdminOverviewPage />)} />
              <Route path={ROUTE_PATTERNS.reviewerAdminUsers} element={superUser(<AdminUsersPage />)} />
              <Route path={ROUTE_PATTERNS.reviewerAdminUser} element={superUser(<AdminUserPage />)} />
              <Route path={ROUTE_PATTERNS.reviewerAdminDepartments} element={superUser(<AdminDepartmentsPage />)} />
            </Routes>
          </AppShell>
        </SessionGate>
        <Toaster />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
