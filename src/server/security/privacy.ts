import { serviceClient } from '../supabase.js';

/**
 * Kenya Data Protection Act (2019) & GDPR Compliance Utilities.
 * Supports Data Subject Access Requests (DSAR) and Right to Erasure.
 */

export interface TenantExport {
  tenant: Record<string, unknown> | null;
  services: unknown[];
  products: unknown[];
  appointments: unknown[];
  orders: unknown[];
  leads: unknown[];
  tickets: unknown[];
  exportedAt: string;
}

/** Export all operational records belonging to a tenant (Data Portability). */
export async function exportTenantData(tenantId: string): Promise<TenantExport> {
  const [
    { data: tenant },
    { data: services },
    { data: products },
    { data: appointments },
    { data: orders },
    { data: leads },
    { data: tickets },
  ] = await Promise.all([
    serviceClient.from('tenants').select('*').eq('id', tenantId).maybeSingle(),
    serviceClient.from('services').select('*').eq('tenant_id', tenantId),
    serviceClient.from('products').select('*').eq('tenant_id', tenantId),
    serviceClient.from('appointments').select('*').eq('tenant_id', tenantId),
    serviceClient.from('orders').select('*').eq('tenant_id', tenantId),
    serviceClient.from('leads').select('*').eq('tenant_id', tenantId),
    serviceClient.from('support_tickets').select('*').eq('tenant_id', tenantId),
  ]);

  return {
    tenant: tenant ?? null,
    services: services ?? [],
    products: products ?? [],
    appointments: appointments ?? [],
    orders: orders ?? [],
    leads: leads ?? [],
    tickets: tickets ?? [],
    exportedAt: new Date().toISOString(),
  };
}

/** Pseudonymize/anonymize a customer across all tables upon Right of Erasure request. */
export async function anonymizeCustomer(tenantId: string, leadId: number): Promise<{ anonymized: boolean }> {
  const anonName = `Redacted Customer #${leadId}`;
  const anonPhone = null;
  const anonEmail = null;

  // 1. Update lead record
  await serviceClient
    .from('leads')
    .update({
      customer_name: anonName,
      phone: anonPhone,
      email: anonEmail,
      metadata: {},
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
    .eq('id', leadId);

  // 2. Anonymize appointments
  await serviceClient
    .from('appointments')
    .update({
      customer_name: anonName,
      notes: '[Redacted under Data Subject Erasure Request]',
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
    .eq('lead_id', leadId);

  // 3. Anonymize orders
  await serviceClient
    .from('orders')
    .update({
      delivery_location: '[Redacted]',
      updated_at: new Date().toISOString(),
    })
    .eq('tenant_id', tenantId)
    .eq('lead_id', leadId);

  return { anonymized: true };
}
