import { Link } from "react-router-dom";

export default function OutcomeTabs({
  assessmentId,
  active,
  scoringReady,
}: {
  assessmentId: string;
  active: "authentication" | "scoring";
  scoringReady: boolean;
}) {
  return (
    <nav className="outcome-tabs" aria-label="Assessment reports">
      <Link
        className={`outcome-tab${active === "authentication" ? " is-active" : ""}`}
        to={`/apply/${assessmentId}/authentication`}
      >
        Authentication
      </Link>

      {scoringReady ? (
        <Link
          className={`outcome-tab${active === "scoring" ? " is-active" : ""}`}
          to={`/apply/${assessmentId}/result`}
        >
          Scoring
        </Link>
      ) : (
        <span className="outcome-tab is-disabled" title="Scoring runs once authentication is clean">
          Scoring
        </span>
      )}

      <Link className="outcome-tab-status" to={`/apply/${assessmentId}/status`}>
        Status
      </Link>
    </nav>
  );
}
