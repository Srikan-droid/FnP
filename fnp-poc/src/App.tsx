import { HashRouter, Route, Routes } from "react-router-dom";
import { AssessmentProvider } from "./state/AssessmentContext";
import AppShell from "./components/AppShell";
import LoginPage from "./pages/LoginPage";
import AssessmentsPage from "./pages/AssessmentsPage";
import ApplyPage from "./pages/ApplyPage";
import ReviewPage from "./pages/ReviewPage";
import ProcessingPage from "./pages/ProcessingPage";
import ResultPage from "./pages/ResultPage";
import "./App.css";

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
            <Route path="/apply/:id/processing" element={<ProcessingPage />} />
            <Route path="/apply/:id/result" element={<ResultPage />} />
          </Routes>
        </AppShell>
      </HashRouter>
    </AssessmentProvider>
  );
}
