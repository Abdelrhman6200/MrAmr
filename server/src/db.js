// Database access. Everything is Postgres:
//  - with DATABASE_URL (Vercel Postgres/Neon, Supabase…) it uses a real Postgres server via `pg`;
//  - without it (local development, tests) it uses PGlite, Postgres
//    compiled to WebAssembly, stored in DATA_DIR or kept in memory.
//
// Queries are written with `?` placeholders; they are numbered ($1, $2…) here.
// db.all / db.get / db.run run one statement; db.tx(fn) runs fn in a transaction
// and hands it an object with the same methods (nested db.tx calls use savepoints).

const NOW = "to_char(timezone('UTC', now()), 'YYYY-MM-DD HH24:MI:SS')";

// Bump when the schema below changes; startup re-applies it once.
export const SCHEMA_VERSION = 11;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE, -- always stored lower-case
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  title TEXT,
  manager_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  avatar_color TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  language TEXT DEFAULT 'en',
  session_version INTEGER NOT NULL DEFAULT 0, -- bumped on password change: older sign-ins stop working
  email_notifications INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  department TEXT NOT NULL,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'active',
  start_date TEXT,
  due_date TEXT,
  color TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  type TEXT NOT NULL DEFAULT 'general',
  status TEXT NOT NULL DEFAULT 'todo',
  priority TEXT NOT NULL DEFAULT 'medium',
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reporter_id INTEGER NOT NULL REFERENCES users(id),
  reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  start_date TEXT,
  due_date TEXT,
  estimate_hours REAL,
  tags TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW},
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
-- Added in schema 4: the curriculum (general / azhar / baccalaureate), and the
-- week a recurring duties task belongs to (one per person per week).
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS track TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS weekly_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_weekly ON tasks(assignee_id, weekly_key) WHERE weekly_key IS NOT NULL;

-- A manager's version of a task type's standard steps (client/src/sops.js has the built-in ones).
CREATE TABLE IF NOT EXISTS sops (
  type TEXT PRIMARY KEY,
  steps TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);
-- Added in schema 6: each save of an SOP is a new version.
ALTER TABLE sops ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS checklist_items (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);
-- Added in schema 6: an SOP step that must be ticked before the task goes to review or is done.
ALTER TABLE checklist_items ADD COLUMN IF NOT EXISTS required INTEGER NOT NULL DEFAULT 0;

-- Added in schema 7: someone acting for a manager (ينوب عنه) between two dates, inclusive.
CREATE TABLE IF NOT EXISTS delegations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  deputy_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  note TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_delegations_dates ON delegations(ends_on, starts_on);

CREATE TABLE IF NOT EXISTS comments (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS activity (
  id SERIAL PRIMARY KEY,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  detail TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_activity_task ON activity(task_id);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  task_id INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  link TEXT,
  params TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  emailed INTEGER NOT NULL DEFAULT 0, -- 0 pending, 1 handled, 2 being sent
  email_claimed_at TEXT, -- when a sender took it (emailed = 2), so stale claims get retried
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_notifications_emailed ON notifications(emailed);

CREATE TABLE IF NOT EXISTS call_lists (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  source_filename TEXT,
  columns TEXT NOT NULL DEFAULT '[]',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS calls (
  id SERIAL PRIMARY KEY,
  list_id INTEGER NOT NULL REFERENCES call_lists(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  data TEXT NOT NULL DEFAULT '{}',
  assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_called_at TEXT,
  callback_at TEXT,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_calls_list ON calls(list_id);
CREATE INDEX IF NOT EXISTS idx_calls_assignee ON calls(assignee_id, status);

CREATE TABLE IF NOT EXISTS call_logs (
  id SERIAL PRIMARY KEY,
  call_id INTEGER NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL,
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_call_logs_user ON call_logs(user_id, created_at);

CREATE TABLE IF NOT EXISTS centers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT DEFAULT '',
  address TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  contact_name TEXT DEFAULT '',
  capacity INTEGER NOT NULL DEFAULT 1,
  notes TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

CREATE TABLE IF NOT EXISTS availability_rounds (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  starts_on TEXT,
  ends_on TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  notes TEXT DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

-- One submission per instructor per round. slots: [{day, start, end}].
CREATE TABLE IF NOT EXISTS availability (
  id SERIAL PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES availability_rounds(id) ON DELETE CASCADE,
  instructor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slots TEXT NOT NULL DEFAULT '[]',
  center_ids TEXT NOT NULL DEFAULT '[]',
  max_sessions INTEGER,
  notes TEXT DEFAULT '',
  submitted_by INTEGER REFERENCES users(id),
  submitted_at TEXT NOT NULL DEFAULT ${NOW},
  UNIQUE (round_id, instructor_id)
);

-- A recurring weekly session: instructor teaches at a center on a weekday.
CREATE TABLE IF NOT EXISTS center_assignments (
  id SERIAL PRIMARY KEY,
  center_id INTEGER NOT NULL REFERENCES centers(id) ON DELETE CASCADE,
  instructor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  subject TEXT DEFAULT '',
  round_id INTEGER REFERENCES availability_rounds(id) ON DELETE SET NULL,
  starts_on TEXT,
  ends_on TEXT,
  notes TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_assign_instructor ON center_assignments(instructor_id, day);
CREATE INDEX IF NOT EXISTS idx_assign_center ON center_assignments(center_id, day);

CREATE TABLE IF NOT EXISTS password_resets (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT ${NOW}
);

-- Failed sign-ins, shared by every server instance (serverless runs many).
CREATE TABLE IF NOT EXISTS login_failures (
  key TEXT NOT NULL,
  at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_failures ON login_failures(key, at);

-- Small shared counters, e.g. 'org' is bumped whenever users change so every
-- instance knows to rebuild its cached org chart.
CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value BIGINT NOT NULL DEFAULT 0
);

-- Rows created by "Load sample data", so they can be removed again.
CREATE TABLE IF NOT EXISTS sample_rows (
  tbl TEXT NOT NULL,
  row_id INTEGER NOT NULL
);

-- Generated secrets (e.g. the key that signs sign-in sessions when AUTH_SECRET isn't set).
CREATE TABLE IF NOT EXISTS app_secrets (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Added in schema 8 -----------------------------------------------------------

-- Files on a task (kept in the database, so nothing else needs setting up).
CREATE TABLE IF NOT EXISTS attachments (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  data BYTEA NOT NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_attachments_task ON attachments(task_id);

-- A task that repeats (daily, weekly on a weekday, or monthly on a day): each
-- period gets one task, marked with recurring_id and recur_key.
CREATE TABLE IF NOT EXISTS recurring_tasks (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  type TEXT NOT NULL DEFAULT 'general',
  priority TEXT NOT NULL DEFAULT 'medium',
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  assignee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  track TEXT NOT NULL DEFAULT '',
  frequency TEXT NOT NULL,
  weekday INTEGER,
  month_day INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurring_id INTEGER REFERENCES recurring_tasks(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recur_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_recurring ON tasks(recurring_id, recur_key) WHERE recurring_id IS NOT NULL;

-- Students and their marks (homework, exams, quizzes). code: the barcode on their book.
CREATE TABLE IF NOT EXISTS students (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE,
  phone TEXT DEFAULT '',
  parent_phone TEXT DEFAULT '',
  track TEXT NOT NULL DEFAULT '',
  group_name TEXT NOT NULL DEFAULT '',
  center_id INTEGER REFERENCES centers(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS assessments (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'homework',
  track TEXT NOT NULL DEFAULT '',
  group_name TEXT NOT NULL DEFAULT '',
  center_id INTEGER REFERENCES centers(id) ON DELETE SET NULL,
  held_on TEXT,
  max_mark REAL NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE TABLE IF NOT EXISTS marks (
  assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  mark REAL,
  absent INTEGER NOT NULL DEFAULT 0,
  note TEXT DEFAULT '',
  graded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  graded_at TEXT,
  PRIMARY KEY (assessment_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_marks_student ON marks(student_id);

-- People's mobile numbers
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';

-- The weekly summary each manager gets (one per manager per week).
CREATE TABLE IF NOT EXISTS weekly_digests (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week TEXT NOT NULL,
  sent_at TEXT NOT NULL DEFAULT ${NOW},
  PRIMARY KEY (user_id, week)
);

-- Leave: asked for, then approved or turned down by the manager. An approved
-- leave with a deputy also creates the delegation.
CREATE TABLE IF NOT EXISTS leave_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'annual',
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  note TEXT DEFAULT '',
  deputy_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at TEXT,
  decision_note TEXT DEFAULT '',
  delegation_id INTEGER REFERENCES delegations(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_leave_dates ON leave_requests(ends_on, starts_on);

-- Weekly shifts (weekday 0 = Saturday … 6 = Friday), e.g. for Customer Service.
CREATE TABLE IF NOT EXISTS shifts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  UNIQUE (user_id, weekday, start_time)
);

-- Who changed what: people, permissions, SOPs, deputies, leave and handovers.
CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  detail TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

-- Added in schema 9 -----------------------------------------------------------

-- The online platform's numbers, one row per week (week = its Saturday), entered
-- or imported by the Product Owner from the platform's own reports.
CREATE TABLE IF NOT EXISTS platform_stats (
  week TEXT PRIMARY KEY,
  total_users INTEGER,
  new_users INTEGER,
  active_users INTEGER,
  sessions INTEGER,
  avg_session_minutes REAL,
  lessons_completed INTEGER,
  avg_progress REAL,
  exam_attempts INTEGER,
  note TEXT DEFAULT '',
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT ${NOW}
);

-- Each student's progress in a course, from the platform's export (replaced per
-- course on each import).
CREATE TABLE IF NOT EXISTS platform_progress (
  id SERIAL PRIMARY KEY,
  course TEXT NOT NULL,
  student_name TEXT NOT NULL,
  student_code TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  progress REAL,
  lessons_done INTEGER,
  lessons_total INTEGER,
  last_seen TEXT,
  imported_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  imported_at TEXT NOT NULL DEFAULT ${NOW}
);
CREATE INDEX IF NOT EXISTS idx_platform_progress_course ON platform_progress(course);

-- Common mistakes found while grading a homework or exam, for the Head of Academic Material
CREATE TABLE IF NOT EXISTS mistakes (
  id SERIAL PRIMARY KEY,
  assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  question TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  students INTEGER,
  status TEXT NOT NULL DEFAULT 'new',
  response TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT ${NOW},
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mistakes_assessment ON mistakes(assessment_id);
`;

// Turns `?` placeholders into $1, $2 … (ignoring any inside quoted strings).
export function numberPlaceholders(sql) {
  let n = 0;
  let out = '';
  let quoted = false;
  for (const ch of sql) {
    if (ch === "'") quoted = !quoted;
    out += ch === '?' && !quoted ? `$${++n}` : ch;
  }
  return out;
}

// Same interface over any "run one query" function.
function executor(query) {
  const run = async (sql, params = []) => {
    const res = await query(numberPlaceholders(sql), params);
    return { rows: res.rows, rowCount: res.rowCount ?? res.affectedRows ?? 0 };
  };
  return {
    run,
    all: async (sql, params) => (await run(sql, params)).rows,
    get: async (sql, params) => (await run(sql, params)).rows[0],
  };
}

// Wraps a single connection that is inside a transaction.
function txHandle(query, depth) {
  const ex = executor(query);
  return {
    ...ex,
    async tx(fn) {
      const name = `sp${depth}`;
      await query(`SAVEPOINT ${name}`, []);
      try {
        const result = await fn(txHandle(query, depth + 1));
        await query(`RELEASE SAVEPOINT ${name}`, []);
        return result;
      } catch (err) {
        await query(`ROLLBACK TO SAVEPOINT ${name}`, []);
        throw err;
      }
    },
  };
}

// Errors that mean the connection itself is gone (not a problem with the query).
function isDeadConnection(err) {
  if (['57P01', '57P02', '57P03', '08000', '08003', '08006'].includes(err.code)) return true;
  if (['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ECONNREFUSED'].includes(err.code)) return true;
  return /Connection terminated|connection.*(closed|ended)|Client has encountered a connection error|socket hang up/i.test(err.message || '');
}

async function createPostgres(url) {
  const { default: pg } = await import('pg');
  // COUNT/SUM come back as int8/numeric strings by default; these values are small.
  pg.types.setTypeParser(20, (v) => parseInt(v, 10));
  pg.types.setTypeParser(1700, (v) => parseFloat(v));
  // TLS is configured below; an sslmode in the URL would override it (and newer
  // drivers read sslmode=require as "verify the certificate", which Supabase's fails).
  const badChars = 'DATABASE_URL is not a valid connection string. If the database password contains characters like @ # / ? %, URL-encode them or reset it to letters and numbers.';
  // An unencoded '@' or '#' in the password would make the driver connect somewhere else.
  if ((url.split('?')[0].match(/@/g) || []).length > 1 || url.includes('#')) throw new Error(badChars);
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(badChars);
  }
  const local = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname) || parsed.searchParams.get('sslmode') === 'disable';
  for (const key of ['sslmode', 'ssl', 'sslrootcert', 'uselibpqcompat']) parsed.searchParams.delete(key);
  const pool = new pg.Pool({
    connectionString: parsed.toString(),
    // Supabase/Neon require TLS. Their certificates aren't always in Node's default store,
    // so verify against DATABASE_CA when provided, otherwise encrypt without pinning.
    ssl: local ? false : process.env.DATABASE_CA ? { ca: process.env.DATABASE_CA } : { rejectUnauthorized: false },
    // Enough for one page's parallel requests to run side by side; the provider's
    // pooler (Neon, Supabase) multiplexes them onto few real connections.
    max: Number(process.env.DATABASE_POOL_SIZE) || 10,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
  });
  // A connection the database closed while idle (it sleeps when unused) must not
  // crash the process; the pool drops it and opens a new one.
  pool.on('error', (err) => console.warn('Idle database connection closed:', err.message));
  // On Vercel, let idle connections close before the function is frozen.
  try {
    const { attachDatabasePool } = await import('@vercel/functions');
    attachDatabasePool(pool);
  } catch {
    // Not on Vercel, or an older helper: nothing to do.
  }

  // Serverless instances are frozen between requests, so a pooled connection can
  // already be dead when it's next used. Such a failure happens before the
  // statement runs, so it is safe to retry once on a fresh connection.
  const query = async (sql, params) => {
    try {
      return await pool.query(sql, params);
    } catch (err) {
      if (!isDeadConnection(err)) throw err;
      return pool.query(sql, params);
    }
  };
  const ex = executor(query);
  const begin = async () => {
    for (let attempt = 0; ; attempt++) {
      const client = await pool.connect();
      try {
        // A transaction left open (e.g. its serverless instance was frozen mid-way)
        // is ended by the database instead of holding its locks for good, and none
        // waits on another's locks for more than 20 s (it fails; the user retries).
        await client.query("BEGIN; SET LOCAL idle_in_transaction_session_timeout = '30s'; SET LOCAL lock_timeout = '20s'");
        return client;
      } catch (err) {
        client.release(err); // destroys it
        if (attempt > 0 || !isDeadConnection(err)) throw err;
      }
    }
  };
  return {
    kind: 'postgres',
    // Cloud region from the host name, e.g. ep-x-pooler.eu-central-1.aws.neon.tech
    // or aws-0-eu-central-1.pooler.supabase.com → eu-central-1.
    region: /\b((?:us|eu|ap|sa|ca|me|af|il|mx)-(?:east|west|central|north|south)(?:east|west)?-\d)\b/.exec(parsed.hostname)?.[1] ?? null,
    ...ex,
    async tx(fn) {
      const client = await begin();
      let broken = null;
      try {
        const result = await fn(txHandle((sql, params) => client.query(sql, params), 0));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch((e) => (broken = e));
        throw err;
      } finally {
        client.release(broken || undefined);
      }
    },
    exec: (sql) => pool.query(sql),
    close: () => pool.end(),
  };
}

async function createPglite(dataDir) {
  const { PGlite } = await import('@electric-sql/pglite');
  // Match the pg driver: NUMERIC (e.g. AVG, SUM of REAL) as a JS number.
  const pg = new PGlite({ dataDir, parsers: { 1700: (v) => parseFloat(v) } });
  await pg.waitReady;
  // PGlite is a single connection: queue work so a transaction never interleaves
  // with statements from other requests.
  let queue = Promise.resolve();
  const exclusive = (fn) => {
    const result = queue.then(fn, fn);
    queue = result.catch(() => {});
    return result;
  };
  const raw = (sql, params) => pg.query(sql, params);
  const ex = executor(raw);
  return {
    kind: 'pglite',
    run: (sql, params) => exclusive(() => ex.run(sql, params)),
    all: (sql, params) => exclusive(() => ex.all(sql, params)),
    get: (sql, params) => exclusive(() => ex.get(sql, params)),
    tx: (fn) =>
      exclusive(async () => {
        await raw('BEGIN', []);
        try {
          const result = await fn(txHandle(raw, 0));
          await raw('COMMIT', []);
          return result;
        } catch (err) {
          await raw('ROLLBACK', []).catch(() => {});
          throw err;
        }
      }),
    exec: (sql) => exclusive(() => pg.exec(sql)),
    close: () => pg.close(),
  };
}

// The connection string. Vercel's Neon integration sets DATABASE_URL; its Supabase
// integration sets POSTGRES_URL.
export const databaseUrl = (env = process.env) => env.DATABASE_URL || env.POSTGRES_URL || '';

// Opens the database and makes sure the schema exists.
export async function openDb({ url = databaseUrl(), dataDir } = {}) {
  const db = url ? await createPostgres(url) : await createPglite(dataDir);
  if (db.kind === 'postgres') await endStuckSessions(db);
  await ensureSchema(db);
  return db;
}

// Sessions stuck for good hold locks that every later request waits on: a
// transaction left open (its serverless instance frozen or timed out mid-way)
// and whatever has been queued behind one for minutes. Ended when a server
// instance starts; nothing legitimate waits that long (transactions give up
// after 20 s).
async function endStuckSessions(db) {
  try {
    const ended = await db.all(
      `SELECT pg_terminate_backend(pid) AS ok FROM pg_stat_activity
       WHERE datname = current_database() AND pid <> pg_backend_pid() AND usename = current_user
         AND ((state LIKE 'idle in transaction%' AND state_change < now() - interval '1 minute')
           OR (state = 'active' AND wait_event_type = 'Lock' AND state_change < now() - interval '2 minutes'))`,
    );
    if (ended.length) console.warn(`Ended ${ended.length} stuck database session(s)`);
  } catch (err) {
    console.warn('Could not check for stuck database sessions:', err.message);
  }
}

async function ensureSchema(db) {
  const current = await db
    .get("SELECT value FROM app_state WHERE key = 'schema'")
    .catch(() => null); // table doesn't exist yet
  if (current && Number(current.value) >= SCHEMA_VERSION) return;
  await db.tx(async (tx) => {
    // Rather fail (the next request tries again) than wait on a lock for good.
    if (db.kind === 'postgres') await tx.run("SET LOCAL lock_timeout = '15s'");
    // Serialise first-time setup when several instances start at once.
    await tx.run('SELECT pg_advisory_xact_lock(4242)');
    // Another instance may have finished it while this one waited.
    // (A failed query would abort this transaction, so check the table exists first.)
    if ((await tx.get("SELECT to_regclass('app_state') AS t")).t) {
      const done = await tx.get("SELECT value FROM app_state WHERE key = 'schema'");
      if (done && Number(done.value) >= SCHEMA_VERSION) return;
    }
    // Statements end with ';' at the end of a line (comments must not contain one).
    for (const statement of SCHEMA.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean)) await tx.run(statement);
    await tx.run(
      "INSERT INTO app_state (key, value) VALUES ('schema', ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
      [SCHEMA_VERSION],
    );
  });
}

// Bumps a shared counter and returns its new value.
export async function bump(q, key) {
  const row = await q.get(
    'INSERT INTO app_state (key, value) VALUES (?, 1) ON CONFLICT (key) DO UPDATE SET value = app_state.value + 1 RETURNING value',
    [key],
  );
  return Number(row.value);
}

export async function readCounter(q, key) {
  const row = await q.get('SELECT value FROM app_state WHERE key = ?', [key]);
  return row ? Number(row.value) : 0;
}

// A random secret generated once and shared by every server instance.
export async function storedSecret(db, key) {
  const { randomBytes } = await import('node:crypto');
  // One round trip: insert if missing, and return whichever value is stored.
  const row = await db.get(
    `INSERT INTO app_secrets (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = app_secrets.value RETURNING value`,
    [key, randomBytes(32).toString('hex')],
  );
  return row.value;
}
