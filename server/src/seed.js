// Demo organisation. Run `npm run seed` to wipe the database and reload it.
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { hashPassword } from './auth.js';
import { bump, databaseUrl, openDb } from './db.js';
import { localDate, nowUtc, utcAgo, DAY } from './time.js';

export const DEMO_PASSWORD = 'password123';

// [key, name, email, role, managerKey, color]
const PEOPLE = [
  ['ceo', 'Omar Haddad', 'ceo@taskflow.local', 'ceo', null, '#334155'],
  ['ops', 'Lina Mansour', 'ops@taskflow.local', 'ops_manager', 'ceo', '#0ea5e9'],
  ['hoc', 'Karim Fathy', 'content.head@taskflow.local', 'head_of_content', 'ops', '#8b5cf6'],
  ['ins1', 'Nour Adel', 'instructor1@taskflow.local', 'instructor', 'hoc', '#a855f7'],
  ['ins2', 'Youssef Samir', 'instructor2@taskflow.local', 'instructor', 'hoc', '#6366f1'],
  ['ins3', 'Mariam Tarek', 'instructor3@taskflow.local', 'instructor', 'hoc', '#c084fc'],
  ['mkt', 'Hana Salah', 'marketing@taskflow.local', 'marketing_manager', 'ceo', '#f97316'],
  ['mkt1', 'Ali Hassan', 'marketing1@taskflow.local', 'marketing_member', 'mkt', '#fb923c'],
  ['mkt2', 'Salma Ibrahim', 'marketing2@taskflow.local', 'marketing_member', 'mkt', '#f59e0b'],
  ['sys', 'Tamer Nabil', 'sysops@taskflow.local', 'sysops_manager', 'ceo', '#14b8a6'],
  ['cq', 'Dina Mostafa', 'quality@taskflow.local', 'content_quality', 'sys', '#2dd4bf'],
  ['qc', 'Hassan Ezz', 'qc@taskflow.local', 'ops_qc', 'sys', '#0d9488'],
  ['cs', 'Rana Kamal', 'cs.head@taskflow.local', 'cs_head', 'ceo', '#ec4899'],
  ['cs1', 'Mohamed Gamal', 'support1@taskflow.local', 'cs_member', 'cs', '#f472b6'],
  ['cs2', 'Farah Yasser', 'support2@taskflow.local', 'cs_member', 'cs', '#db2777'],
  ['po', 'Ahmed Zaki', 'product@taskflow.local', 'product_owner', 'ceo', '#22c55e'],
];

// A calendar date `offset` days from today, in the app's time zone.
const day = (offset) => localDate(offset);
const daysAgoUtc = (n) => utcAgo(n * DAY);

// Loads the demo organisation. Every row it creates is listed in sample_rows so
// removeSampleData() can take it out again.
//
// `ceo`: an existing Head of Company to build the sample team under (instead of
// creating the demo one). The sample people then get random passwords nobody
// knows, so a live site doesn't gain accounts with a published password.
export async function seed(db, { ceo = null } = {}) {
  await db.tx(async (tx) => {
    // Statement helper: run(...params) resolves to { lastInsertRowid } like the old driver.
    const prepare = (sql) => ({
      run: async (...params) => {
        const row = await tx.get(/^\s*INSERT/i.test(sql) ? `${sql} RETURNING *` : sql, params);
        const table = /^\s*INSERT INTO (\w+)/i.exec(sql)?.[1];
        if (row?.id != null && table) await tx.run('INSERT INTO sample_rows (tbl, row_id) VALUES (?, ?)', [table, row.id]);
        return { lastInsertRowid: row?.id };
      },
    });
    const hash = hashPassword(ceo ? crypto.randomBytes(24).toString('base64url') : DEMO_PASSWORD);
    const ids = {};
    if (ceo) ids.ceo = ceo.id;
    const insUser = prepare('INSERT INTO users (name, email, password_hash, role, title, manager_id, avatar_color) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const [key, name, email, role, mgr, color] of PEOPLE) {
      if (key === 'ceo' && ceo) continue;
      ids[key] = (await insUser.run(name, email, hash, role, null, mgr ? ids[mgr] : null, color)).lastInsertRowid;
    }

    const insProject = prepare('INSERT INTO projects (name, description, department, owner_id, status, start_date, due_date, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const insMember = prepare('INSERT INTO project_members (project_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING');
    const project = async (name, desc, dept, owner, members, color, due, status = 'active') => {
      const id = (await insProject.run(name, desc, dept, ids[owner], status, day(-20), day(due), color)).lastInsertRowid;
      for (const m of [owner, ...members]) await insMember.run(id, ids[m]);
      return id;
    };

    const physics = await project('Physics 101 — Term 1 Course', 'Record, edit and QA all Term 1 physics lessons before launch.', 'content', 'hoc', ['ins1', 'ins2', 'ins3', 'cq'], '#8b5cf6', 25);
    const campaign = await project('Back-to-School Campaign', 'Multi-channel enrollment campaign for the new term.', 'marketing', 'mkt', ['mkt1', 'mkt2', 'ins1'], '#f97316', 14);
    const release = await project('Platform v2.4 Release', 'New quiz engine, video player fixes and student dashboard.', 'product', 'po', ['sys', 'qc', 'cs'], '#22c55e', 30);
    const support = await project('Support Backlog Cleanup', 'Clear the backlog of open student tickets and update the FAQ.', 'customer_service', 'cs', ['cs1', 'cs2'], '#ec4899', 10);
    const audit = await project('Q4 Content Quality Audit', 'Audit published lessons against the quality checklist.', 'systems_ops', 'sys', ['cq', 'qc', 'hoc'], '#14b8a6', 40, 'planning');

    const insTask = prepare(
      `INSERT INTO tasks (project_id, title, description, type, status, priority, assignee_id, reporter_id, reviewer_id, due_date, estimate_hours, tags, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insCheck = prepare('INSERT INTO checklist_items (task_id, text, done, position) VALUES (?, ?, ?, ?)');
    const insComment = prepare('INSERT INTO comments (task_id, user_id, body) VALUES (?, ?, ?)');
    const insActivity = prepare('INSERT INTO activity (task_id, project_id, user_id, action, detail) VALUES (?, ?, ?, ?, ?)');
    const task = async (p, title, type, status, priority, assignee, reporter, due, opts = {}) => {
      const { lastInsertRowid: id } = await insTask.run(
          p,
          title,
          opts.desc || '',
          type,
          status,
          priority,
          assignee ? ids[assignee] : null,
          ids[reporter],
          opts.reviewer ? ids[opts.reviewer] : null,
          due == null ? null : day(due),
          opts.est ?? null,
          opts.tags || '',
          status === 'done' ? daysAgoUtc(opts.doneAgo ?? 2) : null,
      );
      await insActivity.run(id, p, ids[reporter], 'created', title);
      for (const [i, [text, done]] of (opts.checklist || []).entries()) await insCheck.run(id, text, done ? 1 : 0, i);
      for (const [who, body] of opts.comments || []) await insComment.run(id, ids[who], body);
      return id;
    };

    // Content
    await task(physics, 'Record Lesson 1: Motion & Velocity', 'content', 'done', 'high', 'ins1', 'hoc', -6, { reviewer: 'cq', est: 6, tags: 'video,lesson', doneAgo: 5 });
    const lesson2 = await task(physics, 'Record Lesson 2: Newton’s Laws', 'content', 'in_review', 'high', 'ins1', 'hoc', 1, {
      reviewer: 'cq',
      est: 6,
      tags: 'video,lesson',
      desc: 'Cover all three laws with real-world examples. Include a 5-question quiz at the end.',
      checklist: [['Script approved', true], ['Recording', true], ['Editing', true], ['Quiz questions uploaded', true]],
      comments: [['ins1', 'Uploaded the final cut — ready for QA.']],
    });
    await task(physics, 'Record Lesson 3: Work & Energy', 'content', 'in_progress', 'medium', 'ins2', 'hoc', 5, {
      reviewer: 'cq',
      est: 6,
      tags: 'video,lesson',
      checklist: [['Script approved', true], ['Recording', false], ['Editing', false]],
    });
    await task(physics, 'Write worksheet for Lessons 1–3', 'content', 'todo', 'medium', 'ins3', 'hoc', 8, { reviewer: 'cq', est: 4, tags: 'worksheet' });
    await task(physics, 'Fix audio sync on Lesson 1 intro', 'content', 'blocked', 'urgent', 'ins2', 'cq', -1, {
      desc: 'Audio drifts ~0.5s behind video after 02:10.',
      comments: [['ins2', 'Waiting on the raw footage backup from Systems Ops.']],
    });
    await task(physics, 'Approve Term 1 syllabus', 'content_review', 'done', 'high', 'hoc', 'ops', -12, { doneAgo: 11 });

    // Marketing
    await task(campaign, 'Design social media creatives', 'campaign', 'in_progress', 'high', 'mkt1', 'mkt', 3, { reviewer: 'mkt', tags: 'social,design', est: 10 });
    await task(campaign, 'Write email announcement sequence', 'campaign', 'todo', 'medium', 'mkt2', 'mkt', 6, { tags: 'email', est: 5 });
    await task(campaign, 'Film teaser video with instructor', 'campaign', 'todo', 'high', 'ins1', 'mkt', 9, { tags: 'video', desc: 'A 30-second teaser for Physics 101.' });
    await task(campaign, 'Launch paid ads', 'campaign', 'todo', 'urgent', 'mkt1', 'mkt', 12, { tags: 'ads' });
    await task(campaign, 'Competitor pricing research', 'campaign', 'done', 'low', 'mkt2', 'mkt', -4, { doneAgo: 3 });

    // Product / systems
    await task(release, 'Quiz engine: support image answers', 'feature', 'in_progress', 'high', 'po', 'po', 15, { tags: 'quiz', est: 16 });
    const safari = await task(release, 'Video player freezes on Safari', 'bug', 'todo', 'urgent', 'sys', 'cs', 2, {
      reviewer: 'qc',
      tags: 'video,safari',
      desc: 'Reported by 14 students this week. Reproducible on Safari 17.',
      comments: [['cs', 'Raising this from the support queue — top complaint right now.']],
    });
    await task(release, 'Regression test plan for v2.4', 'qc_check', 'todo', 'high', 'qc', 'sys', 20, { est: 8 });
    await task(release, 'Student dashboard wireframes sign-off', 'feature', 'done', 'medium', 'po', 'ceo', -3, { doneAgo: 2 });

    // Customer service
    await task(support, 'Answer refund tickets older than 3 days', 'support', 'in_progress', 'high', 'cs1', 'cs', 0, { tags: 'refunds' });
    await task(support, 'Update FAQ: login & password reset', 'support', 'todo', 'medium', 'cs2', 'cs', 4, { reviewer: 'cs', tags: 'faq' });
    await task(support, 'Weekly ticket summary for leadership', 'support', 'todo', 'low', 'cs', 'ceo', 2);
    await task(support, 'Call back students with failed payments', 'support', 'done', 'high', 'cs2', 'cs', -2, { doneAgo: 1 });

    // Systems ops / QC
    await task(audit, 'Define content quality checklist', 'qc_check', 'in_progress', 'high', 'cq', 'sys', 7, {
      checklist: [['Audio levels', true], ['Captions accuracy', false], ['Slide typos', false], ['Quiz answer key', false]],
    });
    await task(audit, 'Spot-check 20 published lessons', 'qc_check', 'todo', 'medium', 'qc', 'sys', 18);
    await task(null, 'Back up raw lesson footage to cold storage', 'operations', 'in_progress', 'high', 'sys', 'ops', 1, { tags: 'infra' });

    // Leadership
    await task(null, 'Q4 budget review', 'operations', 'todo', 'high', 'ops', 'ceo', 6);
    await task(null, 'Monthly all-hands agenda', 'general', 'todo', 'medium', 'ceo', 'ceo', 10);
    await task(null, 'Hire two new instructors', 'operations', 'in_progress', 'medium', 'hoc', 'ops', 21, { tags: 'hiring' });

    // Customer Service call list
    const callList = (
      await prepare('INSERT INTO call_lists (name, description, source_filename, columns, created_by) VALUES (?, ?, ?, ?, ?)')
        .run('Failed payments — October', 'Students whose card payment failed this month.', 'failed-payments-october.xlsx', JSON.stringify(['Name', 'Phone', 'Email', 'Course', 'Amount']), ids.cs)
    ).lastInsertRowid;
    const insCall = prepare('INSERT INTO calls (list_id, name, phone, email, data, assignee_id, status, notes, attempts, last_called_at, callback_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const insLog = prepare('INSERT INTO call_logs (call_id, user_id, status, note) VALUES (?, ?, ?, ?)');
    const CONTACTS = [
      ['Ahmed Mahmoud', '+20 100 123 4501', 'Physics 101', '450', 'cs1', 'reached', 'Paid by bank transfer.'],
      ['Sara Ali', '+20 100 123 4502', 'Physics 101', '450', 'cs2', 'no_answer', ''],
      ['Omar Khaled', '+20 100 123 4503', 'Chemistry', '380', 'cs1', 'callback', 'Asked to call after 6pm.'],
      ['Mona Hassan', '+20 100 123 4504', 'Physics 101', '450', 'cs2', 'pending', ''],
      ['Youssef Adel', '+20 100 123 4505', 'Math', '300', 'cs1', 'pending', ''],
      ['Laila Samy', '+20 100 123 4506', 'Physics 101', '450', 'cs2', 'reached', 'Will retry the card tonight.'],
      ['Karim Nabil', '+20 100 123 4507', 'Math', '300', 'cs1', 'wrong_number', ''],
      ['Nada Fouad', '+20 100 123 4508', 'Chemistry', '380', 'cs2', 'pending', ''],
      ['Tarek Ezzat', '+20 100 123 4509', 'Physics 101', '450', null, 'pending', ''],
      ['Heba Magdy', '+20 100 123 4510', 'Math', '300', null, 'pending', ''],
    ];
    const tomorrow = `${day(1)}T18:00`;
    for (const [name, phone, course, amount, who, status, note] of CONTACTS) {
      const email = `${name.split(' ')[0].toLowerCase()}@example.com`;
      const called = status !== 'pending';
      const { lastInsertRowid: cid } = await insCall.run(callList, name, phone, email, JSON.stringify({ Name: name, Phone: phone, Email: email, Course: course, Amount: amount }), who ? ids[who] : null, status, note, called ? 1 : 0, called ? nowUtc() : null, status === 'callback' ? tomorrow : null);
      if (called) await insLog.run(cid, ids[who], status, note);
    }

    // Offline centers, availability and weekly schedule
    const insCenter = prepare('INSERT INTO centers (name, city, address, phone, contact_name, capacity) VALUES (?, ?, ?, ?, ?, ?)');
    const center = async (...v) => (await insCenter.run(...v)).lastInsertRowid;
    const nasr = await center('Nasr City Center', 'Cairo', '12 Abbas El Akkad St.', '+20 2 2401 0001', 'Mahmoud Saeed', 3);
    const maadi = await center('Maadi Center', 'Cairo', 'Road 9, Maadi', '+20 2 2358 0002', 'Dalia Ashraf', 2);
    const heliopolis = await center('Heliopolis Center', 'Cairo', '45 El Merghany St.', '+20 2 2415 0003', 'Sherif Lotfy', 2);
    await center('Smouha Center', 'Alexandria', '7 Fawzy Moaz St., Smouha', '+20 3 4250 0004', 'Rania Adel', 2);

    const round = (
      await prepare('INSERT INTO availability_rounds (title, starts_on, ends_on, due_date, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)')
        .run('Term 2 — center sessions', day(14), day(120), day(5), 'Add every weekly slot you can teach in person.', ids.hoc)
    ).lastInsertRowid;
    const insAvail = prepare('INSERT INTO availability (round_id, instructor_id, slots, center_ids, max_sessions, notes, submitted_by) VALUES (?, ?, ?, ?, ?, ?, ?)');
    await insAvail.run(round, ids.ins1, JSON.stringify([
      { day: 'sat', start: '10:00', end: '16:00' },
      { day: 'mon', start: '16:00', end: '21:00' },
      { day: 'wed', start: '16:00', end: '21:00' },
    ]), JSON.stringify([nasr, heliopolis]), 4, 'Prefer east Cairo centers.', ids.ins1);
    await insAvail.run(round, ids.ins2, JSON.stringify([
      { day: 'sun', start: '12:00', end: '20:00' },
      { day: 'tue', start: '12:00', end: '20:00' },
      { day: 'thu', start: '15:00', end: '21:00' },
    ]), JSON.stringify([maadi, nasr]), 3, '', ids.ins2);
    for (const i of ['ins1', 'ins2', 'ins3']) {
      await prepare('INSERT INTO notifications (user_id, type, message, link, params) VALUES (?, ?, ?, ?, ?)').run(
        ids[i], 'availability_requested', 'Karim Fathy asked for your availability: "Term 2 — center sessions"', '/centers?tab=mine',
        JSON.stringify({ actor: 'Karim Fathy', title: 'Term 2 — center sessions' }),
      );
    }
    const insAssign = prepare('INSERT INTO center_assignments (center_id, instructor_id, day, start_time, end_time, subject, round_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    await insAssign.run(nasr, ids.ins1, 'sat', '10:00', '12:00', 'Physics — Grade 12', round, ids.hoc);
    await insAssign.run(heliopolis, ids.ins1, 'mon', '17:00', '19:00', 'Physics — Grade 11', round, ids.hoc);
    await insAssign.run(maadi, ids.ins2, 'sun', '14:00', '16:00', 'Chemistry — Grade 12', round, ids.hoc);
    await insAssign.run(nasr, ids.ins2, 'thu', '17:00', '19:00', 'Chemistry — Grade 11', round, ids.hoc);

    const insNote = prepare('INSERT INTO notifications (user_id, type, message, task_id, params) VALUES (?, ?, ?, ?, ?)');
    await insNote.run(ids.cq, 'review_requested', 'Nour Adel requested your review on "Record Lesson 2: Newton’s Laws"', lesson2, JSON.stringify({ actor: 'Nour Adel', title: 'Record Lesson 2: Newton’s Laws' }));
    await insNote.run(ids.sys, 'assigned', 'Rana Kamal assigned you "Video player freezes on Safari"', safari, JSON.stringify({ actor: 'Rana Kamal', title: 'Video player freezes on Safari' }));

    // Sample notifications are history, not news: never email them.
    await tx.run('UPDATE notifications SET emailed = 1');
    await bump(tx, 'org');
  });
}

// Tables in the order their sample rows can be deleted.
const SAMPLE_TABLES = [
  'notifications',
  'activity',
  'comments',
  'checklist_items',
  'call_logs',
  'calls',
  'call_lists',
  'center_assignments',
  'availability',
  'availability_rounds',
  'centers',
  'tasks',
  'projects',
];

export const hasSampleData = async (db) => !!(await db.get('SELECT 1 FROM sample_rows LIMIT 1'));

// Removes everything "Load sample data" created. Real work that only touches
// sample people survives: their tasks become unassigned, projects they owned
// pass to `keeper` (the Head of Company removing the sample).
export async function removeSampleData(db, keeper) {
  return db.tx(async (tx) => {
    const ids = async (table) => (await tx.all('SELECT row_id FROM sample_rows WHERE tbl = ?', [table])).map((r) => r.row_id);
    const people = (await ids('users')).filter((id) => id !== keeper.id);
    let removed = 0;
    for (const table of SAMPLE_TABLES) {
      removed += (await tx.run(`DELETE FROM ${table} WHERE id = ANY(?::int[])`, [await ids(table)])).rowCount;
    }
    // Anything real still pointing at a sample person.
    await tx.run('UPDATE projects SET owner_id = ? WHERE owner_id = ANY(?::int[])', [keeper.id, people]);
    await tx.run('UPDATE tasks SET reporter_id = ? WHERE reporter_id = ANY(?::int[])', [keeper.id, people]);
    for (const [table, column] of [
      ['comments', 'user_id'],
      ['activity', 'user_id'],
      ['call_logs', 'user_id'],
      ['call_lists', 'created_by'],
      ['availability_rounds', 'created_by'],
    ]) {
      await tx.run(`UPDATE ${table} SET ${column} = ? WHERE ${column} = ANY(?::int[])`, [keeper.id, people]);
    }
    await tx.run('UPDATE availability SET submitted_by = NULL WHERE submitted_by = ANY(?::int[])', [people]);
    await tx.run('UPDATE center_assignments SET created_by = NULL WHERE created_by = ANY(?::int[])', [people]);
    await tx.run('UPDATE password_resets SET created_by = NULL WHERE created_by = ANY(?::int[])', [people]);
    removed += (await tx.run('DELETE FROM users WHERE id = ANY(?::int[])', [people])).rowCount;
    await tx.run('DELETE FROM sample_rows');
    await bump(tx, 'org');
    return removed;
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { localDataDir } = await import('./config.js');
  const db = await openDb({ dataDir: databaseUrl() ? undefined : localDataDir() });
  if (process.argv.includes('--reset') && databaseUrl() && !process.argv.includes('--force')) {
    console.error('DATABASE_URL is set: this would wipe that database. Add --force if that is really what you want.');
    process.exit(1);
  }
  if (process.argv.includes('--reset')) {
    // Empties every table; the schema stays.
    const tables = await db.all("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('app_state')");
    await db.run(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
    await db.run("UPDATE app_state SET value = value + 1 WHERE key = 'org'");
  }
  if ((await db.get('SELECT COUNT(*) AS n FROM users')).n > 0) {
    console.log('Database already has data; use --reset to wipe it.');
  } else {
    await seed(db);
    console.log(`Seeded the demo organisation. Every account uses the password "${DEMO_PASSWORD}".`);
  }
  await db.close();
}
