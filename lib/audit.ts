import { insert, nowIso, uid } from "@/lib/db";

/** Append-only audit trail: every state change the user or system makes. */
export function audit(
  userId: string,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown> = {},
  actor = "user",
) {
  insert("audit_events", {
    id: uid(),
    user_id: userId,
    actor,
    action,
    entity_type: entityType,
    entity_id: entityId,
    metadata_json: JSON.stringify(metadata),
    created_at: nowIso(),
  });
}
