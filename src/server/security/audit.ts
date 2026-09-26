import { serviceClient } from '../supabase.js';

export interface AuditRecord {
  tenantId: string;
  actorId: string;
  actorType: 'user' | 'customer' | 'agent' | 'webhook' | 'system';
  agentRole?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Strips credit card details, full passwords, and sensitive keys from audit details. */
export function sanitizeAuditPayload(data?: Record<string, unknown>): Record<string, unknown> {
  if (!data) return {};
  const cleaned: Record<string, unknown> = {};
  const SENSITIVE_KEYS = /password|token|secret|access_key|cvv|authorization|cookie/i;

  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEYS.test(key)) {
      cleaned[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      cleaned[key] = sanitizeAuditPayload(value as Record<string, unknown>);
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

export async function logAuditEvent(record: AuditRecord): Promise<void> {
  try {
    const { error } = await serviceClient.from('audit_events').insert({
      tenant_id: record.tenantId,
      actor_id: record.actorId,
      actor_type: record.actorType,
      agent_role: record.agentRole || null,
      action: record.action,
      resource_type: record.resourceType,
      resource_id: record.resourceId || null,
      details: sanitizeAuditPayload(record.details),
      ip_address: record.ipAddress || null,
      user_agent: record.userAgent || null,
    });

    if (error && !error.message?.includes('unexpected request')) {
      console.warn('[audit] could not record audit event:', error.message);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('unexpected request')) {
      console.warn('[audit] unexpected error writing audit event:', msg);
    }
  }
}
