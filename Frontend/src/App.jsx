import React, { useEffect, Suspense, lazy } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import SignIn from "./pages/SignIn";
import { initTheme, applyTheme } from "./theme";
import { getStoredUser, hasStoredToken } from "./api";

// === Safe Lazy Loader ===
const safeLazy = (importFunc) =>
  lazy(async () => {
    const module = await importFunc();
    if (!module?.default) {
      console.error("Lazy import missing default export:", importFunc.toString());
      return { default: () => <div>Error: Component failed to load</div> };
    }
    return module;
  });

// === Lazy Imports ===
const Dashboard = safeLazy(() => import("./pages/Dashboard"));
const UsageHeatmaps = safeLazy(() => import("./pages/UsageHeatmaps"));
const Tracker = safeLazy(() => import("./pages/Tracker"));
const Attendance = safeLazy(() => import("./pages/Attendance"));
const Reports = safeLazy(() => import("./pages/Reports"));
const UserManagement = safeLazy(() => import("./pages/UserManagement"));
const BooksManagement = safeLazy(() => import("./pages/BooksManagement"));
const BooksLibrary = safeLazy(() => import("./pages/BooksLibrary"));
const Admins = safeLazy(() => import("./pages/Admins"));
const Borrowing = safeLazy(() => import("./pages/Borrowing"));
// === Student Pages ===
const StudentLayout = safeLazy(() => import("./student/StudentLayout"));
const StudentLanding = safeLazy(() => import("./student/StudentLanding"));
const StudentCatalog = safeLazy(() => import("./student/StudentCatalog"));
const StudentSignIn = safeLazy(() => import("./student/StudentSignIn"));
const StudentSignUp = safeLazy(() => import("./student/StudentSignUp"));
const StudentAccount = safeLazy(() => import("./student/StudentAccount"));
const StudentBorrowRequests = safeLazy(() => import("./student/StudentBorrowRequests"));
const StudentOverdueBooks = safeLazy(() => import("./student/StudentOverdueBooks"));
const StudentBorrowingHistory = safeLazy(() => import("./student/StudentBorrowingHistory"));
// === Route Guards ===
function RequireAuth({ children }) {
  if (!hasStoredToken()) return <Navigate to="/signin" replace />;
  const user = getStoredUser();
  if (!user) return <Navigate to="/signin" replace />;
  if (!["librarian", "admin", "librarian_staff"].includes(user.role))
    return <Navigate to="/student/account" replace />;
  return children;
}

function RequireAdmin({ children }) {
  const user = getStoredUser();
  if (!user || !["librarian", "admin", "librarian_staff"].includes(user.role))
    return <Navigate to="/signin" replace />;
  return children;
}

// Only allow librarian or admin (exclude librarian_staff)
function RequireManagers({ children }) {
  const user = getStoredUser();
  if (!user || !["librarian", "admin"].includes(user.role))
    return <Navigate to="/dashboard" replace />;
  return children;
}

function RequireStudent({ children }) {
  if (!hasStoredToken()) return <Navigate to="/student/signin" replace />;
  const user = getStoredUser();
  if (!user || !["student", "librarian", "admin", "librarian_staff"].includes(user.role))
    return <Navigate to="/student/signin" replace />;
  return children;
}

function PublicOnly({ children }) {
  const user = getStoredUser();
  if (["librarian", "admin", "librarian_staff"].includes(user?.role))
    return <Navigate to="/dashboard" replace />;
  if (user?.role === "student") return <Navigate to="/student/account" replace />;
  if (hasStoredToken()) return <Navigate to="/dashboard" replace />;
  return children;
}

function StudentPublicOnly({ children }) {
  const user = getStoredUser();
  if (user?.role === "student") return <Navigate to="/student/account" replace />;
  return children;
}

function DefaultRedirect() {
  const user = getStoredUser();
  if (["librarian", "admin", "librarian_staff"].includes(user?.role))
    return <Navigate to="/dashboard" replace />;
  if (user?.role === "student") return <Navigate to="/student/account" replace />;
  return <Navigate to="/student/signin" replace />;
}

// === Main App ===
function App() {
  // Initialize Theme on Mount
  useEffect(() => {
    initTheme();
  }, []);

  // Expose global theme setter
  useEffect(() => {
    window.__setTheme = (t) => applyTheme(t);
    return () => delete window.__setTheme;
  }, []);

  return (
    <Router>
      <div className="App">
        <Suspense fallback={<div className="p-6 text-slate-600 [[data-theme=dark]_&]:text-slate-300">Loading...</div>}>
          <Routes>
            {/* Default Redirect */}
            <Route path="/" element={<DefaultRedirect />} />

            {/* === Student Routes === */}
            <Route path="/student/*" element={<StudentLayout />}>
              <Route index element={<StudentLanding />} />
              <Route
                path="catalog"
                element={
                  <RequireStudent>
                    <StudentCatalog />
                  </RequireStudent>
                }
              />
              <Route
                path="account"
                element={
                  <RequireStudent>
                    <StudentAccount />
                  </RequireStudent>
                }
              />
              <Route path="borrow-requests" element={<Navigate to="/student/requests" replace />} />
              <Route
                path="requests"
                  element={
                  <RequireStudent>
                    <StudentBorrowRequests />
                  </RequireStudent>
                }
              />
              <Route
                path="overdue-books"
                element={
                  <RequireStudent>
                    <StudentOverdueBooks />
                  </RequireStudent>
                }
              />
              <Route
                path="borrowing-history"
                element={
                  <RequireStudent>
                    <StudentBorrowingHistory />
                  </RequireStudent>
                }
              />
              <Route
                path="signin"
                element={
                  <StudentPublicOnly>
                    <StudentSignIn />
                  </StudentPublicOnly>
                }
              />
              <Route
                path="signup"
                element={
                  <StudentPublicOnly>
                    <StudentSignUp />
                  </StudentPublicOnly>
                }
              />
            </Route>

            {/* === Admin & Librarian Routes === */}
            <Route
              path="/dashboard"
              element={
                <RequireAuth>
                  <RequireAdmin>
                    <Dashboard />
                  </RequireAdmin>
                </RequireAuth>
              }
            />
            <Route
              path="/usage-heatmaps"
              element={
                <RequireAuth>
                  <RequireAdmin>
                    <UsageHeatmaps />
                  </RequireAdmin>
                </RequireAuth>
              }
            />
            <Route
              path="/tracker"
              element={
                <RequireAuth>
                  <RequireAdmin>
                    <Tracker />
                  </RequireAdmin>
                </RequireAuth>
              }
            />
            <Route
              path="/attendance"
              element={
                <RequireAuth>
                  <RequireAdmin>
                    <Attendance />
                  </RequireAdmin>
                </RequireAuth>
              }
            />
            <Route
              path="/reports"
              element={
                <RequireAuth>
                  <RequireAdmin>
                    <Reports />
                  </RequireAdmin>
                </RequireAuth>
              }
            />
            <Route
              path="/borrowing"
              element={
                <RequireAuth>
                  <RequireAdmin>
                    <Borrowing />
                  </RequireAdmin>
                </RequireAuth>
              }
            />
            <Route
              path="/library"
              element={
                <RequireAuth>
                  <RequireAdmin>
                    <BooksLibrary />
                  </RequireAdmin>
                </RequireAuth>
              }
            />
            <Route
              path="/booksmanagement"
              element={
                <RequireAuth>
                  <RequireAdmin>
                    <BooksManagement />
                  </RequireAdmin>
                </RequireAuth>
              }
            />
            <Route
              path="/usermanagement"
              element={
                <RequireAuth>
                  <RequireAdmin>
                    <UserManagement />
                  </RequireAdmin>
                </RequireAuth>
              }
            />
            <Route
              path="/admins"
              element={
                <RequireAuth>
                  <RequireManagers>
                    <Admins />
                  </RequireManagers>
                </RequireAuth>
              }
            />

            {/* === Public Routes === */}
            <Route
              path="/signin"
              element={
                <PublicOnly>
                  <SignIn />
                </PublicOnly>
              }
            />
            <Route path="/forgot" element={<Navigate to="/signin" replace />} />
            <Route path="/reset" element={<Navigate to="/signin" replace />} />

            {/* === Catch All === */}
            <Route path="*" element={<Navigate to="/student/signin" replace />} />
          </Routes>
        </Suspense>
      </div>
    </Router>
  );
}

export default App;
