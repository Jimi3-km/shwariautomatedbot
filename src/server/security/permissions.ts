import type { Role } from '../auth.js';

/**
 * Enterprise Role-Based Access Control (RBAC) definitions.
 */
export type Permission =
  | 'settings:read'
  | 'settings:write'
  | 'catalog:read'
  | 'catalog:write'
  | 'catalog:delete'
  | 'orders:read'
  | 'orders:write'
  | 'payments:read'
  | 'payments:verify'
  | 'agents:configure'
  | 'conversations:read'
  | 'conversations:write';

const ROLE_PERMISSIONS: Record<Role, Set<Permission>> = {
  owner: new Set([
    'settings:read', 'settings:write',
    'catalog:read', 'catalog:write', 'catalog:delete',
    'orders:read', 'orders:write',
    'payments:read', 'payments:verify',
    'agents:configure',
    'conversations:read', 'conversations:write',
  ]),
  admin: new Set([
    'settings:read', 'settings:write',
    'catalog:read', 'catalog:write',
    'orders:read', 'orders:write',
    'payments:read', 'payments:verify',
    'agents:configure',
    'conversations:read', 'conversations:write',
  ]),
  member: new Set([
    'settings:read',
    'catalog:read',
    'orders:read', 'orders:write',
    'payments:read',
    'conversations:read', 'conversations:write',
  ]),
  viewer: new Set([
    'settings:read',
    'catalog:read',
    'orders:read',
    'payments:read',
    'conversations:read',
  ]),
};

export function hasPermission(role: Role, permission: Permission): boolean {
  const allowed = ROLE_PERMISSIONS[role];
  return allowed ? allowed.has(permission) : false;
}

/**
 * Maps AI tools to the minimum permission required if a human commands them.
 */
const TOOL_PERMISSIONS: Record<string, Permission> = {
  update_business_profile: 'settings:write',
  update_business_settings: 'settings:write',
  update_agent_settings: 'agents:configure',
  configure_agent: 'agents:configure',
  activate_agent: 'agents:configure',
  save_service: 'catalog:write',
  remove_service: 'catalog:delete',
  save_product: 'catalog:write',
  remove_product: 'catalog:delete',
  set_payment_instructions: 'settings:write',
  record_order: 'orders:write',
  update_order_status: 'orders:write',
  message_customer: 'conversations:write',
  set_conversation_handling: 'conversations:write',
};

export function canUserRunTool(role: Role, toolName: string): boolean {
  const required = TOOL_PERMISSIONS[toolName];
  if (!required) return true; // Read tools or non-destructive tools default to permitted
  return hasPermission(role, required);
}
