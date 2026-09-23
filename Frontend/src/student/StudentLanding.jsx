import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import heroImage from "../assets/LibReport.png";

const sections = [
  {
    title: "General Collection",
    description: "Core academic titles, theses, and local authors organized for quick browsing across disciplines.",
  },
  {
    title: "Reference & Research",
    description: "Encyclopedias, indexes, and research guides curated by librarians to support in-depth study.",
  },
  {
    title: "Periodicals Lounge",
    description: "A quiet corner stocked with current journals, magazines, and newspapers for daily discovery.",
  },
  {
    title: "Media & Innovation Hub",
    description: "Multimedia resources, viewing stations, and collaborative tables for presentations and creative work.",
  },
];

const services = [
  {
    title: "Reference Assistance",
    details: "Connect with librarians for research consultations, resource recommendations, and citation help.",
  },
  {
    title: "Circulation & Borrowing",
    details: "Borrow print and digital materials, manage holds, and renew items directly from your student account.",
  },
  {
    title: "Orientation & Workshops",
    details: "Join guided tours and skills workshops that introduce collections, databases, and research strategies.",
  },
  {
    title: "Online Request Center",
    details: "Submit recommendations, book study tables, and request scanned chapters through our digital request forms.",
  },
];

const ebooks = [
  {
    title: "LibReport E-Library",
    blurb: "Search the growing catalogue of locally digitized books, theses, and institutional publications.",
  },
  {
    title: "Partner Platforms",
    blurb: "Access licensed collections through our partner universities and national library subscriptions.",
  },
  {
    title: "Download & Read Anywhere",
    blurb: "Borrow PDFs for limited-time offline use and sync highlights across your devices.",
  },
];

const howItWorks = [
  {
    title: "Create your student account",
    description: "Register with your campus email and validated ID (03-0000-00000) to unlock borrowing and digital downloads.",
    action: { label: "Student Sign Up", to: "/student/signup" },
  },
  {
    title: "Explore the catalog",
    description: "Search by title, author, department tags, or availability. Save favourites and request holds in advance.",
    action: { label: "Open Catalog", to: "/student/catalog" },
  },
  {
    title: "Manage visits & loans",
    description: "Track requests, renew borrowed materials, and log campus visits directly from the portal dashboard.",
    action: { label: "Go to My Account", to: "/student/account" },
  },
];

const digitalHighlights = [
  {
    title: "Smart recommendations",
    description: "Receive suggestions based on your department, recent searches, and borrowing activity.",
  },
  {
    title: "Unified requests",
    description: "Place holds, renew items, and book consultations without juggling multiple forms.",
  },
  {
    title: "Visit planning",
    description: "Log entry schedules and notify the librarian team before you arrive on campus.",
  },
];

const supportChannels = [
  {
    icon: "Chat",
    title: "Ask a Librarian",
    description: "Weekday live chat from 8:00 AM to 5:00 PM for research questions and borrowing concerns.",
    contact: "Messenger: @LibReportLibrary",
  },
  {
    icon: "Email",
    title: "Email & Tickets",
    description: "Send detailed requests or attach syllabi so our team can prepare resources before your visit.",
    contact: "library@phinmaed.com",
  },
  {
    icon: "Desk",
    title: "On-campus Help Desk",
    description: "Visit the circulation desk for ID validation, loan pickups, and technical assistance.",
    contact: "Ground Floor - Learning Resource Center",
  },
];

const StudentLanding = () => {
  const location = useLocation();
  const navigate = useNavigate();

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
    <div className="bg-slate-50 text-slate-900">
      <section id="home" className="relative overflow-hidden">
        <div className="absolute inset-0">
          <img
            src={heroImage}
            alt="Library interior"
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-br from-slate-900/80 via-slate-900/70 to-slate-900/80" />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900/20 via-transparent to-slate-900/20" />
        <div className="relative mx-auto flex max-w-6xl flex-col items-center gap-8 px-4 py-32 text-center text-white lg:py-40">

          <span className="btn-pill-sm bg-white/20 backdrop-blur-sm text-white/90 border border-white/20">
            Welcome to the LibReport Student Portal
          </span>
          <h1 className="text-4xl font-bold leading-tight sm:text-5xl lg:text-6xl bg-gradient-to-r from-white via-white to-white/90 bg-clip-text text-transparent">
            Discover resources, services, and spaces that power your learning.
          </h1>
          <p className="max-w-3xl text-lg text-white/90 sm:text-xl leading-relaxed">
            Explore the library, access digital collections, and manage your visits in one connected experience designed for
            students of every program.
          </p>
          <div className="flex flex-col gap-4 sm:flex-row sm:gap-6">

            <Link to="/student/catalog" className="btn-student-primary btn-pill-sm text-lg px-8 py-4 shadow-xl hover:shadow-2xl transition-all duration-300 hover:scale-105">
              Explore Catalog
            </Link>
            <Link to="/student/signup" className="btn-student-inverse btn-pill-sm text-lg px-8 py-4 shadow-xl hover:shadow-2xl transition-all duration-300 hover:scale-105">
              Create Student Account
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16">
        <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
          <div>
            <span className="btn-pill-sm bg-brand-green-soft text-brand-green">Get started in minutes</span>
            <h2 className="mt-4 text-3xl font-semibold text-slate-900">Build your study routine in three steps</h2>
            <p className="mt-3 text-base text-slate-600">
              From creating your profile to checking out ebooks, the LibReport portal keeps every touchpoint in sync so you can
              focus on your coursework.
            </p>
            <div className="mt-8 space-y-6">
              {howItWorks.map((item, index) => (
                <div
                  key={item.title}
                  className="group rounded-3xl border border-slate-200/60 bg-white/95 backdrop-blur-sm p-6 shadow-sm transition-all duration-300 hover:-translate-y-2 hover:shadow-xl hover:border-brand-green/20"
                >
                  <div className="flex items-start gap-6">
                    <div className="relative">
                      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-green to-brand-greenDark text-sm font-bold text-white shadow-lg">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div className="absolute -inset-1 rounded-2xl bg-gradient-to-br from-brand-green to-brand-greenDark opacity-0 blur transition-opacity duration-300 group-hover:opacity-20"></div>
                    </div>
                    <div className="space-y-3 flex-1">
                      <h3 className="text-xl font-bold text-slate-900">{item.title}</h3>
                      <p className="text-slate-600 leading-relaxed">{item.description}</p>
                      {item.action && (
                        <Link to={item.action.to} className="inline-flex items-center gap-2 text-brand-green font-semibold hover:text-brand-greenDark transition-colors">
                          {item.action.label}
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M7 17L17 7"/>
                            <path d="M7 7h10v10"/>
                          </svg>
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-white to-slate-100 p-8 shadow-lg">
            <div className="absolute -top-24 -right-20 h-52 w-52 rounded-full bg-brand-green-soft blur-3xl" aria-hidden="true" />
            <div className="absolute -bottom-24 -left-16 h-56 w-56 rounded-full bg-brand-gold-soft blur-3xl" aria-hidden="true" />
            <div className="relative space-y-4">
              <span className="btn-pill-sm bg-white/60 text-brand-green shadow-sm">What you get</span>
              <h3 className="text-2xl font-semibold text-slate-900">A single dashboard for library life</h3>
              <p className="text-sm text-slate-600">
                Switch between catalog searches, visit requests, and downloads without juggling separate apps or forms.
              </p>
              <ul className="mt-6 space-y-3 text-sm text-slate-600">
                {digitalHighlights.map((item) => (
                  <li key={item.title} className="flex items-start gap-3 rounded-2xl bg-white/90 p-4 shadow-sm ring-1 ring-slate-200">
                    <span className="student-check-icon">âœ“</span>
                    <div>
                      <p className="font-semibold text-slate-900">{item.title}</p>
                      <p className="text-xs text-slate-500">{item.description}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link to="/student/signin" className="btn-student-primary btn-pill-sm">
                  Sign In to Continue
                </Link>
                <Link to="/student/catalog" className="btn-student-outline btn-pill-sm">
                  Browse Titles
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="about" className="mx-auto max-w-5xl space-y-6 px-4 py-16 lg:px-0">
        <h2 className="text-center text-3xl font-semibold text-slate-900">About the Library</h2>
        <p className="text-center text-base text-slate-600">
          The LibReport Student Portal mirrors the on-campus library experience with dedicated spaces for quiet study, collaborative
          projects, and research support. Our librarians curate both physical and digital collections so you can reach essential
          titles anytime, anywhere.
        </p>
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h3 className="text-xl font-semibold text-slate-900">Library Objectives</h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li>â€¢ Foster a culture of independent, critical, and creative thinking.</li>
              <li>â€¢ Sustain a welcoming space for collaborative and individual learning.</li>
              <li>â€¢ Preserve and showcase institutional knowledge and publications.</li>
              <li>â€¢ Support faculty and students with timely research assistance.</li>
            </ul>
          </div>
          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h3 className="text-xl font-semibold text-slate-900">Library Service Hours</h3>
            <p className="mt-2 text-sm text-slate-600">
              Monday to Friday Â· 7:30 AM â€“ 6:00 PM
              <br />
              Saturday Â· 8:00 AM â€“ 5:30 PM
              <br />
              Sunday & Holidays Â· Closed
            </p>
            <p className="mt-4 text-sm text-slate-600">
              Visit the <Link to="/student/catalog" className="text-brand-green hover:underline">online catalog</Link> or book a
              research consultation to make the most of your time in the library.
            </p>
          </div>
        </div>
      </section>

      <section id="sections" className="bg-white py-16">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center text-3xl font-semibold text-slate-900">Library Sections</h2>
          <p className="mt-2 text-center text-base text-slate-600">
            Each section is designed to meet a specific study needâ€”from curated reference materials to multimedia creation hubs.
          </p>
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            {sections.map((section, index) => (
              <div
                key={section.title}
                className="group rounded-3xl bg-white/80 backdrop-blur-sm p-8 shadow-sm ring-1 ring-slate-200/60 transition-all duration-300 hover:-translate-y-2 hover:shadow-xl hover:ring-brand-green/20"
              >
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-green-soft to-brand-gold-soft text-brand-green shadow-sm">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-xl font-bold text-slate-900 mb-3">{section.title}</h3>
                    <p className="text-slate-600 leading-relaxed">{section.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="services" className="mx-auto max-w-6xl px-4 py-16">
        <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
          <div>
            <h2 className="text-3xl font-semibold text-slate-900">Library Services</h2>
            <p className="mt-3 text-base text-slate-600">
              Our team is ready to support your learning journeyâ€”from first-year orientation to capstone completion. Connect with us
              on-site or online to get the most out of our services.
            </p>
            <div className="mt-6 grid gap-4">
              {services.map((service) => (
                <div key={service.title} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                  <h3 className="text-lg font-semibold text-slate-900">{service.title}</h3>
                  <p className="mt-2 text-sm text-slate-600">{service.details}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white/70 p-6 text-sm text-slate-600 shadow-inner">
            <h3 className="text-lg font-semibold text-slate-900">Ready to plan your visit?</h3>
            <p className="mt-3">
              Log visits through the LibReport tracker to save time at the lobby, or request a remote consultation with a subject
              specialist. Your student account connects all services seamlessly.
            </p>

            <Link to="/student/signup" className="mt-6 inline-flex justify-center btn-student-primary">

              Sign up now
            </Link>
          </div>
        </div>
      </section>

      <section id="ebooks" className="mx-auto max-w-6xl px-4 py-16">
        <div className="grid gap-8 lg:grid-cols-2 lg:items-center">
          <div>
            <h2 className="text-3xl font-semibold text-slate-900">Ebook Collection</h2>
            <p className="mt-3 text-base text-slate-600">
              Downloadable ebooks complement our print holdings, giving you the flexibility to study wheneverâ€”and whereverâ€”you need
              to. Titles are organized by program with smart recommendations based on your reading history.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-slate-600">
              {ebooks.map((item) => (
                <li key={item.title} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                  <h3 className="text-lg font-semibold text-slate-900">{item.title}</h3>
                  <p className="mt-2 text-sm text-slate-600">{item.blurb}</p>
                </li>
              ))}
            </ul>
          </div>
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-green to-brand-greenDark p-8 text-white shadow-xl">
            <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1491841651911-c44c30c34548?auto=format&fit=crop&w=900&q=80')] bg-cover bg-center opacity-40" />
            <div className="relative space-y-4">
              <h3 className="text-2xl font-semibold">Ready to browse ebooks?</h3>
              <p className="text-sm text-white/90">
                Sign in with your student account to unlock personalized recommendations, saved searches, and offline access.
              </p>

              <Link
                to="/student/catalog"
                className="inline-flex items-center gap-2 rounded-full bg-white/90 px-5 py-2 text-sm font-semibold text-brand-green shadow-sm transition hover:bg-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-white/60"
              >
                <span>View Catalog</span>
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
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section id="support" className="bg-white py-16">
        <div className="mx-auto max-w-6xl px-4">
          <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
            <div>
              <span className="btn-pill-sm bg-brand-green-soft text-brand-green">Support that follows you</span>
              <h2 className="mt-4 text-3xl font-semibold text-slate-900">Weâ€™re here when you need library help</h2>
              <p className="mt-3 text-base text-slate-600">
                Reach out from campus or off-site. Librarians respond quickly whether you prefer chat, email, or in-person
                support.
              </p>
              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                {supportChannels.map((channel) => (
                  <div
                    key={channel.title}
                    className="flex h-full flex-col gap-3 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-1 hover:shadow-md"
                  >
                    <span className="text-2xl" aria-hidden="true">{channel.icon}</span>
                    <div>
                      <h3 className="text-lg font-semibold text-slate-900">{channel.title}</h3>
                      <p className="mt-1 text-sm text-slate-600">{channel.description}</p>
                    </div>
                    <p className="mt-auto text-xs font-semibold uppercase tracking-wide text-brand-green">{channel.contact}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-3xl bg-gradient-to-br from-brand-green to-brand-greenDark p-8 text-white shadow-xl">
              <h3 className="text-2xl font-semibold">Planning an on-campus visit?</h3>
              <p className="mt-3 text-sm text-white/80">
                Bring your validated student ID and confirm your schedule through the tracker so we can prepare the resources you
                need.
              </p>
              <ul className="mt-5 space-y-3 text-sm text-white/85">
                <li className="flex items-start gap-3">
                  <span className="student-check-icon bg-white/20 text-white">âœ“</span>
                  Check in with the circulation desk when you arrive.
                </li>
                <li className="flex items-start gap-3">
                  <span className="student-check-icon bg-white/20 text-white">âœ“</span>
                  Download PDFs ahead of time for blended or remote sessions.
                </li>
                <li className="flex items-start gap-3">
                  <span className="student-check-icon bg-white/20 text-white">âœ“</span>
                  Request specialized materials at least two days before your visit.
                </li>
              </ul>
              <Link to="/student/catalog" className="btn-student-inverse mt-8 w-full justify-center">
                Plan Your Next Visit
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-slate-200 bg-white py-16">
        <div className="mx-auto max-w-4xl space-y-4 px-4 text-center">
          <h2 className="text-2xl font-semibold text-slate-900">Check our Library Catalog</h2>
          <p className="text-sm text-slate-600">
            Sign in with your LibReport student account to search for available titles, place holds, and download digital copies.
          </p>
          <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">

            <Link to="/student/signin" className="btn-student-primary">

              Student Sign In
            </Link>
            <Link
              to="/student/signup"

              className="btn-student-outline"

            >
              Create Account
            </Link>
          </div>

          <div className="mx-auto flex max-w-2xl flex-col gap-3 rounded-2xl bg-slate-50 p-4 text-left text-sm text-slate-600 ring-1 ring-slate-200 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold text-slate-900">Need help getting started?</p>
              <p className="text-xs text-slate-500">Email the librarians at <a className="text-brand-green hover:underline" href="mailto:library@phinmaed.com">library@phinmaed.com</a> or visit the circulation desk.</p>
            </div>
            <Link to="/student/catalog" className="btn-student-primary btn-pill-sm">
              Browse Titles
            </Link>
          </div>

        </div>
      </section>
    </div>
  );
};

export default StudentLanding;

