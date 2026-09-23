import { Link } from "react-router-dom";
import { AlertTriangleIcon } from "./icons";

export default function AssessmentNotFound() {
  return (
    <div className="page">
      <div className="card empty-state">
        <span className="empty-icon">
          <AlertTriangleIcon size={22} />
        </span>
        <h2>Assessment not found</h2>
        <p>This assessment is no longer available, or the link is incorrect.</p>
        <Link className="btn btn-primary" to="/assessments">
          Back to your assessments
        </Link>
      </div>
    </div>
  );
}
