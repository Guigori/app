import { Navigate } from "react-router-dom";

// Conventional Firebase login replaces the retired passwordless test workflow.
export default function PreviewValidation() {
  return <Navigate to="/login" replace />;
}
