import { serviceClient } from '../supabase.js';
import { INSTAGRAM_GRAPH_URL, META_GRAPH_URL } from '../config/meta.js';
import { loadToken } from '../services/meta/tokens.js';
import { loadConnectedPage, sendMessengerImage } from '../services/meta/facebook.js';

/**
 * Sending a picture to a customer.
 *
 * Every chat platform takes a photo by URL: we give it the address and it
 * fetches the image itself. Web chat has no outbound API at all, so there the
 * caller attaches the address to the transcript row instead.
 *
 * Returns whether the photo was accepted. Never throws: a photo is an extra on
 * top of a message that has already been sent as text.
 */
export async function sendImageToCustomer(input: {
  tenantId: string;
  channelType: string;
  channelId: string | null;
  customerId: string;
  imageUrl: string;
  caption?: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const caption = (input.caption ?? '').slice(0, 900);
  try {
    switch (input.channelType) {
      case 'telegram': {
        if (!input.channelId) return { sent: false, reason: 'no channel' };
        const { data } = await serviceClient
          .from('channels').select('bot_token')
          .eq('id', input.channelId).eq('tenant_id', input.tenantId).maybeSingle();
        const token = (data as any)?.bot_token;
        if (!token) return { sent: false, reason: 'Telegram is not connected.' };
        const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: input.customerId, photo: input.imageUrl, ...(caption ? { caption } : {}) }),
          signal: AbortSignal.timeout(20_000),
        });
        return res.ok ? { sent: true } : { sent: false, reason: `Telegram refused the photo (HTTP ${res.status}).` };
      }

      case 'instagram': {
        const token = await loadToken(input.tenantId, 'instagram');
        if (!token?.instagramUserId || token.isExpired) return { sent: false, reason: 'Instagram is not connected.' };
        const res = await fetch(`${INSTAGRAM_GRAPH_URL}/${token.instagramUserId}/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token.accessToken}` },
          body: JSON.stringify({
            recipient: { id: input.customerId },
            message: { attachment: { type: 'image', payload: { url: input.imageUrl } } },
          }),
          signal: AbortSignal.timeout(20_000),
        });
        return res.ok ? { sent: true } : { sent: false, reason: `Instagram refused the photo (HTTP ${res.status}).` };
      }

      case 'facebook': {
        const page = await loadConnectedPage(input.tenantId);
        if (!page || page.isExpired) return { sent: false, reason: 'The Facebook Page is not connected.' };
        try {
          await sendMessengerImage(page.accessToken, page.pageId, input.customerId, input.imageUrl);
          return { sent: true };
        } catch (e) {
          const status = (e as { httpStatus?: number } | null)?.httpStatus;
          return { sent: false, reason: `Facebook refused the photo${status ? ` (HTTP ${status})` : ''}.` };
        }
      }

      case 'whatsapp': {
        const token = await loadToken(input.tenantId, 'whatsapp');
        const { data } = await serviceClient
          .from('meta_tokens').select('phone_number_id')
          .eq('tenant_id', input.tenantId).eq('platform', 'whatsapp').maybeSingle();
        const phoneNumberId = (data as any)?.phone_number_id;
        if (!token || token.isExpired || !phoneNumberId) return { sent: false, reason: 'WhatsApp is not connected.' };
        const res = await fetch(`${META_GRAPH_URL}/${phoneNumberId}/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token.accessToken}` },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: input.customerId,
            type: 'image',
            image: { link: input.imageUrl, ...(caption ? { caption } : {}) },
          }),
          signal: AbortSignal.timeout(20_000),
        });
        return res.ok ? { sent: true } : { sent: false, reason: `WhatsApp refused the photo (HTTP ${res.status}).` };
      }

      default:
        return { sent: false, reason: 'This channel cannot receive photos.' };
    }
  } catch (e) {
    console.warn('[media] photo send failed:', e instanceof Error ? e.message : e);
    return { sent: false, reason: 'The photo could not be sent.' };
  }
}

/**
 * Sending a file (a PDF invoice or receipt) to a customer.
 *
 * Like a photo, every platform takes it by URL. Web chat has no outbound API,
 * so there the caller puts the address on the transcript row instead.
 * Never throws; says why when the platform refuses.
 */
export async function sendDocumentToCustomer(input: {
  tenantId: string;
  channelType: string;
  channelId: string | null;
  customerId: string;
  fileUrl: string;
  filename: string;
  caption?: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const caption = (input.caption ?? '').slice(0, 900);
  const filename = input.filename.replace(/[^\w.\- ]+/g, '_').slice(0, 80) || 'document.pdf';
  try {
    switch (input.channelType) {
      case 'telegram': {
        if (!input.channelId) return { sent: false, reason: 'no channel' };
        const { data } = await serviceClient
          .from('channels').select('bot_token')
          .eq('id', input.channelId).eq('tenant_id', input.tenantId).maybeSingle();
        const token = (data as any)?.bot_token;
        if (!token) return { sent: false, reason: 'Telegram is not connected.' };
        // Telegram names a fetched file after the last part of its address, so
        // the file is uploaded with its proper name instead.
        const file = await fetch(input.fileUrl, { signal: AbortSignal.timeout(15_000) });
        if (!file.ok) return { sent: false, reason: 'The file could not be prepared.' };
        const form = new FormData();
        form.append('chat_id', input.customerId);
        if (caption) form.append('caption', caption);
        form.append('document', new Blob([await file.arrayBuffer()], { type: 'application/pdf' }), filename);
        const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, {
          method: 'POST', body: form, signal: AbortSignal.timeout(25_000),
        });
        return res.ok ? { sent: true } : { sent: false, reason: `Telegram refused the file (HTTP ${res.status}).` };
      }

      case 'whatsapp': {
        const token = await loadToken(input.tenantId, 'whatsapp');
        if (!token || token.isExpired || !token.phoneNumberId) return { sent: false, reason: 'WhatsApp is not connected.' };
        const res = await fetch(`${META_GRAPH_URL}/${token.phoneNumberId}/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token.accessToken}` },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: input.customerId,
            type: 'document',
            document: { link: input.fileUrl, filename, ...(caption ? { caption } : {}) },
          }),
          signal: AbortSignal.timeout(20_000),
        });
        return res.ok ? { sent: true } : { sent: false, reason: `WhatsApp refused the file (HTTP ${res.status}).` };
      }

      case 'instagram': {
        const token = await loadToken(input.tenantId, 'instagram');
        if (!token?.instagramUserId || token.isExpired) return { sent: false, reason: 'Instagram is not connected.' };
        const res = await fetch(`${INSTAGRAM_GRAPH_URL}/${token.instagramUserId}/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${token.accessToken}` },
          body: JSON.stringify({
            recipient: { id: input.customerId },
            message: { attachment: { type: 'file', payload: { url: input.fileUrl } } },
          }),
          signal: AbortSignal.timeout(20_000),
        });
        return res.ok ? { sent: true } : { sent: false, reason: `Instagram refused the file (HTTP ${res.status}).` };
      }

      case 'facebook': {
        const page = await loadConnectedPage(input.tenantId);
        if (!page || page.isExpired) return { sent: false, reason: 'The Facebook Page is not connected.' };
        const res = await fetch(`${META_GRAPH_URL}/${encodeURIComponent(page.pageId)}/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${page.accessToken}` },
          body: JSON.stringify({
            recipient: { id: input.customerId },
            messaging_type: 'RESPONSE',
            message: { attachment: { type: 'file', payload: { url: input.fileUrl, is_reusable: false } } },
          }),
          signal: AbortSignal.timeout(20_000),
        });
        return res.ok ? { sent: true } : { sent: false, reason: `Facebook refused the file (HTTP ${res.status}).` };
      }

      default:
        return { sent: false, reason: 'This channel cannot receive files.' };
    }
  } catch (e) {
    console.warn('[media] file send failed:', e instanceof Error ? e.message : e);
    return { sent: false, reason: 'The file could not be sent.' };
  }
}
