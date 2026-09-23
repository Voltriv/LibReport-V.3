import React from "react";
import { Link, useNavigate } from "react-router-dom";
import api, { persistAuthSession } from "../api";
import { inputClass } from "../designSystem/classes";

const STUDENT_ID_PATTERN = /^\d{2}-\d{4}-\d{6}$/;
const formatStudentId = (value) => {
  const digitsOnly = value.replace(/\D/g, "").slice(0, 12);
  const first = digitsOnly.slice(0, 2);
  const second = digitsOnly.slice(2, 6);
  const third = digitsOnly.slice(6, 12);
  return [first, second, third].filter(Boolean).join("-");
};

const StudentSignIn = () => {
  const navigate = useNavigate();
  const [identifier, setIdentifier] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [identifierTouched, setIdentifierTouched] = React.useState(false);
  const [passwordTouched, setPasswordTouched] = React.useState(false);

  const highlights = React.useMemo(
    () => [
      {
        title: "Reserve books in seconds",
        description: "Place holds on print titles and request study spaces without lining up at the counter.",
      },
      {
        title: "Access digital resources",
        description: "Download PDFs from the ebook collection and keep track of expiring links and due dates.",
      },
      {
        title: "Stay in sync with librarians",
        description: "Receive updates when requests are ready and review your visit history in one dashboard.",
      },
    ],
    []
  );

  const trimmedIdentifier = identifier.trim();
  const identifierError = identifierTouched
    ? !trimmedIdentifier
      ? "Student ID is required."
      : !STUDENT_ID_PATTERN.test(trimmedIdentifier)
      ? "Student ID must match 00-0000-000000."
      : ""
    : "";
  const passwordError = passwordTouched
    ? !password
      ? "Password is required."
      : password.length < 6
      ? "Password must be at least 6 characters."
      : ""
    : "";
  const identifierHelpId = "student-id-help";
  const passwordHelpId = "student-password-help";

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setIdentifierTouched(true);
    setPasswordTouched(true);
    const trimmed = identifier.trim();
    if (!trimmed || !password) {
      setError("Please enter your student ID and password.");
      return;
    }
    if (!STUDENT_ID_PATTERN.test(trimmed)) {
      setError("Student ID must match 00-0000-000000.");
      return;
    }
    try {
      setLoading(true);
      const { data } = await api.post("/auth/login", { studentId: trimmed, password });

      persistAuthSession({ token: data?.token, user: data?.user });

      const role = data?.user?.role;
      if (role === "librarian" || role === "admin") {
        navigate("/dashboard", { replace: true });
      } else {
        navigate("/student/catalog", { replace: true });
      }
    } catch (e) {
      const msg = e?.response?.data?.error || "Unable to sign in. Please try again.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (

    <div className="relative overflow-hidden bg-slate-50 px-4 py-16 sm:py-24">
      <div className="absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-brand-green/15 to-transparent" aria-hidden="true" />
      <div className="relative mx-auto flex max-w-4xl flex-col items-center gap-4 text-center">
        <span className="btn-pill-sm bg-brand-green-soft text-brand-green">LibReport Student Portal</span>
        <h1 className="text-3xl font-semibold text-slate-900 sm:text-4xl">Welcome back!</h1>
        <p className="max-w-2xl text-sm text-slate-600 sm:text-base">
          Sign in with your student ID or registered email to manage requests, download ebooks, and keep track of your library visits.
        </p>
      </div>

      <div className="student-auth-surface relative mx-auto mt-10 w-full max-w-5xl overflow-hidden rounded-3xl bg-white shadow-2xl ring-1 ring-slate-200">
        <div className="grid grid-cols-1 md:grid-cols-2">
          <div className="relative hidden bg-gradient-to-br from-brand-green via-brand-greenDark to-[#183321] md:flex md:flex-col md:justify-between">
            <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1529158062015-cad636e69505?auto=format&fit=crop&w=900&q=80')] bg-cover bg-center opacity-25" />
            <div className="relative flex h-full flex-col justify-between p-10 text-white">
              <div className="space-y-4">
                <span className="btn-pill-sm bg-white/15 text-white/90">Student Access</span>
                <h2 className="text-2xl font-semibold leading-snug">Explore resources curated for every program.</h2>
                <p className="text-sm text-white/80">
                  Borrow print and digital titles, reserve spaces, and connect with librarians who can guide your research.
                </p>
              </div>
              <ul className="space-y-3 text-sm text-white/85">
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-sm font-semibold">✓</span>
                  Instant updates on holds, renewals, and due dates.
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-sm font-semibold">✓</span>
                  Personalized recommendations from the librarian team.
                </li>
                <li className="flex items-start gap-3">
                  <span className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-sm font-semibold">✓</span>
                  Secure access across desktop, tablet, and mobile.
                </li>
              </ul>
            </div>
          </div>
          <div className="p-8 sm:p-10">
            <div>
              <h2 className="text-2xl font-semibold text-slate-900">Student Sign In</h2>
              <p className="mt-1 text-sm text-slate-500">Use your student ID (03-0000-000000).</p>
            </div>

            {error && (
              <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
            )}
            <form className="mt-6 space-y-4" onSubmit={onSubmit}>
              <div>
                <label className="text-sm font-medium text-slate-700">Student ID</label>
                <input
                  value={identifier}
                  onChange={(e) => {
                    if (!identifierTouched) setIdentifierTouched(true);
                    setIdentifier(formatStudentId(e.target.value));
                  }}
                  onBlur={() => setIdentifierTouched(true)}
                  type="text"
                  placeholder="03-0000-000000"
                  inputMode="numeric"
                  maxLength={14}
                  className={`${inputClass("mt-1 font-mono text-slate-900 placeholder-slate-400")} bg-white`}
                  aria-invalid={identifierError ? "true" : "false"}
                  aria-describedby={identifierError ? identifierHelpId : undefined}
                  data-error={identifierError ? "true" : "false"}
                />
                {identifierError && (
                  <p id={identifierHelpId} className="input-feedback error">
                    {identifierError}
                  </p>
                )}
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700">Password</label>
                <input
                  value={password}
                  onChange={(e) => {
                    if (!passwordTouched) setPasswordTouched(true);
                    setPassword(e.target.value);
                  }}
                  onBlur={() => setPasswordTouched(true)}
                  type="password"
                  placeholder="Enter your password"
                  className={inputClass("mt-1 text-slate-900 placeholder-slate-400")}
                  aria-invalid={passwordError ? "true" : "false"}
                  aria-describedby={passwordError ? passwordHelpId : undefined}
                  data-error={passwordError ? "true" : "false"}
                />
                {passwordError && (
                  <p id={passwordHelpId} className="input-feedback error">
                    {passwordError}
                  </p>
                )}
              </div>

              <button type="submit" disabled={loading} className="btn-student-primary w-full">
                {loading ? "Signing in..." : "Sign In"}
              </button>
            </form>

            <div className="mt-8 space-y-4 text-left">
              {highlights.map((item) => (
                <div
                  key={item.title}
                  className="interactive-card flex gap-3 rounded-2xl border border-slate-100 [[data-theme=dark]_&]:border-stone-800 p-3"
                >
                  <span className="student-check-icon">✓</span>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                    <p className="text-xs text-slate-500">{item.description}</p>
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-6 text-center text-sm text-slate-600">
              Need an account? {" "}
              <Link to="/student/signup" className="student-inline-link">

                Sign up now
              </Link>
            </p>
            <p className="mt-2 text-center text-xs text-slate-500">

              Library staff can access the admin dashboard through the {" "}
              <Link to="/signin" className="student-inline-link">
                Librarian Sign-In
              </Link>{" "}
              page.

            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StudentSignIn;
