// Hierarchy-based access rules.
//
// - The Head of Company (ceo) sees and can do everything.
// - Everyone else sees work that involves themselves or anyone in their
//   reporting line (direct and indirect reports), plus everything in projects
//   they own or are a member of.
// - Tasks can be assigned to yourself, your reporting line, or any manager
//   (so e.g. Customer Service can raise a bug with the Product Owner).
import { isManagerRole, USER_ADMIN_ROLES } from './meta.js';

export const isCeo = (user) => user.role === 'ceo';

export function makeAccess(db) {
  const allUsers = db.prepare('SELECT id, manager_id, role, active FROM users');
  const memberOf = db.prepare('SELECT project_id FROM project_members WHERE user_id = ?');
  const projectById = db.prepare('SELECT id, owner_id FROM projects WHERE id = ?');
  const isMember = db.prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?');

  function reportsOf(userId) {
    const rows = allUsers.all();
    const children = new Map();
    for (const r of rows) {
      if (r.manager_id == null) continue;
      if (!children.has(r.manager_id)) children.set(r.manager_id, []);
      children.get(r.manager_id).push(r.id);
    }
    const out = new Set();
    const stack = [...(children.get(userId) || [])];
    while (stack.length) {
      const id = stack.pop();
      if (out.has(id) || id === userId) continue;
      out.add(id);
      stack.push(...(children.get(id) || []));
    }
    return out;
  }

  // Self + everyone below in the org chart.
  const teamIds = (user) => new Set([user.id, ...reportsOf(user.id)]);

  const managesUser = (user, otherId) => isCeo(user) || reportsOf(user.id).has(otherId);

  // Would `newManagerId` as manager of `userId` create a reporting cycle?
  const wouldCycle = (userId, newManagerId) => newManagerId === userId || reportsOf(userId).has(newManagerId);

  function projectIdsFor(user) {
    const ids = new Set(memberOf.all(user.id).map((r) => r.project_id));
    const team = [...teamIds(user)];
    const owned = db.prepare(`SELECT id FROM projects WHERE owner_id IN (${team.map(() => '?').join(',')})`).all(...team);
    for (const r of owned) ids.add(r.id);
    return ids;
  }

  // Returns { sql, params } restricting a `tasks t` query to what the user may see.
  function taskScope(user) {
    if (isCeo(user)) return { sql: '1=1', params: [] };
    const team = [...teamIds(user)];
    const projects = [...projectIdsFor(user)];
    const ph = (arr) => (arr.length ? arr.map(() => '?').join(',') : 'NULL');
    return {
      sql: `(t.assignee_id IN (${ph(team)}) OR t.reporter_id IN (${ph(team)}) OR t.reviewer_id IN (${ph(team)}) OR t.project_id IN (${ph(projects)}))`,
      params: [...team, ...team, ...team, ...projects],
    };
  }

  function projectScope(user) {
    if (isCeo(user)) return { sql: '1=1', params: [] };
    const ids = [...projectIdsFor(user)];
    return { sql: ids.length ? `p.id IN (${ids.map(() => '?').join(',')})` : '0', params: ids };
  }

  function canViewProject(user, project) {
    return isCeo(user) || projectIdsFor(user).has(project.id);
  }

  function canManageProject(user, project) {
    return isCeo(user) || project.owner_id === user.id || reportsOf(user.id).has(project.owner_id);
  }

  function canViewTask(user, task) {
    if (isCeo(user)) return true;
    const team = teamIds(user);
    if ([task.assignee_id, task.reporter_id, task.reviewer_id].some((id) => id != null && team.has(id))) return true;
    return task.project_id != null && projectIdsFor(user).has(task.project_id);
  }

  function canEditTask(user, task) {
    if (isCeo(user)) return true;
    if ([task.assignee_id, task.reporter_id, task.reviewer_id].includes(user.id)) return true;
    const reports = reportsOf(user.id);
    if (reports.has(task.assignee_id) || reports.has(task.reporter_id)) return true;
    if (task.project_id != null) {
      const p = projectById.get(task.project_id);
      if (p && canManageProject(user, p)) return true;
    }
    return false;
  }

  function canDeleteTask(user, task) {
    if (isCeo(user) || task.reporter_id === user.id || reportsOf(user.id).has(task.reporter_id)) return true;
    if (task.project_id != null) {
      const p = projectById.get(task.project_id);
      if (p && canManageProject(user, p)) return true;
    }
    return false;
  }

  // Reviewer can approve; so can anyone managing the reviewer or the CEO.
  function canReviewTask(user, task) {
    if (task.reviewer_id == null) return false;
    return isCeo(user) || task.reviewer_id === user.id || reportsOf(user.id).has(task.reviewer_id);
  }

  function assignableIds(user, projectId = null) {
    const rows = allUsers.all().filter((r) => r.active);
    if (isCeo(user)) return new Set(rows.map((r) => r.id));
    const ids = teamIds(user);
    for (const r of rows) if (isManagerRole(r.role)) ids.add(r.id);
    if (projectId != null) {
      const p = projectById.get(projectId);
      if (p && (p.owner_id === user.id || isMember.get(projectId, user.id) || canManageProject(user, p))) {
        for (const r of db.prepare('SELECT user_id FROM project_members WHERE project_id = ?').all(projectId)) ids.add(r.user_id);
        ids.add(p.owner_id);
      }
    }
    const active = new Set(rows.map((r) => r.id));
    return new Set([...ids].filter((id) => active.has(id)));
  }

  const canAdminUsers = (user) => USER_ADMIN_ROLES.includes(user.role);

  return {
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
    assignableIds,
    canAdminUsers,
  };
}
