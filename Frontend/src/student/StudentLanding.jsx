import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import heroImage from "../assets/LibReport.png";

// Each step maps to a shipped backend endpoint. Do not add a step here unless
// the API behind it exists — the landing page is what usability testers judge
// the product on, and advertising unbuilt features corrupts their task data.
const howItWorks = [
  {
    title: "Create your student account",
    description:
      "Register with your campus email and student ID (format 03-0000-00000) to unlock borrowing.",
    action: { label: "Create Account", to: "/student/signup" },
    testId: "home-step-1-action",
    requiresAuth: false,
  },
  {
    title: "Find a book in the catalog",
    description:
      "Search the library's holdings by title, author, or availability, then place a borrow request.",
    action: { label: "Open Catalog", to: "/student/catalog" },
    testId: "home-step-2-action",
    requiresAuth: true,
  },
  {
    title: "Borrow and track your loans",
    description:
      "Follow your requests, see due dates, and renew or return items from your account.",
    action: { label: "Go to My Account", to: "/student/account" },
    testId: "home-step-3-action",
    requiresAuth: true,
  },
];

const ArrowIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 12h14" />
    <path d="m12 5 7 7-7 7" />
  </svg>
);

const StudentLanding = () => {
  const location = useLocation();
  const navigate = useNavigate();

  // StudentLayout navigates here with state.scrollTo when an anchor in the
  // header is clicked from another route.
  React.useEffect(() => {
    const target = location.state?.scrollTo;
    if (!target) return undefined;
    const timeout = window.setTimeout(() => {
      const el = document.getElementById(target);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 120);
    navigate(location.pathname, { replace: true, state: {} });
    return () => window.clearTimeout(timeout);
  }, [location.pathname, location.state, navigate]);

  return (
    <div className="text-slate-900 [[data-theme=dark]_&]:text-gray-100">
      {/* ---------- Hero ---------- */}
      <section id="home" className="relative overflow-hidden">
        <img
          src={heroImage}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-slate-900/70" aria-hidden="true" />

        <div className="relative mx-auto flex max-w-3xl flex-col items-start gap-6 px-4 py-20 text-white lg:py-24">
          <h1 className="text-4xl font-semibold leading-tight sm:text-5xl">
            Your library, online.
          </h1>
          <p className="max-w-xl text-lg text-white/80">
            Browse the catalog, borrow books, and keep track of your loans — all from one
            student account.
          </p>
          <div className="flex flex-wrap items-center gap-6">
            <Link
              to="/student/signup"
              className="btn-student-primary"
              data-testid="home-hero-cta-signup"
            >
              Create Account
            </Link>
            <Link
              to="/student/signin"
              className="inline-flex items-center gap-2 text-sm font-semibold text-white underline-offset-4 hover:underline"
              data-testid="home-hero-cta-signin"
            >
              Sign in
              <ArrowIcon />
            </Link>
          </div>
        </div>
      </section>

      {/* ---------- How it works ---------- */}
      <section id="how" className="mx-auto max-w-4xl px-4 py-16">
        <h2
          className="text-2xl font-semibold text-slate-900 [[data-theme=dark]_&]:text-gray-100"
          data-testid="home-how-heading"
        >
          How it works
        </h2>
        <p className="mt-2 text-base text-slate-600 [[data-theme=dark]_&]:text-gray-400">
          Three steps from sign-up to your first borrowed book.
        </p>

        <ol className="mt-10 space-y-4">
          {howItWorks.map((item, index) => (
            <li
              key={item.title}
              className="rounded-2xl bg-white p-6 ring-1 ring-slate-200 [[data-theme=dark]_&]:bg-gray-800 [[data-theme=dark]_&]:ring-gray-700"
            >
              <div className="flex items-start gap-5">
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-green text-sm font-semibold text-white"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <div className="flex-1 space-y-2">
                  <h3 className="text-lg font-semibold text-slate-900 [[data-theme=dark]_&]:text-gray-100">
                    {item.title}
                  </h3>
                  <p className="text-sm text-slate-600 [[data-theme=dark]_&]:text-gray-400">
                    {item.description}
                  </p>
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <Link
                      to={item.action.to}
                      className="inline-flex items-center gap-2 text-sm font-semibold text-brand-green hover:underline"
                      data-testid={item.testId}
                    >
                      {item.action.label}
                      <ArrowIcon />
                    </Link>
                    {item.requiresAuth && (
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500 [[data-theme=dark]_&]:bg-gray-700 [[data-theme=dark]_&]:text-gray-300">
                        Sign in required
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------- Contact ---------- */}
      <section
        id="contact"
        className="border-t border-slate-200 [[data-theme=dark]_&]:border-gray-800"
      >
        <div className="mx-auto max-w-4xl px-4 py-16">
          <h2 className="text-2xl font-semibold text-slate-900 [[data-theme=dark]_&]:text-gray-100">
            Visit or contact us
          </h2>

          <dl className="mt-8 grid gap-8 sm:grid-cols-3">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 [[data-theme=dark]_&]:text-gray-400">
                Service hours
              </dt>
              <dd
                className="mt-2 space-y-1 text-sm text-slate-600 [[data-theme=dark]_&]:text-gray-300"
                data-testid="home-contact-hours"
              >
                <p>Monday–Friday · 7:30 AM – 6:00 PM</p>
                <p>Saturday · 8:00 AM – 5:30 PM</p>
                <p>Sunday &amp; holidays · Closed</p>
              </dd>
            </div>

            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 [[data-theme=dark]_&]:text-gray-400">
                Email
              </dt>
              <dd className="mt-2 text-sm">
                <a
                  href="mailto:library@phinmaed.com"
                  className="text-brand-green hover:underline"
                  data-testid="home-contact-email"
                >
                  library@phinmaed.com
                </a>
              </dd>
            </div>

            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 [[data-theme=dark]_&]:text-gray-400">
                Help desk
              </dt>
              <dd className="mt-2 text-sm text-slate-600 [[data-theme=dark]_&]:text-gray-300">
                Ground Floor, Learning Resource Center
              </dd>
            </div>
          </dl>
        </div>
      </section>

      {/* ---------- Closing CTA ---------- */}
      <section className="border-t border-slate-200 [[data-theme=dark]_&]:border-gray-800">
        <div className="mx-auto flex max-w-4xl flex-col items-start gap-5 px-4 py-16">
          <h2 className="text-2xl font-semibold text-slate-900 [[data-theme=dark]_&]:text-gray-100">
            Ready to borrow your first book?
          </h2>
          <p className="text-base text-slate-600 [[data-theme=dark]_&]:text-gray-400">
            Create an account with your student ID, or sign in if you already have one.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link
              to="/student/signup"
              className="btn-student-primary"
              data-testid="home-closing-cta-signup"
            >
              Create Account
            </Link>
            <Link
              to="/student/signin"
              className="btn-student-outline"
              data-testid="home-closing-cta-signin"
            >
              Sign In
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
};

export default StudentLanding;
