// Hierarchy-based access rules.
//
// - The Head of Company (ceo) sees and can do everything.
// - Everyone else sees work that involves themselves or anyone in their
//   reporting line (direct and indirect reports), plus everything in projects
//   they own or are a member of.
// - Tasks can be assigned to yourself, your reporting line, or any manager
//   (so e.g. Customer Service can raise a bug with the Product Owner).
import { bump, readCounter } from './db.js';
import { isManagerRole, USER_ADMIN_ROLES } from './meta.js';

export const isCeo = (user) => user.role === 'ceo';

export function makeAccess(db) {
  // The org chart is cached in memory. Several server instances may run at once,
  // so a shared 'org' counter in the database (bumped by every user change) tells
  // each instance when its copy is stale; sync() checks it once per request.
  let org = null;
  let orgVersion = -1;

  // `known`: the current version if the caller already read it (saves a round trip).
  async function sync(known) {
    const version = known ?? (await readCounter(db, 'org'));
    if (org && version === orgVersion) return;
    const rows = await db.all('SELECT id, manager_id, role, active FROM users');
    const children = new Map();
    for (const r of rows) {
      if (r.manager_id == null) continue;
      if (!children.has(r.manager_id)) children.set(r.manager_id, []);
      children.get(r.manager_id).push(r.id);
    }
    org = { rows, children, reports: new Map() };
    orgVersion = version;
  }

  // Call inside the transaction that changes users.
  async function invalidate(q = db) {
    await bump(q, 'org');
    org = null;
  }

  const chart = () => {
    if (!org) throw new Error('access.sync() must run before permission checks');
    return org;
  };

  // Everyone below userId in the org chart. Returned sets are shared: don't mutate.
  function reportsOf(userId) {
    const { children, reports } = chart();
    if (reports.has(userId)) return reports.get(userId);
    const out = new Set();
    const stack = [...(children.get(userId) || [])];
    while (stack.length) {
      const id = stack.pop();
      if (out.has(id) || id === userId) continue;
      out.add(id);
      stack.push(...(children.get(id) || []));
    }
    reports.set(userId, out);
    return out;
  }

  // Self + everyone below in the org chart.
  const teamIds = (user) => new Set([user.id, ...reportsOf(user.id)]);

  const managesUser = (user, otherId) => isCeo(user) || reportsOf(user.id).has(otherId);

  // Would `newManagerId` as manager of `userId` create a reporting cycle?
  const wouldCycle = (userId, newManagerId) => newManagerId === userId || reportsOf(userId).has(newManagerId);

  const projectById = (id) => db.get('SELECT id, owner_id FROM projects WHERE id = ?', [id]);

  async function projectIdsFor(user) {
    const rows = await db.all(
      `SELECT project_id AS id FROM project_members WHERE user_id = ?
       UNION SELECT id FROM projects WHERE owner_id = ANY(?::int[])`,
      [user.id, [...teamIds(user)]],
    );
    return new Set(rows.map((r) => r.id));
  }

  // Returns { sql, params } restricting a `tasks t` query to what the user may see.
  async function taskScope(user) {
    if (isCeo(user)) return { sql: 'TRUE', params: [] };
    const team = [...teamIds(user)];
    const projects = [...(await projectIdsFor(user))];
    return {
      sql: '(t.assignee_id = ANY(?::int[]) OR t.reporter_id = ANY(?::int[]) OR t.reviewer_id = ANY(?::int[]) OR t.project_id = ANY(?::int[]))',
      params: [team, team, team, projects],
    };
  }

  async function projectScope(user) {
    if (isCeo(user)) return { sql: 'TRUE', params: [] };
    return { sql: 'p.id = ANY(?::int[])', params: [[...(await projectIdsFor(user))]] };
  }

  async function canViewProject(user, project) {
    return isCeo(user) || (await projectIdsFor(user)).has(project.id);
  }

  function canManageProject(user, project) {
    return isCeo(user) || project.owner_id === user.id || reportsOf(user.id).has(project.owner_id);
  }

  async function managesTaskProject(user, task) {
    if (task.project_id == null) return false;
    const p = await projectById(task.project_id);
    return !!p && canManageProject(user, p);
  }

  async function canViewTask(user, task) {
    if (isCeo(user)) return true;
    const team = teamIds(user);
    if ([task.assignee_id, task.reporter_id, task.reviewer_id].some((id) => id != null && team.has(id))) return true;
    return task.project_id != null && (await projectIdsFor(user)).has(task.project_id);
  }

  async function canEditTask(user, task) {
    if (isCeo(user)) return true;
    if ([task.assignee_id, task.reporter_id, task.reviewer_id].includes(user.id)) return true;
    const reports = reportsOf(user.id);
    if (reports.has(task.assignee_id) || reports.has(task.reporter_id)) return true;
    return managesTaskProject(user, task);
  }

  async function canDeleteTask(user, task) {
    if (isCeo(user) || task.reporter_id === user.id || reportsOf(user.id).has(task.reporter_id)) return true;
    return managesTaskProject(user, task);
  }

  // Who may change or remove a task's reviewer once one is set. The assignee alone
  // may not, otherwise they could drop the review and mark their own work done.
  // Adding a reviewer to a task without one only needs edit rights.
  async function canChangeReviewer(user, task) {
    if (task.reviewer_id == null) return canEditTask(user, task);
    if (isCeo(user) || task.reporter_id === user.id || task.reviewer_id === user.id) return true;
    if (task.assignee_id != null && reportsOf(user.id).has(task.assignee_id)) return true;
    return managesTaskProject(user, task);
  }

  // Reviewer can approve; so can anyone managing the reviewer or the CEO.
  function canReviewTask(user, task) {
    if (task.reviewer_id == null) return false;
    return isCeo(user) || task.reviewer_id === user.id || reportsOf(user.id).has(task.reviewer_id);
  }

  async function assignableIds(user, projectId = null) {
    const rows = chart().rows.filter((r) => r.active);
    const active = new Set(rows.map((r) => r.id));
    if (isCeo(user)) return active;
    const ids = teamIds(user);
    for (const r of rows) if (isManagerRole(r.role)) ids.add(r.id);
    if (projectId != null) {
      const p = await projectById(projectId);
      const member = p && (await db.get('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?', [projectId, user.id]));
      if (p && (p.owner_id === user.id || member || canManageProject(user, p))) {
        for (const r of await db.all('SELECT user_id FROM project_members WHERE project_id = ?', [projectId])) ids.add(r.user_id);
        ids.add(p.owner_id);
      }
    }
    return new Set([...ids].filter((id) => active.has(id)));
  }

  const canAdminUsers = (user) => USER_ADMIN_ROLES.includes(user.role);

  return {
    sync,
    invalidate,
    reportsOf,
    teamIds,
    managesUser,
    wouldCycle,
    taskScope,
    projectScope,
    canViewProject,
    canManageProject,
    canViewTask,
    canEditTask,
    canDeleteTask,
    canReviewTask,
    canChangeReviewer,
    assignableIds,
    canAdminUsers,
  };
}
