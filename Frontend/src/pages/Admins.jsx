import React, { useCallback, useEffect, useState } from "react";
import AdminPageLayout from "../components/AdminPageLayout";
import api, { getStoredUser } from "../api";

const STUDENT_ID_PATTERN = /^\d{2}-\d{4}-\d{6}$/;

function formatStudentId(raw) {
  const digits = String(raw || "").replace(/\D/g, "").slice(0, 12);
  const part1 = digits.slice(0, 2);
  const part2 = digits.slice(2, 6);
  const part3 = digits.slice(6, 12);
  return [part1, part2, part3].filter(Boolean).join("-");
}

const Admins = () => {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState({
    adminId: "",
    fullName: "",
    email: "",
    password: "",
    role: "librarian_staff",
  });

  const role = getStoredUser()?.role;

  const load = useCallback(async () => {
    if (role === "librarian_staff") return;
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/admins", { params: { q } });
      setItems(data || []);
    } catch (e) {
      setError("Failed to load admins");
    } finally {
      setLoading(false);
    }
  }, [q, role]);

  useEffect(() => {
    load();
  }, [load]);

  const onCreate = async (event) => {
    event.preventDefault();
    setError("");
    const adminId = formatStudentId(creating.adminId);
    if (!STUDENT_ID_PATTERN.test(adminId)) {
      setError("Admin ID must match 00-0000-000000");
      return;
    }
    try {
      await api.post("/admins", { ...creating, adminId });
      setCreating({ adminId: "", fullName: "", email: "", password: "", role: "librarian_staff" });
      load();
    } catch (eventError) {
      setError(eventError?.response?.data?.error || "Create failed");
    }
  };

  const onDelete = async (id) => {
    if (!window.confirm("Delete this admin?")) return;
    try {
      await api.delete(`/admins/${id}`);
      load();
    } catch {
      /* noop */
    }
  };

  const headerActions = (
    <button
      type="button"
      onClick={load}
      className="inline-flex items-center gap-2 rounded-xl bg-slate-100 [[data-theme=dark]_&]:bg-stone-800 text-slate-700 [[data-theme=dark]_&]:text-stone-300 px-4 py-2 hover:bg-slate-200 [[data-theme=dark]_&]:hover:bg-stone-700 transition-colors duration-200"
    >
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
      </svg>
      {loading ? "Refreshing..." : "Refresh"}
    </button>
  );

  // Inline guard: show friendly message if librarian_staff somehow lands here
  if (role === "librarian_staff") {
    return (
      <AdminPageLayout
        title="Admins"
        description="Manage administrator accounts and permissions"
        actions={headerActions}
      >
        <div className="mt-6 p-6 rounded-xl theme-panel ring-1 ring-slate-200 [[data-theme=dark]_&]:ring-stone-700">
          <p className="text-slate-700 [[data-theme=dark]_&]:text-stone-200">You are not authorized to view this page.</p>
          <a href="/dashboard" className="inline-block mt-4 btn-brand text-white px-4 py-2 rounded-lg">
            Go to Dashboard
          </a>
        </div>
      </AdminPageLayout>
    );
  }

  return (
    <AdminPageLayout
      title="Admins"
      description="Manage administrator accounts and permissions"
      actions={headerActions}
    >
      <h2 className="mt-6 text-2xl font-semibold text-slate-900 [[data-theme=dark]_&]:text-stone-100">Admins</h2>

      <form
        className="mt-4 grid grid-cols-1 gap-3 rounded-xl theme-panel ring-1 ring-slate-200 [[data-theme=dark]_&]:ring-stone-700 p-4 md:grid-cols-6"
        onSubmit={onCreate}
      >
        <input
          className="rounded-lg border border-slate-300 [[data-theme=dark]_&]:border-stone-600 theme-panel px-3 py-2"
          placeholder="Admin ID"
          value={creating.adminId}
          onChange={(event) =>
            setCreating((state) => ({ ...state, adminId: formatStudentId(event.target.value) }))
          }
          maxLength={14}
          inputMode="numeric"
          required
        />
        <input
          className="rounded-lg border border-slate-300 [[data-theme=dark]_&]:border-stone-600 theme-panel px-3 py-2"
          placeholder="Full Name"
          value={creating.fullName}
          onChange={(event) => setCreating((state) => ({ ...state, fullName: event.target.value }))}
          required
        />
        <input
          className="rounded-lg border border-slate-300 [[data-theme=dark]_&]:border-stone-600 theme-panel px-3 py-2"
          placeholder="Email (optional)"
          value={creating.email}
          onChange={(event) => setCreating((state) => ({ ...state, email: event.target.value }))}
        />
        <input
          type="password"
          className="rounded-lg border border-slate-300 [[data-theme=dark]_&]:border-stone-600 theme-panel px-3 py-2"
          placeholder="Password"
          value={creating.password}
          onChange={(event) => setCreating((state) => ({ ...state, password: event.target.value }))}
          required
        />
        <select
          className="rounded-lg border border-slate-300 [[data-theme=dark]_&]:border-stone-600 theme-panel px-3 py-2"
          value={creating.role}
          onChange={(event) => setCreating((state) => ({ ...state, role: event.target.value }))}
          required
        >
          <option value="librarian">Librarian</option>
          <option value="librarian_staff">Librarian Staffs</option>
        </select>
        <button type="submit" className="rounded-lg btn-brand px-4 py-2 text-white">
          Add
        </button>
        {error ? <div className="md:col-span-6 text-sm text-red-600">{error}</div> : null}
      </form>

      <div className="mt-6 p-4 rounded-xl theme-panel ring-1 ring-slate-200 [[data-theme=dark]_&]:ring-stone-700">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input
            className="rounded-lg border border-slate-300 [[data-theme=dark]_&]:border-stone-600 theme-panel px-3 py-2 flex-1"
            placeholder="Search adminId / name / email"
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />
          <button
            className="rounded-lg px-3 py-2 btn-brand text-white"
            onClick={load}
            disabled={loading}
            type="button"
          >
            {loading ? "Loading..." : "Search"}
          </button>
        </div>
        {items.length === 0 ? (
          <p className="text-sm text-slate-500 [[data-theme=dark]_&]:text-stone-400">No admins found</p>
        ) : (
          <div className="space-y-3">
            {items.map((admin) => (
              <div
                key={admin.id || admin._id || admin.adminId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm [[data-theme=dark]_&]:border-stone-700 [[data-theme=dark]_&]:bg-stone-900"
              >
                <div>
                  <p className="font-semibold text-slate-900 [[data-theme=dark]_&]:text-stone-100">{admin.fullName || admin.adminId}</p>
                  <p className="text-xs text-slate-500 [[data-theme=dark]_&]:text-stone-400">{admin.email || "No email"}</p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="rounded-full bg-brand-green/10 px-3 py-1 font-semibold text-brand-greenDark">
                    {admin.role || "librarian"}
                  </span>
                  <button
                    type="button"
                    className="rounded-lg border border-red-200 px-3 py-1 text-red-600 hover:bg-red-50 [[data-theme=dark]_&]:border-red-900/40 [[data-theme=dark]_&]:hover:bg-red-900/20"
                    onClick={() => onDelete(admin._id || admin.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminPageLayout>
  );
};

export default Admins;
