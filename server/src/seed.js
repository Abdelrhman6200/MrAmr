// Demo organisation. Run `npm run seed` to wipe the database and reload it.
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { hashPassword, verifyPassword } from './auth.js';
import { bump, databaseUrl, openDb, readCounter } from './db.js';
import { localDate, nowUtc, utcAgo, DAY } from './time.js';
import { weekStart } from './weekly.js';
import { SOPS } from '../../client/src/sops.js';

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

// Tables with a SERIAL id that the seed inserts into.
const ID_TABLES = [
  'users',
  'projects',
  'tasks',
  'checklist_items',
  'comments',
  'activity',
  'call_lists',
  'calls',
  'call_logs',
  'centers',
  'availability_rounds',
  'availability',
  'notifications',
  'center_assignments',
  'delegations',
];

// Rows are collected first and written in a few bulk statements by flush():
// a hosted database may be far away, and hundreds of one-row inserts would take
// longer than a serverless request may run. Ids are reserved up front, so later
// rows can refer to earlier ones before anything is written. Every row is listed
// in sample_rows.
async function bulkWriter(tx) {
  const reserved = {};
  for (const r of await tx.all(
    `SELECT t.tbl, nextval(pg_get_serial_sequence(t.tbl, 'id'))::int AS id
     FROM unnest(?::text[]) AS t(tbl), generate_series(1, 300)`,
    [ID_TABLES],
  )) {
    (reserved[r.tbl] ??= []).push(r.id);
  }
  const pending = new Map(); // statement -> list of parameter lists, in first-use order
  const created = [];
  const prepare = (sql) => ({
    run: async (...params) => {
      const table = /^\s*INSERT INTO (\w+)/i.exec(sql)[1];
      let id = null;
      if (ID_TABLES.includes(table)) {
        id = reserved[table].shift();
        if (id == null) throw new Error(`Seed reserved too few ids for ${table}`);
        params = [id, ...params];
        created.push([table, id]);
      }
      if (!pending.has(sql)) pending.set(sql, { table, rows: [] });
      pending.get(sql).rows.push(params);
      return { lastInsertRowid: id };
    },
  });
  const flush = async () => {
    for (const [sql, { table, rows }] of pending) {
      const at = sql.search(/\bVALUES\b/i);
      let head = sql.slice(0, at);
      let tuple = sql.slice(at + 6).trim();
      const close = tuple.indexOf(')') + 1;
      const rest = tuple.slice(close);
      tuple = tuple.slice(0, close);
      if (ID_TABLES.includes(table)) {
        head = head.replace('(', '(id, ');
        tuple = tuple.replace('(', '(?, ');
      }
      await tx.run(`${head} VALUES ${rows.map(() => tuple).join(', ')}${rest}`, rows.flat());
    }
    await tx.run('INSERT INTO sample_rows (tbl, row_id) SELECT * FROM unnest(?::text[], ?::int[])', [
      created.map((c) => c[0]),
      created.map((c) => c[1]),
    ]);
  };
  return { prepare, flush };
}

// Writers for sample projects and tasks; `ids` maps sample keys to user ids.
function sampleHelpers(prepare, ids) {
  const insProject = prepare('INSERT INTO projects (name, description, department, owner_id, status, start_date, due_date, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const insMember = prepare('INSERT INTO project_members (project_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING');
  const project = async (name, desc, dept, owner, members, color, due, status = 'active') => {
    const id = (await insProject.run(name, desc, dept, ids[owner], status, day(-20), day(due), color)).lastInsertRowid;
    for (const m of [owner, ...members]) await insMember.run(id, ids[m]);
    return id;
  };
  const insTask = prepare(
    `INSERT INTO tasks (project_id, title, description, type, status, priority, assignee_id, reporter_id, reviewer_id, due_date, estimate_hours, tags, track, weekly_key, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insCheck = prepare('INSERT INTO checklist_items (task_id, text, done, position, required) VALUES (?, ?, ?, ?, ?)');
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
      opts.track || '',
      opts.week ?? null,
      status === 'done' ? daysAgoUtc(opts.doneAgo ?? 2) : null,
    );
    await insActivity.run(id, p, ids[reporter], 'created', title);
    // Checklist entries: [text, done, required].
    for (const [i, [text, done, required]] of (opts.checklist || []).entries()) await insCheck.run(id, text, done ? 1 : 0, i, required ? 1 : 0);
    for (const [who, body] of opts.comments || []) await insComment.run(id, ids[who], body);
    return id;
  };
  return { project, task };
}

// Loads the demo organisation. Every row it creates is listed in sample_rows so
// removeSampleData() can take it out again.
//
// `ceo`: an existing Head of Company to build the sample team under (instead of
// creating the demo one). The sample people then get random passwords nobody
// knows, so a live site doesn't gain accounts with a published password.
export async function seed(db, { ceo = null } = {}) {
  await db.tx(async (tx) => {
    const { prepare, flush } = await bulkWriter(tx);
    const hash = hashPassword(ceo ? crypto.randomBytes(24).toString('base64url') : DEMO_PASSWORD);
    const ids = {};
    if (ceo) ids.ceo = ceo.id;
    const insUser = prepare('INSERT INTO users (name, email, password_hash, role, title, manager_id, avatar_color) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const [key, name, email, role, mgr, color] of PEOPLE) {
      if (key === 'ceo' && ceo) continue;
      ids[key] = (await insUser.run(name, email, hash, role, null, mgr ? ids[mgr] : null, color)).lastInsertRowid;
    }

    const { project, task } = sampleHelpers(prepare, ids);

    const physics = await project('Physics 101 — Term 1 Course', 'Record, edit and QA all Term 1 physics lessons before launch.', 'content', 'hoc', ['ins1', 'ins2', 'ins3', 'cq'], '#8b5cf6', 25);
    const campaign = await project('Back-to-School Campaign', 'Multi-channel enrollment campaign for the new term.', 'marketing', 'mkt', ['mkt1', 'mkt2', 'ins1'], '#f97316', 14);
    const release = await project('Platform v2.4 Release', 'New quiz engine, video player fixes and student dashboard.', 'product', 'po', ['sys', 'qc', 'cs'], '#22c55e', 30);
    const support = await project('Support Backlog Cleanup', 'Clear the backlog of open student tickets and update the FAQ.', 'customer_service', 'cs', ['cs1', 'cs2'], '#ec4899', 10);
    const audit = await project('Q4 Content Quality Audit', 'Audit published lessons against the quality checklist.', 'systems_ops', 'sys', ['cq', 'qc', 'hoc'], '#14b8a6', 40, 'planning');


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
    // Work waiting on the Head of Company, so their own dashboard has something in it.
    await task(campaign, 'Approve the Back-to-School campaign budget', 'campaign', 'todo', 'urgent', 'ceo', 'mkt', 0, {
      tags: 'budget',
      desc: 'Paid ads, influencer posts and printed flyers for the new term. Total: 85,000 EGP.',
      comments: [['mkt', 'The breakdown per channel is attached in the campaign folder.']],
    });
    await task(null, 'Sign the renewal contract with Maadi Center', 'operations', 'todo', 'high', 'ceo', 'ops', -2, { tags: 'centers,contracts' });
    await task(null, 'Choose the platform pricing for next term', 'operations', 'in_progress', 'high', 'ceo', 'po', 3, {
      checklist: [['Compare competitor prices', true], ['Review last term sign-ups', true], ['Decide on early-bird discount', false]],
    });
    await task(null, 'Interview candidates for Marketing Lead', 'general', 'todo', 'medium', 'ceo', 'mkt', 5, { tags: 'hiring' });
    const launchPlan = await task(null, 'Term 1 launch plan', 'operations', 'in_review', 'high', 'ops', 'ceo', 1, {
      reviewer: 'ceo',
      desc: 'Timeline, owners and risks for launching Physics 101 on the platform and in the centers.',
      comments: [['ops', 'Ready for your sign-off. The main risk is the Safari video bug.']],
    });

    await academicSample(prepare, ids, hash);
    await platformSample(prepare, ids, hash);
    await csLeadSample(prepare, ids, hash);
    await mediaSample(prepare, ids, hash);

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

    const ceoNote = prepare('INSERT INTO notifications (user_id, type, message, task_id, params, read) VALUES (?, ?, ?, ?, ?, 0)');
    await ceoNote.run(ids.ceo, 'review_requested', 'Lina Mansour requested your review on "Term 1 launch plan"', launchPlan, JSON.stringify({ actor: 'Lina Mansour', title: 'Term 1 launch plan' }));
    await ceoNote.run(ids.ceo, 'blocked', '"Fix audio sync on Lesson 1 intro" is blocked', null, JSON.stringify({ actor: 'Youssef Samir', title: 'Fix audio sync on Lesson 1 intro' }));

    await flush();
    // Sample notifications are history, not news: never email them.
    await tx.run('UPDATE notifications SET emailed = 1');
    // Included, so upgradeSample() has nothing to add.
    for (const part of SAMPLE_PARTS) await bump(tx, part.counter);
    await bump(tx, 'org');
  });
}

// The Academic Material team: a head and three assistants, their center and
// platform work for the general, Azhar and Baccalaureate tracks, and last week's
// duties (this week's are created by weekly.js like for any assistant).
const ACADEMIC_PEOPLE = [
  ['acad', 'Sherif Abdallah', 'academic.head@taskflow.local', 'academic_head', 'ceo', '#6366f1'],
  ['asst1', 'Aya Mahmoud', 'assistant1@taskflow.local', 'assistant', 'acad', '#818cf8'],
  ['asst2', 'Mostafa Hany', 'assistant2@taskflow.local', 'assistant', 'acad', '#4f46e5'],
  ['asst3', 'Nada Wael', 'assistant3@taskflow.local', 'assistant', 'acad', '#a5b4fc'],
];

async function academicSample(prepare, ids, hash) {
  const insUser = prepare('INSERT INTO users (name, email, password_hash, role, title, manager_id, avatar_color) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const [key, name, email, role, mgr, color] of ACADEMIC_PEOPLE) {
    ids[key] = (await insUser.run(name, email, hash, role, null, ids[mgr], color)).lastInsertRowid;
  }
  const { project, task } = sampleHelpers(prepare, ids);
  const chem = await project('Chemistry — Term 1 Academic Material', 'Homework, exams and student questions for the chemistry course, at the centers and on the platform.', 'academic', 'acad', ['asst1', 'asst2', 'asst3'], '#6366f1', 60);
  const bac = await project('Baccalaureate Chemistry', 'Exam models, answers and student questions for the Baccalaureate track.', 'academic', 'acad', ['asst2', 'asst3'], '#4338ca', 75);

  // At the centers
  await task(chem, 'Grade Lesson 4 homework — Nasr City Center', 'hw_grading', 'in_progress', 'high', 'asst1', 'acad', 0, {
    track: 'general',
    desc: '64 papers from the Saturday group. Record the marks in the sheet before Monday.',
    checklist: [['Group A (32 papers)', true], ['Group B (32 papers)', false], ['Enter the marks', false]],
  });
  await task(chem, 'Proctor the monthly exam — Maadi Center', 'exam_proctoring', 'todo', 'high', 'asst2', 'acad', 2, { track: 'general,azhar', desc: 'Friday 10:00–12:00, hall 2. Be there 30 minutes early.' });
  await task(chem, 'Grade the monthly exam papers — Maadi Center', 'exam_grading', 'todo', 'high', 'asst2', 'acad', 4, { track: 'general,azhar', reviewer: 'acad' });
  await task(chem, 'Take student questions — Heliopolis Saturday class', 'center_questions', 'todo', 'medium', 'asst3', 'acad', 1, { track: 'azhar' });
  await task(chem, 'Grade Lesson 3 homework — Azhar group', 'hw_grading', 'done', 'medium', 'asst3', 'acad', -3, { track: 'azhar', doneAgo: 3 });

  // Exams and answers
  await task(chem, 'Write the October exam — models A and B', 'exam_papers', 'in_progress', 'urgent', 'asst1', 'acad', 3, {
    track: 'general',
    reviewer: 'acad',
    checklist: [['Model A', true], ['Model B', false], ['Mark scheme', false]],
  });
  await task(chem, 'Answers for the October exam', 'exam_answers', 'todo', 'high', 'asst3', 'acad', 5, { track: 'general', reviewer: 'acad' });
  await task(chem, 'Review the model answer for exam 3', 'model_answer_review', 'in_review', 'high', 'asst2', 'acad', 1, {
    track: 'general',
    reviewer: 'acad',
    comments: [['asst2', 'Checked every answer against the book. Question 7 had a wrong unit — fixed.']],
  });
  await task(chem, 'Homework 5 model answer (General)', 'hw_model_answer', 'done', 'medium', 'asst1', 'acad', -1, { track: 'general', reviewer: 'acad', doneAgo: 1 });
  await task(chem, 'Homework 5 model answer (Azhar)', 'hw_model_answer', 'in_progress', 'medium', 'asst3', 'acad', 2, { track: 'azhar', reviewer: 'acad' });
  await task(chem, 'Review the Homework 5 answer key', 'answer_key_review', 'todo', 'medium', 'asst2', 'acad', 3, { track: 'azhar' });

  // On the platform
  await task(chem, 'Answer student questions on the platform — Lesson 4', 'platform_questions', 'in_progress', 'high', 'asst3', 'acad', 0, { track: 'general', desc: '23 open questions. Reply within 24 hours.' });
  await task(chem, 'Grade the essay questions on the platform — Quiz 6', 'essay_grading', 'todo', 'high', 'asst1', 'acad', 3, { track: 'general' });

  // Baccalaureate
  await task(bac, 'Baccalaureate: exam model for Unit 1', 'exam_papers', 'todo', 'high', 'asst2', 'acad', 6, { track: 'baccalaureate', reviewer: 'acad' });
  await task(bac, 'Baccalaureate: answer student questions on the platform', 'platform_questions', 'in_progress', 'medium', 'asst3', 'acad', 1, { track: 'baccalaureate' });

  // Last week's duties
  const last = weekStart(localDate(-7));
  const items = ['Solve external book 1', 'Solve external book 2', 'Solve external book 3', 'Solve the teacher’s book', 'Solve the exam', 'Attend the class'];
  for (const [who, done, status] of [['asst1', 6, 'done'], ['asst2', 5, 'in_progress'], ['asst3', 6, 'done']]) {
    await task(null, `Weekly duties — week of ${last}`, 'weekly_duties', status, 'high', who, 'acad', -2, {
      reviewer: 'acad',
      week: last,
      doneAgo: 2,
      desc: 'Every week: solve the three external books, the teacher’s book and the exam, and attend the class.',
      checklist: items.map((text, i) => [text, i < done, true]),
    });
  }
}

// The online platform team under the Product Owner: the content upload schedule,
// exams, forums and student complaints.
const PLATFORM_PEOPLE = [
  ['plat1', 'Mai Hossam', 'platform1@taskflow.local', 'platform_member', 'po', '#4ade80'],
  ['plat2', 'Kareem Adel', 'platform2@taskflow.local', 'platform_member', 'po', '#16a34a'],
];

async function platformSample(prepare, ids, hash) {
  if (!ids.po) return;
  const insUser = prepare('INSERT INTO users (name, email, password_hash, role, title, manager_id, avatar_color) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const [key, name, email, role, mgr, color] of PLATFORM_PEOPLE) {
    ids[key] = (await insUser.run(name, email, hash, role, null, ids[mgr], color)).lastInsertRowid;
  }
  const { project, task } = sampleHelpers(prepare, ids);
  const members = ['plat1', 'plat2', ...['cs', 'hoc'].filter((k) => ids[k])];
  const term = await project('Online platform — Term 1', 'What goes on the platform and when: lessons, exams, forums and student complaints.', 'product', 'po', members, '#22c55e', 90);
  // The SOP as a checklist, with the first `done` steps ticked.
  const sop = (type, done = 0) => SOPS[type].en.steps.map((s, i) => [s.text, i < done, s.required]);

  // Upload schedule: one physics lesson a week, chemistry alongside.
  const physics = ['Motion & Velocity', 'Newton’s Laws', 'Work & Energy', 'Momentum', 'Circular Motion', 'Gravity', 'Waves', 'Sound'];
  for (const [i, name] of physics.entries()) {
    const due = (i - 3) * 7;
    const status = due < 0 ? 'done' : due === 0 ? 'in_progress' : 'todo';
    await task(term, `Upload Physics Lesson ${i + 1}: ${name}`, 'content_upload', status, due <= 7 ? 'high' : 'medium', i % 2 ? 'plat2' : 'plat1', 'po', due, {
      track: 'general,azhar',
      doneAgo: -due,
      checklist: sop('content_upload', status === 'done' ? 7 : status === 'in_progress' ? 3 : 0),
    });
  }
  const chemistry = [['Reaction Rates', -3, 'done'], ['Chemical Equilibrium', -1, 'todo'], ['Galvanic Cells', 4, 'todo'], ['Electrolysis', 11, 'todo']];
  for (const [i, [name, due, status]] of chemistry.entries()) {
    await task(term, `Upload Chemistry Lesson ${i + 1}: ${name}`, 'content_upload', status, 'high', 'plat1', 'po', due, {
      track: 'general',
      doneAgo: 3,
      checklist: sop('content_upload', status === 'done' ? 7 : 0),
      comments: due === -1 ? [['plat1', 'Waiting on the final cut from the content team.']] : [],
    });
  }

  // Exams
  await task(term, 'Physics Unit 1 exam on the platform', 'platform_exam', 'in_progress', 'urgent', 'plat2', 'po', 2, { track: 'general,azhar', reviewer: 'po', checklist: sop('platform_exam', 3) });
  await task(term, 'Chemistry Quiz 6 on the platform', 'platform_exam', 'done', 'high', 'plat2', 'po', -4, { track: 'general', doneAgo: 4, checklist: sop('platform_exam', 7) });
  await task(term, 'Publish the results of Physics Quiz 5', 'exam_results', 'todo', 'high', 'plat2', 'po', 1, { checklist: sop('exam_results', 1) });

  // Forums
  await task(term, 'Forum moderation — this week', 'forum_moderation', 'in_progress', 'medium', 'plat2', 'po', 3, { checklist: sop('forum_moderation', 2) });
  await task(term, 'Pin the answer about exam attempts in the forum', 'forum_moderation', 'done', 'low', 'plat2', 'po', -2, { doneAgo: 2 });

  // Complaints, many of them raised by Customer Service.
  const raisedBy = ids.cs ? 'cs' : 'po';
  await task(term, 'Complaint: video stops after 10 minutes (Sara Ali)', 'complaint', 'in_progress', 'urgent', 'plat1', raisedBy, 0, {
    tags: 'video',
    desc: 'Happens on Physics Lesson 3 on her phone. Phone: +20 100 123 4502.',
    checklist: sop('complaint', 3),
    comments: [['plat1', 'Reproduced on Android Chrome. Passing it to Systems Ops as a bug.']],
  });
  await task(term, 'Complaint: charged twice for Physics 101', 'complaint', 'todo', 'high', 'po', raisedBy, 1, { tags: 'payment', checklist: sop('complaint', 1) });
  await task(term, 'Complaint: exam closed before the time ended', 'complaint', 'done', 'high', 'plat2', raisedBy, -3, { tags: 'exams', doneAgo: 2, checklist: sop('complaint', 6) });
  await task(term, 'Complaint: my forum post was removed', 'complaint', 'todo', 'low', 'plat2', raisedBy, 3, { tags: 'forum', checklist: sop('complaint') });
}

// A Customer Service team leader with an agent of her own, who will act for the
// Head of Customer Service during her leave.
const CS_LEAD_PEOPLE = [
  ['csl', 'Nourhan Said', 'cs.lead@taskflow.local', 'cs_team_lead', 'cs', '#be185d'],
  ['cs3', 'Youssef Hamdy', 'support3@taskflow.local', 'cs_member', 'csl', '#f9a8d4'],
];

async function csLeadSample(prepare, ids, hash) {
  if (!ids.cs) return;
  const insUser = prepare('INSERT INTO users (name, email, password_hash, role, title, manager_id, avatar_color) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const [key, name, email, role, mgr, color] of CS_LEAD_PEOPLE) {
    ids[key] = (await insUser.run(name, email, hash, role, null, ids[mgr], color)).lastInsertRowid;
  }
  const { task } = sampleHelpers(prepare, ids);
  const sop = (type, done = 0) => SOPS[type].en.steps.map((s, i) => [s.text, i < done, s.required]);
  await task(null, 'Listen to 5 recorded calls and score them', 'support', 'in_progress', 'medium', 'csl', 'cs', 2, { tags: 'quality' });
  await task(null, 'Train Youssef on the refund script', 'support', 'todo', 'high', 'csl', 'cs', 4, { tags: 'training' });
  await task(null, 'Student cannot open Lesson 4 on his phone', 'support', 'in_progress', 'high', 'cs3', 'csl', 0, {
    reviewer: 'csl',
    checklist: sop('support', 2),
  });
  await prepare('INSERT INTO delegations (user_id, deputy_id, starts_on, ends_on, note, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(
    ids.cs, ids.csl, day(3), day(9), 'Annual leave', ids.cs,
  );
}

// Two video editors / photographers in the content team, who also shoot for marketing.
const MEDIA_PEOPLE = [
  ['med1', 'Mostafa Adel', 'media1@taskflow.local', 'media_producer', 'hoc', '#7c3aed'],
  ['med2', 'Hossam Ali', 'media2@taskflow.local', 'media_producer', 'hoc', '#a78bfa'],
];

async function mediaSample(prepare, ids, hash) {
  if (!ids.hoc) return;
  const insUser = prepare('INSERT INTO users (name, email, password_hash, role, title, manager_id, avatar_color) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const [key, name, email, role, mgr, color] of MEDIA_PEOPLE) {
    ids[key] = (await insUser.run(name, email, hash, role, null, ids[mgr], color)).lastInsertRowid;
  }
  const { task } = sampleHelpers(prepare, ids);
  const sop = (type, done = 0) => SOPS[type].en.steps.map((s, i) => [s.text, i < done, s.required]);
  await task(null, 'Film Physics Lesson 5: Circular Motion with Youssef', 'filming', 'todo', 'high', 'med1', 'hoc', 1, { checklist: sop('filming', 1) });
  await task(null, 'Edit Physics Lesson 4: Momentum', 'video_editing', 'in_progress', 'high', 'med2', 'hoc', 2, { reviewer: ids.cq ? 'cq' : null, checklist: sop('video_editing', 3) });
  await task(null, 'Edit Physics Lesson 3: Work & Energy', 'video_editing', 'done', 'medium', 'med2', 'hoc', -4, { doneAgo: 3, checklist: sop('video_editing', 7) });
  if (ids.mkt) {
    await task(null, 'Photo shoot for the Back-to-School campaign', 'filming', 'todo', 'medium', 'med1', 'mkt', 4, { tags: 'campaign', checklist: sop('filming') });
  }
}

// Sample parts added after a site first loaded the sample: each is added once
// (its counter marks it), under the Head of Company the sample belongs to.
const SAMPLE_PARTS = [
  { counter: 'sample_academic', marker: 'academic.head@taskflow.local', add: academicSample },
  { counter: 'sample_platform', marker: 'platform1@taskflow.local', add: platformSample },
  { counter: 'sample_cs_lead', marker: 'cs.lead@taskflow.local', add: csLeadSample },
  { counter: 'sample_media', marker: 'media1@taskflow.local', add: mediaSample },
];

export async function upgradeSample(db) {
  const missing = async (q) => {
    const out = [];
    for (const part of SAMPLE_PARTS) if (!(await readCounter(q, part.counter))) out.push(part);
    return out;
  };
  if (!(await missing(db)).length || !(await hasSampleData(db))) return false;
  return db.tx(async (tx) => {
    await tx.run('SELECT pg_advisory_xact_lock(4245)');
    const parts = await missing(tx);
    if (!parts.length) return false;
    for (const part of parts) await bump(tx, part.counter);
    const ops = await tx.get(
      "SELECT o.password_hash, c.id AS ceo_id FROM users o JOIN users c ON c.id = o.manager_id AND c.role = 'ceo' WHERE o.email = 'ops@taskflow.local'",
    );
    if (!ops) return false;
    // The sample people already there, by their keys.
    const ids = { ceo: ops.ceo_id };
    const byEmail = Object.fromEntries((await tx.all('SELECT id, email FROM users WHERE email = ANY(?::text[])', [PEOPLE.map((p) => p[2])])).map((u) => [u.email, u.id]));
    for (const [key, , email] of PEOPLE) if (key !== 'ceo' && byEmail[email]) ids[key] = byEmail[email];
    // The same kind of password as the rest of the sample people.
    const demo = verifyPassword(DEMO_PASSWORD, ops.password_hash);
    const hash = hashPassword(demo ? DEMO_PASSWORD : crypto.randomBytes(24).toString('base64url'));
    const { prepare, flush } = await bulkWriter(tx);
    let added = false;
    for (const part of parts) {
      if (await tx.get('SELECT 1 FROM users WHERE email = ?', [part.marker])) continue;
      await part.add(prepare, ids, hash);
      added = true;
    }
    await flush();
    await bump(tx, 'org');
    return added;
  });
}

// Tables in the order their sample rows can be deleted.
const SAMPLE_TABLES = [
  'delegations',
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
  const removed = await db.tx(async (tx) => {
    const all = await tx.all('SELECT tbl, row_id FROM sample_rows');
    const ids = async (table) => all.filter((r) => r.tbl === table).map((r) => r.row_id);
    const people = (await ids('users')).filter((id) => id !== keeper.id);
    let removed = 0;
    for (const table of SAMPLE_TABLES) {
      removed += (await tx.run(`DELETE FROM ${table} WHERE id = ANY(?::int[])`, [await ids(table)])).rowCount;
    }
    // Weekly duties weekly.js created for sample people go with them.
    removed += (await tx.run('DELETE FROM tasks WHERE weekly_key IS NOT NULL AND assignee_id = ANY(?::int[])', [people])).rowCount;
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
    await bump(tx, 'sample_auto'); // never auto-load it again
    await bump(tx, 'org');
    return removed;
  });
  await noteStatus(db, 'sample', `removed by ${keeper.email}`);
  return removed;
}

// Loads the sample data automatically, once per database, under the Head of
// Company (`preferEmail`'s account if that is one). Once it has run, it never runs
// again, so removing the sample keeps it removed.
//
// The "done" mark and the data are written in one transaction: if the server is
// stopped part-way (serverless platforms do that), neither is saved and the next
// attempt starts over. The outcome is kept for /api/health.
export async function autoLoadSample(db, preferEmail = null) {
  if (await finished(db)) {
    await upgradeSample(db);
    return false;
  }
  try {
    const loaded = await db.tx(async (tx) => {
      await tx.run('SELECT pg_advisory_xact_lock(4245)'); // one instance at a time
      if (await finished(tx)) return null;
      const ceo = await tx.get(
        "SELECT * FROM users WHERE role = 'ceo' AND active = 1 ORDER BY (email = ?) DESC, id LIMIT 1",
        [String(preferEmail || '').trim().toLowerCase()],
      );
      if (!ceo) return null; // nobody to own it yet; try again later
      if (await hasSampleData(tx)) return 'already loaded';
      if (await tx.get("SELECT 1 FROM users WHERE email LIKE '%@taskflow.local' LIMIT 1")) return 'sample people already exist';
      await seed(tx, { ceo });
      await bump(tx, 'sample_auto');
      return `loaded under ${ceo.email}`;
    });
    if (loaded) await noteStatus(db, 'sample', loaded);
    if (loaded?.startsWith('loaded')) console.log(`Sample data ${loaded}.`);
    return !!loaded?.startsWith('loaded');
  } catch (err) {
    await noteStatus(db, 'sample', `failed: ${err.code ? `${err.code} ` : ''}${err.message}`).catch(() => {});
    throw err;
  }
}

// Done for good once it loaded or was removed. A mark with no outcome recorded
// comes from an earlier version that could be stopped part-way: try again.
async function finished(q) {
  if (!(await readCounter(q, 'sample_auto'))) return false;
  const status = await readStatus(q, 'sample');
  return status != null && !status.startsWith('failed');
}

// Small status notes (kept alongside generated secrets; nothing here is secret).
export async function noteStatus(db, what, text) {
  await db.run(
    'INSERT INTO app_secrets (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [`status:${what}`, `${text.slice(0, 300)} (${nowUtc()} UTC)`],
  );
}

export const readStatus = async (db, what) => (await db.get('SELECT value FROM app_secrets WHERE key = ?', [`status:${what}`]))?.value ?? null;

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
