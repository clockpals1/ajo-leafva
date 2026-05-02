import React from "react";
import "./App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./AuthContext";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import MemberDashboard from "./pages/MemberDashboard";
import GroupDetail from "./pages/GroupDetail";
import AdminDashboard from "./pages/AdminDashboard";
import AdminGroupDetail from "./pages/AdminGroupDetail";
import Notifications from "./pages/Notifications";
import Profile from "./pages/Profile";
import { Toaster } from "sonner";

function Protected({ children, adminOnly = false }) {
  const { user, loading } = useAuth();
  if (loading || user === null) return <div className="min-h-screen bg-app flex items-center justify-center">Loading...</div>;
  if (!user) return <Navigate to="/login" />;
  if (adminOnly && user.role !== "admin" && user.role !== "super_admin") return <Navigate to="/dashboard" />;
  return children;
}

function HomeRoute() {
  const { user, loading } = useAuth();
  if (loading || user === null) return <Landing />;
  if (!user) return <Landing />;
  return <Navigate to={user.role === "admin" || user.role === "super_admin" ? "/admin" : "/dashboard"} />;
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster position="top-right" />
        <Routes>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/dashboard" element={<Protected><MemberDashboard /></Protected>} />
          <Route path="/groups/:id" element={<Protected><GroupDetail /></Protected>} />
          <Route path="/admin" element={<Protected adminOnly><AdminDashboard /></Protected>} />
          <Route path="/admin/groups/:id" element={<Protected adminOnly><AdminGroupDetail /></Protected>} />
          <Route path="/notifications" element={<Protected><Notifications /></Protected>} />
          <Route path="/profile" element={<Protected><Profile /></Protected>} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
