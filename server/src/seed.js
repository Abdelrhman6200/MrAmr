// Demo organisation. Run `npm run seed` to wipe the database and reload it.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hashPassword } from './auth.js';
import { openDb, transaction } from './db.js';

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

const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

export function seed(db) {
  transaction(db, () => {
    const hash = hashPassword(DEMO_PASSWORD);
    const ids = {};
    const insUser = db.prepare('INSERT INTO users (name, email, password_hash, role, title, manager_id, avatar_color) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const [key, name, email, role, mgr, color] of PEOPLE) {
      ids[key] = Number(insUser.run(name, email, hash, role, null, mgr ? ids[mgr] : null, color).lastInsertRowid);
    }

    const insProject = db.prepare('INSERT INTO projects (name, description, department, owner_id, status, start_date, due_date, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const insMember = db.prepare('INSERT OR IGNORE INTO project_members (project_id, user_id) VALUES (?, ?)');
    const project = (name, desc, dept, owner, members, color, due, status = 'active') => {
      const id = Number(insProject.run(name, desc, dept, ids[owner], status, day(-20), day(due), color).lastInsertRowid);
      for (const m of [owner, ...members]) insMember.run(id, ids[m]);
      return id;
    };

    const physics = project('Physics 101 — Term 1 Course', 'Record, edit and QA all Term 1 physics lessons before launch.', 'content', 'hoc', ['ins1', 'ins2', 'ins3', 'cq'], '#8b5cf6', 25);
    const campaign = project('Back-to-School Campaign', 'Multi-channel enrollment campaign for the new term.', 'marketing', 'mkt', ['mkt1', 'mkt2', 'ins1'], '#f97316', 14);
    const release = project('Platform v2.4 Release', 'New quiz engine, video player fixes and student dashboard.', 'product', 'po', ['sys', 'qc', 'cs'], '#22c55e', 30);
    const support = project('Support Backlog Cleanup', 'Clear the backlog of open student tickets and update the FAQ.', 'customer_service', 'cs', ['cs1', 'cs2'], '#ec4899', 10);
    const audit = project('Q4 Content Quality Audit', 'Audit published lessons against the quality checklist.', 'systems_ops', 'sys', ['cq', 'qc', 'hoc'], '#14b8a6', 40, 'planning');

    const insTask = db.prepare(
      `INSERT INTO tasks (project_id, title, description, type, status, priority, assignee_id, reporter_id, reviewer_id, due_date, estimate_hours, tags, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insCheck = db.prepare('INSERT INTO checklist_items (task_id, text, done, position) VALUES (?, ?, ?, ?)');
    const insComment = db.prepare('INSERT INTO comments (task_id, user_id, body) VALUES (?, ?, ?)');
    const insActivity = db.prepare('INSERT INTO activity (task_id, project_id, user_id, action, detail) VALUES (?, ?, ?, ?, ?)');
    const task = (p, title, type, status, priority, assignee, reporter, due, opts = {}) => {
      const id = Number(
        insTask.run(
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
          status === 'done' ? new Date(Date.now() - (opts.doneAgo ?? 2) * 864e5).toISOString() : null,
        ).lastInsertRowid,
      );
      insActivity.run(id, p, ids[reporter], 'created', title);
      (opts.checklist || []).forEach(([text, done], i) => insCheck.run(id, text, done ? 1 : 0, i));
      (opts.comments || []).forEach(([who, body]) => insComment.run(id, ids[who], body));
      return id;
    };

    // Content
    task(physics, 'Record Lesson 1: Motion & Velocity', 'content', 'done', 'high', 'ins1', 'hoc', -6, { reviewer: 'cq', est: 6, tags: 'video,lesson', doneAgo: 5 });
    const lesson2 = task(physics, 'Record Lesson 2: Newton’s Laws', 'content', 'in_review', 'high', 'ins1', 'hoc', 1, {
      reviewer: 'cq',
      est: 6,
      tags: 'video,lesson',
      desc: 'Cover all three laws with real-world examples. Include a 5-question quiz at the end.',
      checklist: [['Script approved', true], ['Recording', true], ['Editing', true], ['Quiz questions uploaded', true]],
      comments: [['ins1', 'Uploaded the final cut — ready for QA.']],
    });
    task(physics, 'Record Lesson 3: Work & Energy', 'content', 'in_progress', 'medium', 'ins2', 'hoc', 5, {
      reviewer: 'cq',
      est: 6,
      tags: 'video,lesson',
      checklist: [['Script approved', true], ['Recording', false], ['Editing', false]],
    });
    task(physics, 'Write worksheet for Lessons 1–3', 'content', 'todo', 'medium', 'ins3', 'hoc', 8, { reviewer: 'cq', est: 4, tags: 'worksheet' });
    task(physics, 'Fix audio sync on Lesson 1 intro', 'content', 'blocked', 'urgent', 'ins2', 'cq', -1, {
      desc: 'Audio drifts ~0.5s behind video after 02:10.',
      comments: [['ins2', 'Waiting on the raw footage backup from Systems Ops.']],
    });
    task(physics, 'Approve Term 1 syllabus', 'content_review', 'done', 'high', 'hoc', 'ops', -12, { doneAgo: 11 });

    // Marketing
    task(campaign, 'Design social media creatives', 'campaign', 'in_progress', 'high', 'mkt1', 'mkt', 3, { reviewer: 'mkt', tags: 'social,design', est: 10 });
    task(campaign, 'Write email announcement sequence', 'campaign', 'todo', 'medium', 'mkt2', 'mkt', 6, { tags: 'email', est: 5 });
    task(campaign, 'Film teaser video with instructor', 'campaign', 'todo', 'high', 'ins1', 'mkt', 9, { tags: 'video', desc: 'A 30-second teaser for Physics 101.' });
    task(campaign, 'Launch paid ads', 'campaign', 'todo', 'urgent', 'mkt1', 'mkt', 12, { tags: 'ads' });
    task(campaign, 'Competitor pricing research', 'campaign', 'done', 'low', 'mkt2', 'mkt', -4, { doneAgo: 3 });

    // Product / systems
    task(release, 'Quiz engine: support image answers', 'feature', 'in_progress', 'high', 'po', 'po', 15, { tags: 'quiz', est: 16 });
    const safari = task(release, 'Video player freezes on Safari', 'bug', 'todo', 'urgent', 'sys', 'cs', 2, {
      reviewer: 'qc',
      tags: 'video,safari',
      desc: 'Reported by 14 students this week. Reproducible on Safari 17.',
      comments: [['cs', 'Raising this from the support queue — top complaint right now.']],
    });
    task(release, 'Regression test plan for v2.4', 'qc_check', 'todo', 'high', 'qc', 'sys', 20, { est: 8 });
    task(release, 'Student dashboard wireframes sign-off', 'feature', 'done', 'medium', 'po', 'ceo', -3, { doneAgo: 2 });

    // Customer service
    task(support, 'Answer refund tickets older than 3 days', 'support', 'in_progress', 'high', 'cs1', 'cs', 0, { tags: 'refunds' });
    task(support, 'Update FAQ: login & password reset', 'support', 'todo', 'medium', 'cs2', 'cs', 4, { reviewer: 'cs', tags: 'faq' });
    task(support, 'Weekly ticket summary for leadership', 'support', 'todo', 'low', 'cs', 'ceo', 2);
    task(support, 'Call back students with failed payments', 'support', 'done', 'high', 'cs2', 'cs', -2, { doneAgo: 1 });

    // Systems ops / QC
    task(audit, 'Define content quality checklist', 'qc_check', 'in_progress', 'high', 'cq', 'sys', 7, {
      checklist: [['Audio levels', true], ['Captions accuracy', false], ['Slide typos', false], ['Quiz answer key', false]],
    });
    task(audit, 'Spot-check 20 published lessons', 'qc_check', 'todo', 'medium', 'qc', 'sys', 18);
    task(null, 'Back up raw lesson footage to cold storage', 'operations', 'in_progress', 'high', 'sys', 'ops', 1, { tags: 'infra' });

    // Leadership
    task(null, 'Q4 budget review', 'operations', 'todo', 'high', 'ops', 'ceo', 6);
    task(null, 'Monthly all-hands agenda', 'general', 'todo', 'medium', 'ceo', 'ceo', 10);
    task(null, 'Hire two new instructors', 'operations', 'in_progress', 'medium', 'hoc', 'ops', 21, { tags: 'hiring' });

    // Customer Service call list
    const callList = Number(
      db
        .prepare('INSERT INTO call_lists (name, description, source_filename, columns, created_by) VALUES (?, ?, ?, ?, ?)')
        .run('Failed payments — October', 'Students whose card payment failed this month.', 'failed-payments-october.xlsx', JSON.stringify(['Name', 'Phone', 'Email', 'Course', 'Amount']), ids.cs)
        .lastInsertRowid,
    );
    const insCall = db.prepare('INSERT INTO calls (list_id, name, phone, email, data, assignee_id, status, notes, attempts, last_called_at, callback_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const insLog = db.prepare('INSERT INTO call_logs (call_id, user_id, status, note) VALUES (?, ?, ?, ?)');
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
      const cid = Number(
        insCall
          .run(callList, name, phone, email, JSON.stringify({ Name: name, Phone: phone, Email: email, Course: course, Amount: amount }), who ? ids[who] : null, status, note, called ? 1 : 0, called ? new Date().toISOString() : null, status === 'callback' ? tomorrow : null)
          .lastInsertRowid,
      );
      if (called) insLog.run(cid, ids[who], status, note);
    }

    const insNote = db.prepare('INSERT INTO notifications (user_id, type, message, task_id, params) VALUES (?, ?, ?, ?, ?)');
    insNote.run(ids.cq, 'review_requested', 'Nour Adel requested your review on "Record Lesson 2: Newton’s Laws"', lesson2, JSON.stringify({ actor: 'Nour Adel', title: 'Record Lesson 2: Newton’s Laws' }));
    insNote.run(ids.sys, 'assigned', 'Rana Kamal assigned you "Video player freezes on Safari"', safari, JSON.stringify({ actor: 'Rana Kamal', title: 'Video player freezes on Safari' }));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { DB_FILE } = await import('./config.js');
  if (process.argv.includes('--reset')) for (const f of [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`]) fs.rmSync(f, { force: true });
  const db = openDb(DB_FILE);
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) {
    console.log('Database already has data; use --reset to wipe it.');
  } else {
    seed(db);
    console.log(`Seeded demo organisation into ${DB_FILE}. Every account uses the password "${DEMO_PASSWORD}".`);
  }
}
