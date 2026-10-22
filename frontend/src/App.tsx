import { Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { RequireAuth } from "@/components/RequireAuth";
import Login from "@/pages/Login";
import Register from "@/pages/Register";
import { appRoutes } from "@/experiences/app/routes";
import { dashboardRoutes } from "@/experiences/dashboard/routes";

/** Composition root: separate presentations, shared authentication and backend. */
export default function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/cadastro" element={<Register />} />
        <Route element={<RequireAuth />}>
          {dashboardRoutes()}
          {appRoutes()}
        </Route>
      </Routes>
      <Toaster richColors position="bottom-center" offset={{ bottom: "5.5rem" }} />
    </>
  );
}
