import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import logo from "../assets/logo.png";
import api, { persistAuthSession } from "../api";

const inputClass =
  "mt-1 w-full rounded-lg border border-slate-300 [[data-theme=dark]_&]:border-stone-600 theme-panel px-3 py-2 text-slate-900 [[data-theme=dark]_&]:text-stone-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-gold focus:border-transparent";

const SignIn = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    try {
      const last = localStorage.getItem("lr_last_admin_id");
      if (last && typeof last === "string") setEmail(last);
    } catch {}
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    try {
      setLoading(true);
      const { data } = await api.post("/auth/login", { studentId: email, password });
      persistAuthSession({ token: data?.token, user: data?.user });
      try {
        localStorage.setItem("lr_last_admin_id", email || "");
      } catch {}
      try {
        localStorage.setItem("lr_user", JSON.stringify(data.user || {}));
      } catch {}
      navigate("/dashboard");
    } catch (err) {
      const status = err?.response?.status;
      const msg = err?.response?.data?.error || "Login failed";
      setError(status === 404 ? "Service temporarily unavailable. Please try again." : msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full theme-shell flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 overflow-hidden rounded-2xl shadow-lg bg-white/90 [[data-theme=dark]_&]:bg-stone-900/70 ring-1 ring-slate-200 [[data-theme=dark]_&]:ring-stone-700">
        <div className="hidden md:flex flex-col items-center justify-center gap-6 p-10 bg-gradient-to-br from-brand-green to-brand-greenDark text-white">
          <img src={logo} alt="University Logo" className="h-24 w-24 rounded-full shadow-md" />
          <h1 className="text-3xl font-semibold tracking-tight">LibReport</h1>
          <p className="text-white/90 text-center max-w-xs">Library tracking, usage, and reporting made simple.</p>
        </div>

        <div className="p-8 sm:p-10">
          <div className="mb-4">
            <button
              type="button"
              onClick={() => navigate("/student")}
              className="inline-flex items-center gap-2 text-sm font-bold text-slate-900 [[data-theme=dark]_&]:text-stone-100 hover:underline"
            >
              Back to student portal
            </button>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-semibold text-slate-900 [[data-theme=dark]_&]:text-stone-100">Sign in to LibReport</h2>
            <p className="text-slate-600 [[data-theme=dark]_&]:text-stone-300 mt-1">Log in to your account</p>
          </div>

          {error && (
            <div className="mb-4 rounded-md border border-red-300 bg-red-50 text-red-700 px-3 py-2 text-sm">{error}</div>
          )}

          <form className="space-y-4" onSubmit={handleLogin}>
            <div>
              <label className="block text-sm font-medium text-slate-700 [[data-theme=dark]_&]:text-stone-200">Admin ID</label>
              <input
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className={inputClass}
                placeholder="Admin ID"
                autoFocus
                autoComplete="username"
              />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="block text-sm font-medium text-slate-700 [[data-theme=dark]_&]:text-stone-200">Password</label>
                <span />
              </div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className={inputClass}
                placeholder="Password"
                autoComplete="current-password"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex justify-center items-center rounded-lg bg-brand-gold text-white font-medium py-2.5 shadow-sm hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition"
            >
              {loading ? "Signing in..." : "Log in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default SignIn;

