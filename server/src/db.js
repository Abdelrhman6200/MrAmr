// Database access. Everything is Postgres:
//  - with DATABASE_URL (e.g. Supabase) it uses a real Postgres server via `pg`;
//  - without it (local development, tests) it uses PGlite, Postgres
//    compiled to WebAssembly, stored in DATA_DIR or kept in memory.
//
// Queries are written with `?` placeholders; they are numbered ($1, $2…) here.
// db.all / db.get / db.run run one statement; db.tx(fn) runs fn in a transaction
// and hands it an object with the same methods (nested db.tx calls use savepoints).

const NOW = "to_char(timezone('UTC', now()), 'YYYY-MM-DD HH24:MI:SS')";

// Bump when the schema below changes; startup re-applies it once.
export const SCHEMA_VERSION = 1;

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

CREATE TABLE IF NOT EXISTS checklist_items (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0
);

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
    // Supabase requires TLS. Its pooler certificate isn't in Node's default store,
    // so verify against DATABASE_CA when provided, otherwise encrypt without pinning.
    ssl: local ? false : process.env.DATABASE_CA ? { ca: process.env.DATABASE_CA } : { rejectUnauthorized: false },
    // Serverless: few connections per instance; Supabase's pooler multiplexes them.
    max: Number(process.env.DATABASE_POOL_SIZE) || 3,
    idleTimeoutMillis: 10_000,
  });
  const ex = executor((sql, params) => pool.query(sql, params));
  return {
    kind: 'postgres',
    ...ex,
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(txHandle((sql, params) => client.query(sql, params), 0));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
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

// Opens the database and makes sure the schema exists.
export async function openDb({ url = process.env.DATABASE_URL, dataDir } = {}) {
  const db = url ? await createPostgres(url) : await createPglite(dataDir);
  await ensureSchema(db);
  return db;
}

async function ensureSchema(db) {
  const current = await db
    .get("SELECT value FROM app_state WHERE key = 'schema'")
    .catch(() => null); // table doesn't exist yet
  if (current && Number(current.value) >= SCHEMA_VERSION) return;
  await db.tx(async (tx) => {
    // Serialise first-time setup when several instances start at once.
    await tx.run('SELECT pg_advisory_xact_lock(4242)');
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
