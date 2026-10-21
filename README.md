# TaskFlow

Task and project management for an education-content company. It's built around the org chart: instructors, content quality, marketing, operations, customer service and product. Who can see work, assign it and approve it all comes from the reporting hierarchy.

## Quick start

Requires **Node.js 22.13+**. The database is Node's built-in SQLite, so there are no native modules to compile.

```bash
npm install
npm run build     # build the web app
npm start         # http://localhost:3001
```

For development, with hot reload for both the API and the UI:

```bash
npm run dev       # UI on http://localhost:5173 (proxies /api to :3001)
```

On first start the app loads a demo organisation. **Every demo account uses the password `password123`.** The login screen has one-click buttons for each role. To wipe the data and reload the demo, run `npm run seed`.

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
server/src/
  index.js          entry point (opens DB, seeds if empty, serves API + built UI)
  app.js            Express app factory
  access.js         hierarchy-based permission rules
  meta.js           roles, departments, statuses, priorities, task types
  db.js             SQLite schema
  routes/           auth, users, projects, tasks, dashboard/reports, notifications, calls, centers
  seed.js           demo organisation
server/test/        API tests (node:test)
client/src/
  pages/            Dashboard, Tasks, Projects, ProjectDetail, Calendar, Calls, Centers, Team, Reports, Users, Settings
  components/       Layout, TaskDetail, TaskForm, board/list views, UI primitives
  pages/Calls.jsx   call lists, sheet upload, agent queue
  pages/Centers.jsx centers, availability collection, weekly center schedule
  i18n.js           English and Arabic strings
  sheet.js          Excel/CSV reading, column detection, CSV export
```

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `3001` | HTTP port |
| `DATA_DIR` | `./data` | where the SQLite database lives |
| `DB_FILE` | `$DATA_DIR/taskflow.db` | database file |
| `AUTH_SECRET` | generated into `$DATA_DIR/.secret` | signs login tokens. **Set this in production.** |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | — | used only on the first start with an empty database. When set, the app creates this one Head of Company account and **no demo data**. When unset, it loads the demo company. |
| `TZ` | system zone | time zone for "today", overdue and call-backs, e.g. `Africa/Cairo` |
| `TRUST_PROXY` | — | set to `1` behind nginx/Caddy/a load balancer so login protection sees real client addresses |

## Deploying

With Docker on any Linux server:

```bash
cp .env.example .env      # fill in ADMIN_EMAIL, ADMIN_PASSWORD and AUTH_SECRET (openssl rand -hex 32)
docker compose up -d      # http://your-server:3001
```

Data lives in the `taskflow-data` volume. Put the app behind HTTPS (for example with Caddy or nginx) before people sign in over the internet, and set `TRUST_PROXY=1` when you do.

Without Docker: install Node.js 22.13+, run `npm ci && npm run build`, then start it with the same environment variables (`ADMIN_EMAIL=… ADMIN_PASSWORD=… AUTH_SECRET=… TZ=Africa/Cairo npm start`) under a process manager such as systemd or pm2.

**Backups:** the Head of Company or Operations Manager can click **Download backup** on the Users page at any time. The file is a complete copy of the database. To restore it, stop the app, replace `taskflow.db` in the data directory with the backup file, and start the app again.

**Security:** passwords are hashed with scrypt. Login is locked for 15 minutes after 8 wrong passwords for an account from the same address. The app sends strict browser security headers (no framing, a content security policy, no MIME sniffing).

## Tests

```bash
npm test
```
