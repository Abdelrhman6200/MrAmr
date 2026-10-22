# TaskFlow

Task and project management for an education-content company. It's built around the org chart: instructors, content quality, marketing, operations, customer service and product. Who can see work, assign it and approve it all comes from the reporting hierarchy.

## Quick start

Requires **Node.js 22.9+**.

```bash
npm install
npm run build     # build the web app
npm start         # http://localhost:3001
```

For development, with hot reload for both the API and the UI:

```bash
npm run dev       # UI on http://localhost:5173 (proxies /api to :3001)
```

Locally the app uses a built-in Postgres database ([PGlite](https://pglite.dev)) stored in `./data`, so there is nothing else to install. Put a `DATABASE_URL` in `.env` (see `.env.example`) to use a hosted Postgres database instead.

On first start with an empty database the app loads a demo organisation. **Every demo account uses the password `password123`.** The login screen has one-click buttons for each role. To wipe the local data and reload the demo, run `npm run seed`.

| Role | Email |
| --- | --- |
| Head of Company | ceo@taskflow.local |
| Operations Manager | ops@taskflow.local |
| Head of Content | content.head@taskflow.local |
| Instructor | instructor1@taskflow.local (also 2, 3) |
| Marketing Manager | marketing@taskflow.local |
| Marketing Team | marketing1@taskflow.local, marketing2@taskflow.local |
| Systems Operations Lead | sysops@taskflow.local |
| Content Quality | quality@taskflow.local |
| Ops QC | qc@taskflow.local |
| Head of Customer Service | cs.head@taskflow.local |
| Customer Service | support1@taskflow.local, support2@taskflow.local |
| Product Owner | product@taskflow.local |

## Organisation

```
Head of Company
├── Operations Manager
│   └── Head of Content
│       └── Instructors
├── Marketing Manager
│   └── Marketing team
├── Systems Operations Lead
│   ├── Content Quality
│   └── Ops QC
├── Head of Customer Service
│   └── Customer Service agents
└── Product Owner
```

This is only the demo setup. The real hierarchy is data: the Head of Company or the Operations Manager can add people and change who reports to whom on the **Users** page. The app rejects any change that would create a reporting loop.

## Features

- **Dashboard**: your open, overdue and blocked work, a review queue, "waiting on others", team workload for managers, and recent activity.
- **Tasks**: a Kanban board (drag cards between columns) or a list view. You can filter by scope (mine, created, to review, my team), status, priority, type, project, assignee and due date. Filters are kept in the URL, so you can share a filtered view.
- **Task details**: inline editing, a checklist, comments, an activity log, tags, estimates and due dates.
- **Review / QA workflow**: give a task a reviewer (for example Content Quality on an instructor's lesson). The assignee moves it to *In Review*. Only the reviewer, or someone above the reviewer, can **Approve** it (the task becomes Done) or **Request changes** (the task goes back to In Progress with the feedback). Nobody can skip the review and mark the task done directly.
- **Projects**: grouped by department, with owners, members, progress, overdue counts, a board/list/activity view and a status (planning → active → on hold → completed → archived).
- **Calls (Customer Service)**: upload an Excel (`.xlsx`) or CSV sheet of students or customers. The app guesses which columns hold the name, phone and email, recognising English and Arabic headings, and keeps every other column. The Head of Customer Service can split the calls evenly between chosen agents (whoever has the fewest open calls gets theirs first), assign selected rows, or reassign single calls. Agents work through their own **My calls** queue: tap to dial, then log *Reached*, *No answer*, *Call back later* (at a set time), *Not interested* or *Wrong number*, with a note. Each list shows progress per agent and per outcome and can be exported back to CSV with the results.
- **Center sheets**: click any center's name to get a printable one-page weekly timetable with its address and contact person, to hand to the center.
- **Offline centers**: a table of centers (city, address, phone, contact person, number of rooms) and a weekly schedule grid of centers × days, starting on Saturday.
  - *Collecting availability*: the Head of Company, Operations Manager or Head of Content sends an availability request (for example "Term 2", with a reply-by date). Every instructor is notified and fills in their weekly time slots, the centers they prefer and the most sessions they want per week. Managers see who has submitted and who hasn't, can send reminders, and can enter availability on an instructor's behalf.
  - *Assigning to centers*: click a cell in the schedule to assign an instructor. The instructor list shows who is available at that time and who prefers that center. Double-booking an instructor is always blocked. Assigning outside their availability, over their weekly maximum, or into a center with no free room shows a warning with an "Assign anyway" option. Instructors are notified and see their own sessions under **My availability & sessions**.
- **Bulk user import**: on the Users page, upload an Excel or CSV sheet of people (name and email, plus optional role, manager email, job title and password). Roles can be written in English or Arabic. People without a password get a generated one, shown once and downloadable as a sign-in sheet to hand out.
- **English and Arabic**: switch language from the top bar, the login screen or your profile. Arabic flips the whole layout right-to-left. The choice is saved to your account.
- **Calendar**: a month view of due dates for you, your team or everything you can see. Double-click a day to create a task due that day.
- **Team**: a collapsible org chart and a by-department directory.
- **Reports**: completion by department, status and priority breakdowns, weekly created-vs-completed throughput, and project health.
- **Notifications**: you're notified when you're assigned a task, when your review is requested, when work is approved or sent back for changes, when someone comments, and when work is completed or blocked.
- Works on phones (collapsible sidebar) and supports dark mode.

## Access rules

These rules are in `server/src/access.js`.

| | Rule |
| --- | --- |
| **See tasks** | The Head of Company sees everything. Everyone else sees tasks where they or anyone in their reporting line is the assignee, creator or reviewer, plus all tasks in projects they own or belong to. Hidden tasks return 404. |
| **Assign tasks** | To yourself, your reporting line, members of the task's project, or **any manager**. Managers are included so that, for example, Customer Service can send a bug to the Product Owner. |
| **Edit tasks** | The assignee, creator, reviewer, their managers, or the project owner. |
| **Approve reviews** | The reviewer, their managers, or the Head of Company. |
| **Create projects** | Managers and the Head of Company. |
| **Calls** | Only the Customer Service team and the Head of Company. Agents can upload lists, claim unassigned calls and log their own calls. The Head of Customer Service (or the Head of Company) assigns and reassigns calls to anyone. |
| **Centers** | Everyone can see the centers and the weekly schedule. The Head of Company, Operations Manager and Head of Content manage centers, collect availability and assign instructors. Instructors submit their own availability. |
| **Manage users** | The Head of Company and the Operations Manager. Only the Head of Company can create or edit Head of Company accounts. |

## Project layout

```
api/index.js        Vercel function: serves the whole API
server/src/
  index.js          local/Node server (API + built UI)
  app.js            Express app factory
  access.js         hierarchy-based permission rules
  meta.js           roles, departments, statuses, priorities, task types
  db.js             Postgres schema and connection (hosted Postgres via DATABASE_URL, PGlite otherwise)
  routes/           auth, users, projects, tasks, dashboard/reports, notifications, calls, centers, admin
  mail.js           email (password resets, notification emails)
  seed.js           demo organisation
server/test/        API tests (node:test)
client/src/
  pages/            Dashboard, Tasks, Projects, ProjectDetail, Calendar, Calls, Centers, Team, Reports, Users, Settings
  components/       Layout, TaskDetail, TaskForm, board/list views, UI primitives
  i18n.js           English and Arabic strings
  sheet.js          Excel/CSV reading, column detection, CSV export
```

## Configuration

On Vercel nothing is required except a connected database (see below). Everything else is optional.

| Variable | | |
| --- | --- | --- |
| `DATABASE_URL` / `POSTGRES_URL` | set by Vercel | the Postgres connection string. Vercel fills it in when you connect a database from the **Storage** tab. Locally, without it, the app uses the built-in database in `DATA_DIR` (default `./data`). |
| `APP_TIMEZONE` | `Africa/Cairo` | time zone for "today", overdue and call-backs. |
| `AUTH_SECRET` | generated | signs sign-in sessions. If unset, a random key is generated once and kept in the database. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | optional | creates the first Head of Company account automatically. Without them, the site asks for it on first visit. |
| `DEMO_DATA` | optional | `1` loads the demo company into an empty database on Vercel (locally the demo loads by default). |
| `APP_URL` | optional | public address used for links in emails. On Vercel it defaults to the production domain. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `MAIL_FROM` | optional | an email account to send from. Without `SMTP_HOST` the app works but sends no email. |
| `CRON_SECRET` | optional | protects the daily email retry job (`/api/cron/emails`); Vercel Cron sends it automatically. |
| `DATABASE_CA` | optional | the database's CA certificate, to verify its TLS certificate. Connections are always encrypted. |
| `CORS_ORIGIN` | optional | only if the web app is hosted on a different address from the API. |
| `PORT`, `TRUST_PROXY` | local server | port (default `3001`); set `TRUST_PROXY=1` behind nginx/Caddy. |

## Deploying on Vercel

Everything runs inside one Vercel project: the web app, the API (a serverless function, `api/index.js`) and the database (Vercel's built-in Postgres, provided by Neon, on the free plan).

1. **Import the project:** in Vercel, **Add New → Project** → import this repository. Leave the build settings as they are (`vercel.json` has them) and deploy. The site will say no database is connected yet; that's expected.
2. **Add the database:** open the project → **Storage** → **Create Database** → **Neon** (Serverless Postgres) → pick the region closest to your users → **Create**, and connect it to this project (all environments). Vercel adds the connection settings for you.
3. **Redeploy:** **Deployments** → ⋯ on the latest one → **Redeploy**.
4. **Open the site:** the first visit shows **"Let's set up TaskFlow"**. Enter your name, email and a password to create the Head of Company account. Do this straight after deploying: the page only appears until the first account exists. Then add your team from **Users** (one by one or from a spreadsheet).
   To try things out first, click **✨ Load sample data** on the Users page: it adds a sample team (reporting to you), projects, tasks, call lists and centers. **Remove sample data** takes it all out again and keeps your own work. Sample people can't sign in; reset one's password from Users if you want to see the app as that role.
5. Optional: **Settings → Functions → Function Region**, choose the same region as the database to keep pages fast; and add `SMTP_*` variables for email.

If something isn't set up, the site says what and how to fix it. `…/api/health` answers `{"ok":true}` when the API can reach the database.

Already have a Postgres database elsewhere (Supabase, etc.)? Put its connection string in `DATABASE_URL` instead of step 2. For Supabase use the **Transaction pooler** string (port 6543).

**Backups:** the database keeps its own restore history (see the database's page under Storage). Any time, the Head of Company or Operations Manager can also click **Download backup** on the Users page for a JSON copy of every table.

**Passwords:** people can click **Forgot password?** on the sign-in page to get a one-hour reset link by email, once `SMTP_*` is set. Without email, the Head of Company or Operations Manager opens the person in **Users → Edit → Create password reset link** and sends that link privately (for example on WhatsApp). It works once and lasts 72 hours. Resetting or changing a password signs that person out everywhere else.

**Email notifications:** with email set up, everyone also receives their notifications by email, grouped per person, in their chosen language. Each person can turn this off on their profile page. Emails are sent right after the change that caused them; anything that failed is retried by later activity and by a daily Vercel Cron job.

**Large call sheets** (up to 5,000 rows) are uploaded in parts, so they stay under Vercel's 4.5 MB request limit.

**Security:** passwords are hashed with scrypt. Login is locked for 15 minutes after 8 wrong passwords for an account from the same address. The app sends strict browser security headers (no framing, a content security policy, no MIME sniffing).

## Tests

```bash
npm test
```

Tests use the built-in database. To run them against a real Postgres server too (they empty it first):

```bash
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/taskflow_test node --test --test-concurrency=1 server/test/*.test.js
```
