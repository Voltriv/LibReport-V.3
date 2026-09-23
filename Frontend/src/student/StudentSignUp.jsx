import React from "react";
import { Link, useNavigate } from "react-router-dom";

import api, { persistAuthSession } from "../api";

const STUDENT_ID_PATTERN = /^\d{2}-\d{4}-\d{6}$/;
const DEPARTMENTS = ["CAHS", "CITE", "CCJE", "CEA", "CELA", "COL", "SHS"];

function formatStudentId(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 12);
  const part1 = digits.slice(0, 2);
  const part2 = digits.slice(2, 6);
  const part3 = digits.slice(6, 12);
  return [part1, part2, part3].filter(Boolean).join('-');
}

const StudentSignUp = () => {
  const navigate = useNavigate();
  const [form, setForm] = React.useState({
    studentId: "",
    email: "",
    fullName: "",
    department: "",
    password: "",
    confirmPassword: "",
    termsAccepted: false,
  });
  const [errors, setErrors] = React.useState({});
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [showTermsModal, setShowTermsModal] = React.useState(false);

  const onChange = (e) => {
    const { name, value, type, checked } = e.target;
    let nextValue = type === "checkbox" ? checked : value;
    if (name === "studentId") {
      nextValue = formatStudentId(value);
    }
    setForm((prev) => ({ ...prev, [name]: nextValue }));
    if (name === "termsAccepted" && nextValue) {
      setErrors((prev) => {
        if (!prev.termsAccepted) {
          return prev;
        }
        const next = { ...prev };
        delete next.termsAccepted;
        return next;
      });
    }
  };

  const openTermsModal = () => setShowTermsModal(true);
  const closeTermsModal = () => setShowTermsModal(false);

  React.useEffect(() => {
    if (!showTermsModal) return;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setShowTermsModal(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showTermsModal]);

  const validate = () => {
    const nextErrors = {};

    if (!STUDENT_ID_PATTERN.test(form.studentId.trim())) {
      nextErrors.studentId = "Format must be 00-0000-000000";

    }
    if (!form.email.includes("@")) {
      nextErrors.email = "Please enter a valid email";
    }
    if (!/^[A-Za-z .'-]+$/.test(form.fullName.trim())) {
      nextErrors.fullName = "Name may contain letters, spaces, apostrophes, hyphens, and periods";
    }
    if (!form.department.trim()) {
      nextErrors.department = "Please select your department";
    }
    if (form.password.length < 8 || !/[A-Za-z]/.test(form.password) || !/[0-9]/.test(form.password)) {
      nextErrors.password = "Password must be 8+ characters with letters and numbers";
    }
    if (form.password !== form.confirmPassword) {
      nextErrors.confirmPassword = "Passwords do not match";
    }
    if (!form.termsAccepted) {
      nextErrors.termsAccepted = "Please accept the Terms & Conditions to continue";
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!validate()) {
      setError("Please correct the highlighted fields.");
      return;
    }
    try {
      setLoading(true);
      const { termsAccepted, ...payload } = form;
      const { data } = await api.post("/auth/signup", payload);

      persistAuthSession({ token: data?.token, user: data?.user });

      navigate("/student/account", { replace: true });
    } catch (e) {
      const msg = e?.response?.data?.error || "Unable to sign up right now. Please try again.";
      setError(msg);
      if (/studentid/i.test(msg) && /exists|in use|duplicate/i.test(msg)) {
        setErrors((prev) => ({ ...prev, studentId: "Student ID already registered" }));
      }
      if (/email/i.test(msg) && /exists|in use|duplicate/i.test(msg)) {
        setErrors((prev) => ({ ...prev, email: "Email already registered" }));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="flex min-h-[70vh] items-center justify-center bg-slate-50 px-4 py-16">
        <div className="w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-xl ring-1 ring-slate-200">
          <div className="grid grid-cols-1 md:grid-cols-2">

            <div className="relative hidden bg-gradient-to-br from-brand-green via-brand-greenDark to-[#183321] md:flex md:flex-col md:justify-between">
              <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1521587760476-6c12a4b040da?auto=format&fit=crop&w=900&q=80')] bg-cover bg-center opacity-30" />
              <div className="relative flex h-full flex-col justify-between p-10 text-white">
                <div className="space-y-4">
                  <span className="btn-pill-sm bg-white/15 text-white/85">

                    Join the library community
                  </span>
                  <h2 className="mt-4 text-2xl font-semibold">Create your LibReport student account</h2>
                  <p className="mt-3 text-sm text-white/80">
                    Register to save catalog searches, download ebooks, and request services tailored to your program.
                  </p>
                </div>

                <div className="text-xs text-white/75">
                  Already part of the team?{" "}
                  <Link to="/signin" className="student-inline-link text-white">
                    Librarian sign-in
                  </Link>

                </div>
              </div>
            </div>
            <div className="p-8 sm:p-10">
              <h1 className="text-2xl font-semibold text-slate-900">Student Sign Up</h1>
              <p className="mt-1 text-sm text-slate-500">Fill in your details to activate the student portal.</p>
              {error && (
                <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
              )}
              <form className="mt-6 space-y-4" onSubmit={onSubmit}>
              <div>
                <label className="text-sm font-medium text-slate-700">Student ID</label>
                <input
                  name="studentId"
                  value={form.studentId}
                  onChange={onChange}
                  placeholder="00-0000-000000"
                  maxLength={14}
                  inputMode="numeric"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-gold"
                  required
                />
                {errors.studentId && <p className="mt-1 text-xs text-red-600">{errors.studentId}</p>}
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700">Email</label>
                <input
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={onChange}
                  placeholder="library.fvr.up@phinmaed.com"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-gold"
                  required
                />
                {errors.email && <p className="mt-1 text-xs text-red-600">{errors.email}</p>}
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700">Full Name</label>
                <input
                  name="fullName"
                  value={form.fullName}
                  onChange={onChange}
                  placeholder="Your complete name"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-gold"
                  required
                />
                {errors.fullName && <p className="mt-1 text-xs text-red-600">{errors.fullName}</p>}
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700">Department</label>
                <select
                  name="department"
                  value={form.department}
                  onChange={onChange}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-gold"
                  required
                >
                  <option value="">Select your department</option>
                  {DEPARTMENTS.map((dept) => (
                    <option key={dept} value={dept}>
                      {dept}
                    </option>
                  ))}
                </select>
                {errors.department && <p className="mt-1 text-xs text-red-600">{errors.department}</p>}
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700">Password</label>
                <input
                  name="password"
                  type="password"
                  value={form.password}
                  onChange={onChange}
                  placeholder="Minimum 8 characters with letters and numbers"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-gold"
                  required
                />
                {errors.password && <p className="mt-1 text-xs text-red-600">{errors.password}</p>}
              </div>
              <div>
                <label className="text-sm font-medium text-slate-700">Confirm Password</label>
                <input
                  name="confirmPassword"
                  type="password"
                  value={form.confirmPassword}
                  onChange={onChange}
                  placeholder="Re-enter your password"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-gold"
                  required
                />
                {errors.confirmPassword && <p className="mt-1 text-xs text-red-600">{errors.confirmPassword}</p>}
              </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
                  <label className="flex items-start gap-3">
                    <input
                      name="termsAccepted"
                      type="checkbox"
                      checked={form.termsAccepted}
                      onChange={onChange}
                      className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-green focus:ring-brand-gold"
                    />
                    <span className="text-sm text-slate-600">
                      I agree to the{" "}
                      <button type="button" onClick={openTermsModal} className="student-inline-link">
                        Terms &amp; Conditions
                      </button>{" "}
                      and understand how my information will be used.
                    </span>
                  </label>
                  {errors.termsAccepted && <p className="mt-2 text-xs text-red-600">{errors.termsAccepted}</p>}
                </div>

                <button type="submit" disabled={loading || !form.termsAccepted} className="btn-student-primary w-full">

                  {loading ? "Creating account..." : "Sign Up"}
                </button>
              </form>
              <p className="mt-6 text-center text-sm text-slate-600">

                Already have an account?{" "}
                <Link to="/student/signin" className="student-inline-link">
                  Sign in
                </Link>

              </p>
            </div>
          </div>
        </div>
      </div>
      {showTermsModal && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/60 px-4 py-6" onClick={closeTermsModal}>
          <div
            className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={closeTermsModal}
              className="absolute right-4 top-4 rounded-full bg-slate-100 p-2 text-slate-500 transition hover:bg-slate-200 hover:text-slate-700"
              aria-label="Close Terms and Conditions"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
            <h2 className="text-xl font-semibold text-slate-900">LibReport Student Portal Terms &amp; Conditions</h2>
            <p className="mt-3 text-sm text-slate-600">
              By creating an account, you acknowledge that your student information will be used to provide access to LibReport
              services, including catalog reservations, visit tracking, and communication about library resources.
            </p>
            <div className="mt-5 space-y-4 text-sm text-slate-600">
              <section>
                <h3 className="text-sm font-semibold text-slate-800">1. Account Responsibilities</h3>
                <p className="mt-1">
                  You agree to provide accurate details and keep your password confidential. Report any unauthorized access to
                  the library staff immediately so we can secure your account.
                </p>
              </section>
              <section>
                <h3 className="text-sm font-semibold text-slate-800">2. Use of Data</h3>
                <p className="mt-1">
                  LibReport stores your profile and visit activity to help personalize services and streamline check-ins. We do
                  not sell or share your personal data with third parties outside the university library system.
                </p>
              </section>
              <section>
                <h3 className="text-sm font-semibold text-slate-800">3. Appropriate Use</h3>
                <p className="mt-1">
                  You agree to use the portal for academic and library-related purposes only. Misuse of services or attempts to
                  disrupt operations may lead to suspension of access.
                </p>
              </section>
              <section>
                <h3 className="text-sm font-semibold text-slate-800">4. Updates</h3>
                <p className="mt-1">
                  The library may update these terms from time to time. Continued use of the portal after updates means you
                  accept the revised terms.
                </p>
              </section>
            </div>
            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={closeTermsModal}
                className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  setForm((prev) => ({ ...prev, termsAccepted: true }));
                  setErrors((prev) => {
                    if (!prev.termsAccepted) {
                      return prev;
                    }
                    const next = { ...prev };
                    delete next.termsAccepted;
                    return next;
                  });
                  closeTermsModal();
                }}
                className="inline-flex items-center gap-2 rounded-full bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-brand-greenDark"
              >
                Accept &amp; Continue
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default StudentSignUp;
