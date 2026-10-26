// Static domain definitions shared with the client via GET /api/meta.

export const DEPARTMENTS = {
  executive: { label: 'Executive', color: '#334155' },
  operations: { label: 'Operations', color: '#0ea5e9' },
  content: { label: 'Content', color: '#8b5cf6' },
  academic: { label: 'Academic Material', color: '#6366f1' },
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
  academic_head: { label: 'Head of Academic Material', department: 'academic', level: 'manager' },
  assistant: { label: 'Teaching Assistant', department: 'academic', level: 'member' },
  marketing_manager: { label: 'Marketing Manager', department: 'marketing', level: 'manager' },
  marketing_member: { label: 'Marketing Team Member', department: 'marketing', level: 'member' },
  sysops_manager: { label: 'Systems Operations Lead', department: 'systems_ops', level: 'manager' },
  content_quality: { label: 'Content Quality', department: 'systems_ops', level: 'member' },
  ops_qc: { label: 'Ops QC', department: 'systems_ops', level: 'member' },
  cs_head: { label: 'Head of Customer Service', department: 'customer_service', level: 'manager' },
  cs_member: { label: 'Customer Service Agent', department: 'customer_service', level: 'member' },
  product_owner: { label: 'Product Owner', department: 'product', level: 'manager' },
  platform_member: { label: 'Platform Team Member', department: 'product', level: 'member' },
};

// Roles allowed to create/edit user accounts.
export const USER_ADMIN_ROLES = ['ceo', 'ops_manager'];

// Roles that manage offline centers, availability rounds and center schedules.
export const CENTER_ADMIN_ROLES = ['ceo', 'ops_manager', 'head_of_content'];

// The working week starts on Saturday.
export const WEEKDAYS = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];

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
  // The online platform (Product): content uploads, exams, forums, complaints.
  { key: 'content_upload', label: 'Content upload', group: 'platform' },
  { key: 'platform_exam', label: 'Exam on the platform', group: 'platform' },
  { key: 'exam_results', label: 'Exam results', group: 'platform' },
  { key: 'forum_moderation', label: 'Forum moderation', group: 'platform' },
  { key: 'complaint', label: 'Student complaint', group: 'platform' },
  { key: 'bug', label: 'Platform Bug', group: 'platform' },
  { key: 'feature', label: 'Feature Request', group: 'platform' },
  { key: 'operations', label: 'Operations' },
  // Academic Material: the assistants' work, at the centers and on the platform.
  { key: 'hw_grading', label: 'Homework grading at a center', group: 'academic' },
  { key: 'exam_proctoring', label: 'Exam proctoring', group: 'academic' },
  { key: 'exam_grading', label: 'Exam grading at a center', group: 'academic' },
  { key: 'center_questions', label: 'Student questions at a center', group: 'academic' },
  { key: 'exam_papers', label: 'Writing exam papers', group: 'academic' },
  { key: 'exam_answers', label: 'Exam answers', group: 'academic' },
  { key: 'model_answer_review', label: 'Model answer review', group: 'academic' },
  { key: 'hw_model_answer', label: 'Homework model answer', group: 'academic' },
  { key: 'answer_key_review', label: 'Answer key review', group: 'academic' },
  { key: 'platform_questions', label: 'Student questions on the platform', group: 'academic' },
  { key: 'essay_grading', label: 'Essay grading on the platform', group: 'academic' },
  { key: 'weekly_duties', label: 'Weekly duties', group: 'academic' },
];

// Which curriculum a task is for (optional).
export const TRACKS = [
  { key: 'general', label: 'General Secondary' },
  { key: 'azhar', label: 'Azhar' },
  { key: 'baccalaureate', label: 'Baccalaureate' },
];

// Duties created every week (from Saturday) for everyone in these roles, as one
// task with a checklist, reviewed by their manager. Items are i18n keys.
export const WEEKLY_DUTIES = {
  assistant: ['weekly.book1', 'weekly.book2', 'weekly.book3', 'weekly.teacherBook', 'weekly.exam', 'weekly.attend'],
};

export const PROJECT_STATUSES = [
  { key: 'planning', label: 'Planning' },
  { key: 'active', label: 'Active' },
  { key: 'on_hold', label: 'On Hold' },
  { key: 'completed', label: 'Completed' },
  { key: 'archived', label: 'Archived' },
];

// Outcomes an agent can log on a call. `open` ones stay in the agent's queue.
export const CALL_STATUSES = [
  { key: 'pending', label: 'Not called yet', open: true },
  { key: 'no_answer', label: 'No answer', open: true },
  { key: 'callback', label: 'Call back later', open: true },
  { key: 'reached', label: 'Reached', open: false },
  { key: 'not_interested', label: 'Not interested', open: false },
  { key: 'wrong_number', label: 'Wrong number', open: false },
];

export const isRole = (r) => Object.hasOwn(ROLES, r);
export const levelOf = (role) => ROLES[role]?.level ?? 'member';
export const isManagerRole = (role) => levelOf(role) !== 'member';
export const departmentOf = (role) => ROLES[role]?.department;
export const keys = (list) => list.map((x) => x.key);
