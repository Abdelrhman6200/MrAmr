// The audit log: who changed people, permissions, SOPs, deputies, leave,
// shifts and recurring work. Call it inside the transaction making the change.
export const audit = (q, user, action, entity, entityId = null, detail = {}) =>
  q.run('INSERT INTO audit_log (user_id, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)', [
    user?.id ?? null,
    action,
    entity,
    entityId,
    typeof detail === 'string' ? detail : JSON.stringify(detail),
  ]);
