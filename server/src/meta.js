// Static domain definitions shared with the client via GET /api/meta.

export const DEPARTMENTS = {
  executive: { label: 'Executive', color: '#334155' },
  operations: { label: 'Operations', color: '#0ea5e9' },
  content: { label: 'Content', color: '#8b5cf6' },
  marketing: { label: 'Marketing', color: '#f97316' },
  systems_ops: { label: 'Systems Operations', color: '#14b8a6' },
  customer_service: { label: 'Customer Service', color: '#ec4899' },
  product: { label: 'Product', color: '#22c55e' },
};

// level: executive > manager > member. Managers can create projects and see
// their whole reporting line; members see their own work and shared projects.
export const ROLES = {
  ceo: { label: 'Head of Company', department: 'executive', level: 'executive' },
  ops_manager: { label: 'Operations Manager', department: 'operations', level: 'manager' },
  head_of_content: { label: 'Head of Content', department: 'content', level: 'manager' },
  instructor: { label: 'Instructor', department: 'content', level: 'member' },
  marketing_manager: { label: 'Marketing Manager', department: 'marketing', level: 'manager' },
  marketing_member: { label: 'Marketing Team Member', department: 'marketing', level: 'member' },
  sysops_manager: { label: 'Systems Operations Lead', department: 'systems_ops', level: 'manager' },
  content_quality: { label: 'Content Quality', department: 'systems_ops', level: 'member' },
  ops_qc: { label: 'Ops QC', department: 'systems_ops', level: 'member' },
  cs_head: { label: 'Head of Customer Service', department: 'customer_service', level: 'manager' },
  cs_member: { label: 'Customer Service Agent', department: 'customer_service', level: 'member' },
  product_owner: { label: 'Product Owner', department: 'product', level: 'manager' },
};

// Roles allowed to create/edit user accounts.
export const USER_ADMIN_ROLES = ['ceo', 'ops_manager'];

export const STATUSES = [
  { key: 'todo', label: 'To Do' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'in_review', label: 'In Review' },
  { key: 'done', label: 'Done' },
];

export const PRIORITIES = [
  { key: 'urgent', label: 'Urgent', weight: 4 },
  { key: 'high', label: 'High', weight: 3 },
  { key: 'medium', label: 'Medium', weight: 2 },
  { key: 'low', label: 'Low', weight: 1 },
];

export const TASK_TYPES = [
  { key: 'general', label: 'General' },
  { key: 'content', label: 'Content Creation' },
  { key: 'content_review', label: 'Content Review' },
  { key: 'qc_check', label: 'QC Check' },
  { key: 'campaign', label: 'Marketing Campaign' },
  { key: 'support', label: 'Customer Support' },
  { key: 'bug', label: 'Platform Bug' },
  { key: 'feature', label: 'Feature Request' },
  { key: 'operations', label: 'Operations' },
];

export const PROJECT_STATUSES = [
  { key: 'planning', label: 'Planning' },
  { key: 'active', label: 'Active' },
  { key: 'on_hold', label: 'On Hold' },
  { key: 'completed', label: 'Completed' },
  { key: 'archived', label: 'Archived' },
];

export const isRole = (r) => Object.hasOwn(ROLES, r);
export const levelOf = (role) => ROLES[role]?.level ?? 'member';
export const isManagerRole = (role) => levelOf(role) !== 'member';
export const departmentOf = (role) => ROLES[role]?.department;
export const keys = (list) => list.map((x) => x.key);
