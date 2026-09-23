import React from "react";
import { Link, useNavigate } from "react-router-dom";
import api, { clearAuthSession, broadcastAuthChange, getStoredUser, setStoredUser } from "../api";

const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const VISITS_PAGE_SIZE = 5;

const StudentAccount = () => {
  const navigate = useNavigate();
  const [profile, setProfile] = React.useState(null);
  const [hours, setHours] = React.useState([]);
  const [loadingProfile, setLoadingProfile] = React.useState(true);
  const [hoursLoading, setHoursLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [editing, setEditing] = React.useState(false);
  const [form, setForm] = React.useState({ fullName: "", department: "" });
  const [savingProfile, setSavingProfile] = React.useState(false);
  const [saveError, setSaveError] = React.useState("");
  const [saveSuccess, setSaveSuccess] = React.useState("");
  const [visits, setVisits] = React.useState([]);
  const [visitLoading, setVisitLoading] = React.useState(false);
  const [visitError, setVisitError] = React.useState("");
  const [visitPage, setVisitPage] = React.useState(1);
  const [visitTotalPages, setVisitTotalPages] = React.useState(1);
  const [visitTotal, setVisitTotal] = React.useState(0);

  const loadProfile = React.useCallback(async () => {
    try {
      setLoadingProfile(true);
      const { data } = await api.get("/student/me");
      setProfile(data);
    } catch (e) {
      const msg = e?.response?.data?.error || "Unable to load your profile.";
      setError(msg);
    } finally {
      setLoadingProfile(false);
    }
  }, []);

  const loadHours = React.useCallback(async () => {
    try {
      const { data } = await api.get("/hours");
      setHours(data?.items || []);
    } catch {
      setHours([]);
    } finally {
      setHoursLoading(false);
    }
  }, []);

  const loadVisits = React.useCallback(
    async (page = 1) => {
      setVisitLoading(true);
      setVisitError("");
      try {
        const { data } = await api.get("/student/visit-history", {
          params: { page, pageSize: VISITS_PAGE_SIZE }
        });
        const items = Array.isArray(data?.visits) ? data.visits : [];
        setVisits(items);
        setVisitPage(data?.page || page);
        setVisitTotalPages(Math.max(1, data?.totalPages || 1));
        setVisitTotal(data?.total ?? items.length);
      } catch (err) {
        const msg = err?.response?.data?.error || "Failed to load visit history. Please try again.";
        setVisitError(msg);
        setVisits([]);
      } finally {
        setVisitLoading(false);
      }
    },
    []
  );

  React.useEffect(() => {
    loadProfile();
    loadHours();
  }, [loadProfile, loadHours]);

  React.useEffect(() => {
    if (profile) {
      setForm({
        fullName: profile.fullName || "",
        department: profile.department || "",
      });
    }
  }, [profile]);

  React.useEffect(() => {
    if (profile) {
      loadVisits(1);
    }
  }, [profile, loadVisits]);

  React.useEffect(() => {
    if (editing) {
      setSaveSuccess("");
    }
  }, [editing]);

  const formatDateTime = React.useCallback((value) => {
    if (!value) return "--";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "--";
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit"
    });
  }, []);

  const formatVisitDuration = React.useCallback((minutes, isActive) => {
    if (isActive) return "Still in progress";
    if (!Number.isFinite(minutes)) return "--";
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (mins === 0) return `${hours} hr${hours > 1 ? "s" : ""}`;
    return `${hours} hr${hours > 1 ? "s" : ""} ${mins} min`;
  }, []);

  const handleVisitPageChange = React.useCallback(
    (nextPage) => {
      if (visitLoading) return;
      if (nextPage < 1 || nextPage > visitTotalPages) return;
      loadVisits(nextPage);
    },
    [loadVisits, visitLoading, visitTotalPages]
  );

  const visitShowingStart = React.useMemo(
    () => (visitTotal === 0 ? 0 : (visitPage - 1) * VISITS_PAGE_SIZE + 1),
    [visitPage, visitTotal]
  );
  const visitShowingEnd = React.useMemo(
    () =>
      visitTotal === 0
        ? 0
        : Math.min(visitTotal, visitShowingStart + Math.max(visits.length - 1, 0)),
    [visitTotal, visitShowingStart, visits.length]
  );

  const onLogout = () => {

    clearAuthSession();
    broadcastAuthChange();

    navigate("/student/signin", { replace: true });
  };

  const startEditing = () => {
    if (!profile) return;
    setForm({
      fullName: profile.fullName || "",
      department: profile.department || "",
    });
    setSaveError("");
    setSaveSuccess("");
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setSaveError("");
    setSavingProfile(false);
    if (profile) {
      setForm({
        fullName: profile.fullName || "",
        department: profile.department || "",
      });
    }
  };

  const handleFieldChange = (field) => (event) => {
    const { value } = event.target;
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const onSaveProfile = async (event) => {
    event.preventDefault();
    if (!profile) return;

    const trimmedName = form.fullName.trim();
    const trimmedDepartment = form.department.trim();
    const payload = {};

    if (trimmedName !== (profile.fullName || "").trim()) {
      payload.fullName = trimmedName;
    }
    if (trimmedDepartment !== (profile.department || "").trim()) {
      payload.department = trimmedDepartment;
    }

    if (!Object.keys(payload).length) {
      setSaveError("No changes to save.");
      return;
    }

    setSavingProfile(true);
    setSaveError("");

    try {
      const { data } = await api.patch("/student/me", payload);
      setProfile(data);
      setSaveSuccess("Profile updated successfully.");
      setEditing(false);

      const stored = getStoredUser();
      if (stored) {
        setStoredUser({
          ...stored,
          fullName: data.fullName,
          name: data.fullName,
          department: data.department,
        });
      }
    } catch (e) {
      const msg = e?.response?.data?.error || "Unable to update your profile.";
      setSaveError(msg);
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <div className="bg-gradient-to-br from-slate-50 via-white to-slate-100">
      <div className="relative overflow-hidden border-b border-slate-200/60 bg-gradient-to-r from-white via-slate-50 to-white">
        <div className="absolute inset-0 bg-gradient-to-r from-brand-green-soft/10 via-transparent to-brand-gold-soft/10"></div>
        <div className="relative mx-auto flex max-w-5xl flex-col gap-6 px-4 py-16">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-green to-brand-greenDark text-white shadow-lg">
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                <circle cx="12" cy="7" r="4"/>
              </svg>
            </div>
            <div>
              <h1 className="text-4xl font-bold text-slate-900">My Account</h1>
              <p className="text-lg text-slate-600 mt-2">
                Manage your student profile, review library hours, and jump back into the catalog to borrow titles.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-10">
        {error && (
          <div className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{error}</div>
        )}

        <div className="grid gap-8 lg:grid-cols-[2fr_1fr]">
          <section className="rounded-3xl bg-white/95 backdrop-blur-sm p-8 shadow-xl ring-1 ring-slate-200/60">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-green-soft to-brand-gold-soft">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                    <circle cx="12" cy="7" r="4"/>
                  </svg>
                </div>
                <h2 className="text-2xl font-bold text-slate-900">Profile Details</h2>
              </div>
              {!loadingProfile && profile && (
                <div className="flex items-center gap-2">
                  {editing ? (
                    <button
                      type="button"
                      onClick={cancelEditing}
                      disabled={savingProfile}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
                    >
                      Cancel
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={startEditing}
                      className="inline-flex items-center gap-2 rounded-full bg-brand-green px-4 py-2 text-sm font-semibold text-white shadow hover:bg-brand-greenDark transition"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 20h9"/>
                        <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4Z"/>
                      </svg>
                      Edit profile
                    </button>
                  )}
                </div>
              )}
            </div>

            {loadingProfile ? (
              <div className="space-y-4">
                <div className="animate-pulse">
                  <div className="h-4 bg-slate-200 rounded w-1/4 mb-2"></div>
                  <div className="h-6 bg-slate-200 rounded w-3/4"></div>
                </div>
                <div className="animate-pulse">
                  <div className="h-4 bg-slate-200 rounded w-1/4 mb-2"></div>
                  <div className="h-6 bg-slate-200 rounded w-2/3"></div>
                </div>
                <div className="animate-pulse">
                  <div className="h-4 bg-slate-200 rounded w-1/4 mb-2"></div>
                  <div className="h-6 bg-slate-200 rounded w-1/2"></div>
                </div>
              </div>
            ) : profile ? (
              editing ? (
                <form onSubmit={onSaveProfile} className="space-y-6">
                  {saveError && (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{saveError}</div>
                  )}
                  <div className="grid gap-4">
                    <div className="flex items-center justify-between p-4 rounded-2xl bg-gradient-to-r from-brand-green-soft/20 to-brand-gold-soft/20 border border-brand-green/10">
                      <div>
                        <dt className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Student ID</dt>
                        <dd className="text-lg font-bold text-slate-900 mt-1">{profile.studentId || "--"}</dd>
                      </div>
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-green text-white">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
                          <rect width="8" height="4" x="8" y="2" rx="1" ry="1"/>
                        </svg>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/60">
                        <dt className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Full Name</dt>
                        <input
                          type="text"
                          value={form.fullName}
                          onChange={handleFieldChange("fullName")}
                          className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/30"
                          maxLength={120}
                          required
                        />
                      </div>
                      <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/60">
                        <dt className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Status</dt>
                        <dd className="text-lg font-bold text-slate-900 mt-1 capitalize">{profile.status || "--"}</dd>
                      </div>
                      <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/60">
                        <dt className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Department</dt>
                        <input
                          type="text"
                          value={form.department}
                          onChange={handleFieldChange("department")}
                          className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-brand-green focus:outline-none focus:ring-2 focus:ring-brand-green/30"
                          maxLength={120}
                          placeholder="Department or college"
                        />
                      </div>
                    </div>

                    <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/60">
                      <dt className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Email Address</dt>
                      <dd className="text-lg font-bold text-slate-900 mt-1">{profile.email}</dd>
                    </div>
                    
                    <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/60">
                      <dt className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Member Since</dt>
                      <dd className="text-lg font-bold text-slate-900 mt-1">
                        {profile.createdAt ? new Date(profile.createdAt).toLocaleDateString('en-US', { 
                          year: 'numeric', 
                          month: 'long', 
                          day: 'numeric' 
                        }) : "--"}
                      </dd>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="submit"
                      disabled={savingProfile}
                      className="inline-flex items-center gap-2 rounded-full bg-brand-green px-5 py-2 text-sm font-semibold text-white shadow hover:bg-brand-greenDark transition disabled:opacity-60"
                    >
                      {savingProfile ? "Saving..." : "Save changes"}
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-6">
                  {saveSuccess && (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{saveSuccess}</div>
                  )}
                  <div className="grid gap-4">
                    <div className="flex items-center justify-between p-4 rounded-2xl bg-gradient-to-r from-brand-green-soft/20 to-brand-gold-soft/20 border border-brand-green/10">
                      <div>
                        <dt className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Student ID</dt>
                        <dd className="text-lg font-bold text-slate-900 mt-1">{profile.studentId || "--"}</dd>
                      </div>
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-green text-white">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
                          <rect width="8" height="4" x="8" y="2" rx="1" ry="1"/>
                        </svg>
                      </div>
                    </div>
                    
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/60">
                        <dt className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Full Name</dt>
                        <dd className="text-lg font-bold text-slate-900 mt-1">{profile.fullName}</dd>
                      </div>
                      <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/60">
                        <dt className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Status</dt>
                        <dd className="text-lg font-bold text-slate-900 mt-1 capitalize">{profile.status || "--"}</dd>
                      </div>
                      <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/60">
                        <dt className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Department</dt>
                        <dd className="text-lg font-bold text-slate-900 mt-1">{profile.department || "--"}</dd>
                      </div>
                    </div>

                    <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/60">
                      <dt className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Email Address</dt>
                      <dd className="text-lg font-bold text-slate-900 mt-1">{profile.email}</dd>
                    </div>
                    
                    <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/60">
                      <dt className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Member Since</dt>
                      <dd className="text-lg font-bold text-slate-900 mt-1">
                        {profile.createdAt ? new Date(profile.createdAt).toLocaleDateString('en-US', { 
                          year: 'numeric', 
                          month: 'long', 
                          day: 'numeric' 
                        }) : "--"}
                      </dd>
                    </div>
                  </div>
                </div>
              )
            ) : (
              <div className="text-center py-8">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 mx-auto mb-4">
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                </div>
                <p className="text-slate-500">No profile information available.</p>
              </div>
            )}

            <div className="mt-10 rounded-3xl border border-slate-200/70 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/60 px-6 py-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">Recent Visits</h2>
                  <p className="text-sm text-slate-500">Track your logged entries to the library.</p>
                </div>
                <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                  {visitTotal === 0 ? "No visits yet" : `${visitTotal} visit${visitTotal === 1 ? "" : "s"}`}
                </span>
              </div>
              <div className="px-6 py-5">
                {visitLoading ? (
                  <div className="space-y-3">
                    {[0, 1, 2].map((item) => (
                      <div key={item} className="animate-pulse rounded-2xl border border-slate-200/60 bg-slate-50 p-4">
                        <div className="h-4 w-1/3 rounded bg-slate-200"></div>
                        <div className="mt-3 h-3 w-2/3 rounded bg-slate-200"></div>
                      </div>
                    ))}
                  </div>
                ) : visitError ? (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{visitError}</div>
                ) : visits.length > 0 ? (
                  <div className="divide-y divide-slate-200">
                    {visits.map((visit) => {
                      const enteredLabel = formatDateTime(visit.enteredAt);
                      const exitedLabel = visit.exitedAt ? formatDateTime(visit.exitedAt) : visit.isActive ? "In progress" : "--";
                      const durationLabel = formatVisitDuration(visit.durationMinutes, visit.isActive);
                      return (
                        <div key={visit.id} className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-green-soft text-brand-green">
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M21 10a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                                  <path d="M12 8v4l2.5 1.5" />
                                </svg>
                              </div>
                              <div>
                                <div className="text-sm font-semibold text-slate-900">{enteredLabel}</div>
                                <div className="text-xs font-medium text-slate-500">Branch: {visit.branch || "Main"}</div>
                              </div>
                            </div>
                            <span
                              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${
                                visit.isActive ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                              }`}
                            >
                              {durationLabel}
                            </span>
                          </div>
                          <div className="grid gap-3 text-xs text-slate-600 sm:grid-cols-2">
                            <div>
                              <span className="font-semibold text-slate-700">Check-in:</span> {enteredLabel}
                            </div>
                            <div>
                              <span className="font-semibold text-slate-700">Check-out:</span> {exitedLabel}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100">
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
                        <path d="M21 10a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
                        <path d="M12 8v4l2.5 1.5" />
                      </svg>
                    </div>
                    <p className="text-sm text-slate-500">You have not logged any visits yet.</p>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/60 px-6 py-3 text-sm text-slate-500">
                <div>
                  {visitTotal > 0 ? (
                    <>
                      Showing{" "}
                      <span className="font-semibold text-slate-700">{visitShowingStart}</span>-
                      <span className="font-semibold text-slate-700">{visitShowingEnd}</span> of{" "}
                      <span className="font-semibold text-slate-700">{visitTotal}</span> visits
                    </>
                  ) : (
                    <>No visits to display</>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleVisitPageChange(visitPage - 1)}
                    disabled={visitLoading || visitPage <= 1}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m15 18-6-6 6-6" />
                    </svg>
                    Prev
                  </button>
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Page <span className="text-slate-700">{visitPage}</span> of{" "}
                    <span className="text-slate-700">{visitTotalPages}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => handleVisitPageChange(visitPage + 1)}
                    disabled={visitLoading || visitPage >= visitTotalPages}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 font-semibold text-slate-600 transition hover:border-slate-300 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m9 6 6 6-6 6" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Link to="/student/catalog" className="btn-student-primary px-6 py-3 font-semibold shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-105">
                <span className="flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                  </svg>
                  Go to catalog
                </span>
              </Link>
              <button
                type="button"
                onClick={onLogout}
                className="flex items-center gap-2 rounded-xl border border-red-300/60 px-6 py-3 text-sm font-semibold text-red-600 transition-all duration-200 hover:bg-red-50 hover:shadow-md hover:scale-105"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                  <polyline points="16,17 21,12 16,7"/>
                  <line x1="21" y1="12" x2="9" y2="12"/>
                </svg>
                Sign out
              </button>
            </div>
          </section>

          <aside className="rounded-3xl bg-white/95 backdrop-blur-sm p-8 shadow-xl ring-1 ring-slate-200/60">
            <div className="flex items-center gap-3 mb-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-green-soft to-brand-gold-soft">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12,6 12,12 16,14"/>
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-slate-900">Library Hours</h2>
            </div>
            
            {hoursLoading ? (
              <div className="space-y-3">
                <div className="animate-pulse">
                  <div className="h-4 bg-slate-200 rounded w-3/4 mb-2"></div>
                  <div className="h-4 bg-slate-200 rounded w-1/2"></div>
                </div>
                <div className="animate-pulse">
                  <div className="h-4 bg-slate-200 rounded w-2/3 mb-2"></div>
                  <div className="h-4 bg-slate-200 rounded w-1/3"></div>
                </div>
              </div>
            ) : hours.length > 0 ? (
              <div className="space-y-3">
                {hours.map((row) => (
                  <div key={`${row.dayOfWeek}-${row.open}-${row.close}`} className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200/60">
                    <span className="font-semibold text-slate-700">{dayNames[row.dayOfWeek] || `Day ${row.dayOfWeek}`}</span>
                    <span className="text-sm font-medium text-slate-600 bg-white px-3 py-1 rounded-lg border border-slate-200">
                      {row.open} – {row.close}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100 mx-auto mb-3">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12,6 12,12 16,14"/>
                  </svg>
                </div>
                <p className="text-slate-500 text-sm">No posted hours yet. Please check back soon.</p>
              </div>
            )}
            
            <div className="mt-6 p-4 rounded-xl bg-gradient-to-r from-brand-green-soft/20 to-brand-gold-soft/20 border border-brand-green/10">
              <p className="text-xs text-slate-600 leading-relaxed">
                <span className="font-semibold text-slate-700">Need assistance outside library hours?</span><br/>
                Email <a href="mailto:librarian@university.edu" className="font-semibold text-brand-greenDark underline decoration-brand-green/40 decoration-2 underline-offset-4 hover:text-brand-gold">librarian@university.edu</a> and our team will follow up on the next business day.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default StudentAccount;
