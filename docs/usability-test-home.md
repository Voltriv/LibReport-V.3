# Usability Test Script — Student Home Page

Target page: `/student` (`Frontend/src/student/StudentLanding.jsx`)
Session length: 15–20 minutes per tester
Testers needed: 5 (diminishing returns past 5 for a page this size)

---

## Before the session

**Environment**

```bash
cd ~/Documents/GitHub/LibReport-V.3
npm run dev:fast        # in-memory DB, no Atlas needed
```

Open `http://localhost:3000` in a **fresh incognito window** — a stored token skips the
landing page entirely and invalidates the session.

**Reset between testers**

DevTools → Application → Local Storage → Clear, then hard-reload. Any account a tester
creates lives only in the in-memory DB and disappears when you restart `npm run dev:fast`.

**What to tell the tester**

> This is a library portal for students. I'll give you a few things to try. Think out loud —
> say what you're looking at and what you expect to happen. There are no wrong answers;
> if something is confusing, that's the page's fault, not yours.

Do **not** explain the layout, point at anything, or use the words "catalog", "borrow",
or "account" before the matching task. Those words appear on screen and naming them
pre-loads the answer.

---

## Tasks

Each task lists the `data-testid` that marks completion. Record the **first** element the
tester clicks, not just the last.

### Task 1 — Getting an account

> "You're a new student and you want to start using the library online. Get yourself set up."

- **Success:** reaches `/student/signup`
- **Completion marker:** `home-hero-cta-signup` (hero) or `nav-signup` (header) or
  `home-step-1-action` (step 1) or `home-closing-cta-signup` (bottom)
- **Watch for:** does anyone scroll past the hero looking for a "register" link? Three
  routes lead here — if most testers use the bottom one, the hero CTA isn't reading as a button.

### Task 2 — Finding out what the site does

> "Before signing up — what can you actually do with this portal? Tell me in your own words."

- **Success:** names at least two of: browse/search the catalog, borrow books, track loans
- **Completion marker:** none — this is verbal
- **Watch for:** do they read the "How it works" steps, or the hero paragraph only? If they
  never scroll, the hero copy is carrying the whole page.

### Task 3 — Looking for a book

> "You want to see whether the library has a particular book. Try to find out."

- **Success:** reaches `/student/catalog`, **or** correctly says they need to sign in first
- **Completion marker:** `home-step-2-action`
- **Watch for:** **this is the known stumble.** The catalog requires sign-in. The step is
  tagged "Sign in required", but if a tester clicks through and is surprised by the sign-in
  form, that tag isn't working. Record the surprise — don't rescue them.

### Task 4 — Contacting the library

> "You have a question only a librarian can answer. How would you reach one?"

- **Success:** finds the email or the help-desk location
- **Completion markers:** `home-contact-email`, `home-contact-hours`
- **Watch for:** do they use the "Contact" nav anchor, or scroll manually? An unused anchor
  means the nav isn't being seen.

---

## Observation sheet

One row per tester per task.

| Tester | Task | Time to first click | First element clicked | Completed? | Wrong turns | Quote |
|---|---|---|---|---|---|---|
| | | | | Y / N / gave up | | |

**Also log:**

- **Time to first action** on landing — over ~8 seconds means the page isn't orienting them.
- **Scroll depth** before first click — did they act from the hero alone?
- **Any feature they ask for that isn't there.** This page was deliberately stripped of
  claims the backend can't honour, so anything requested here is a genuine gap rather than
  a broken promise.

---

## Pass / fail thresholds

| Measure | Pass |
|---|---|
| Task 1 completion | 5 / 5 |
| Task 3 completion or correct "must sign in" | 4 / 5 |
| Task 4 completion | 4 / 5 |
| Testers surprised by the catalog sign-in wall | ≤ 1 / 5 |

Failing Task 3 badly points at one fix: a `?next=` return-to redirect so signing in from
the catalog link lands on the catalog rather than the account page. That's deliberately
out of scope for this pass — see the plan file.

---

## Full test ID reference

**Landing page** (10)

```
home-hero-cta-signup      home-step-1-action
home-hero-cta-signin      home-step-2-action
home-how-heading          home-step-3-action
home-contact-hours        home-closing-cta-signup
home-contact-email        home-closing-cta-signin
```

**Header nav — desktop** (5 signed out)

```
nav-home   nav-how   nav-contact   nav-signin   nav-signup
```

**Header nav — mobile** (rendered only when the menu is open)

```
nav-mobile-home   nav-mobile-how   nav-mobile-contact
```

**Signed in** adds `nav-catalog` / `nav-mobile-catalog` and hides `nav-signin` / `nav-signup`.

Verify in the console on `/student`, signed out, desktop width:

```js
document.querySelectorAll('[data-testid]').length   // 15
```
