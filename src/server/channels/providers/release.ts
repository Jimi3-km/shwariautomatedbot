import { serviceClient } from '../../supabase.js';

/**
 * Let go of an account that another business has disconnected.
 *
 * One Instagram account, Facebook Page, WhatsApp number or Telegram bot can be
 * connected to one business at a time. Disconnecting keeps the channel's row
 * (its conversations still point at it) and only marks it disabled. That row
 * went on holding the account: connecting the same account to a different
 * business was refused as "already connected to another business", long after
 * it had been disconnected, and the refusal reached the person as a bare
 * "we couldn't finish connecting".
 *
 * Before a connection is saved, any DISCONNECTED row another business holds
 * for the same account gives up its claim: its account id is replaced with a
 * marker unique to that row, so the history stays and the account is free. A
 * row that is still ACTIVE elsewhere is left alone and still blocks, as it
 * should.
 *
 * Never throws: if this cannot be done the connection proceeds and the
 * ordinary "already connected" check answers.
 */
export async function releaseDisconnectedElsewhere(
  channelType: string,
  accountIds: Array<string | null | undefined>,
  tenantId: string
): Promise<number> {
  const ids = Array.from(new Set(accountIds.filter((v): v is string => typeof v === 'string' && v.length > 0)));
  if (!ids.length) return 0;
  try {
    const { data } = await serviceClient
      .from('channels')
      .select('id, tenant_id, status, channel_account_id')
      .eq('channel_type', channelType)
      .in('channel_account_id', ids);

    const stale = (Array.isArray(data) ? data : []).filter(
      (r) => r.tenant_id !== tenantId && r.status === 'disabled'
    );
    let released = 0;
    for (const row of stale) {
      const { error } = await serviceClient
        .from('channels')
        .update({ channel_account_id: `released:${row.id}`, credentials_ref: null })
        .eq('id', row.id)
        .eq('status', 'disabled');
      if (!error) released++;
    }
    if (released) {
      console.log(`[channels] released ${released} disconnected ${channelType} claim(s) held by another business`);
    }
    return released;
  } catch (e) {
    console.warn('[channels] could not release a disconnected claim:', e instanceof Error ? e.message : e);
    return 0;
  }
}
