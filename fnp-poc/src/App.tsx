import { HashRouter, Route, Routes } from "react-router-dom";
import { AssessmentProvider } from "./state/AssessmentContext";
import AppShell from "./components/AppShell";
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
import { seedDemoCases } from "./state/seedCases";
import "./App.css";

// The demo queue is seeded once per browser, before anything reads a case.
seedDemoCases();

export default function App() {
  return (
    <AssessmentProvider>
      <HashRouter>
        <AppShell>
          <Routes>
            <Route path="/" element={<LoginPage />} />
            <Route path="/assessments" element={<AssessmentsPage />} />
            <Route path="/apply/:id" element={<ApplyPage />} />
            <Route path="/apply/:id/review" element={<ReviewPage />} />
            <Route path="/apply/:id/status" element={<StatusPage />} />
            <Route path="/apply/:id/authentication" element={<AuthenticationPage />} />
            <Route path="/apply/:id/result" element={<ResultPage />} />
            <Route path="/reviewer" element={<ReviewerQueuePage />} />
            <Route path="/reviewer/questions" element={<QuestionConfigPage />} />
            <Route
              path="/reviewer/:id/authentication"
              element={<ReviewerAuthenticationPage />}
            />
            <Route path="/reviewer/:id/result" element={<ReviewerResultPage />} />
          </Routes>
        </AppShell>
      </HashRouter>
    </AssessmentProvider>
  );
}
