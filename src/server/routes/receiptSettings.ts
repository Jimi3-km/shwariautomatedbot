import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import { serviceClient } from '../supabase.js';
import { requireAuth, requireAdmin, handler } from '../auth.js';
import {
  mergeReceiptSettings, receiptSettingsOf, storedReceiptSettings, ownMediaUrl,
} from '../services/receiptDesign.js';
import { renderReceiptPng } from '../services/receiptImage.js';

/**
 * How a business's receipts look: its letterhead or logo, the contact details
 * printed on them, a tax number, a closing note and a colour.
 *
 * Owners and managers change it; everyone in the business can see it. The
 * preview draws a sample receipt with exactly the renderer real receipts use.
 */
export const receiptSettingsRouter = Router();

const BUCKET = 'post-media';
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } });

const BUSINESS_FIELDS = 'business_name, address, currency, branding, contact_info, timezone';

async function loadBusiness(tenantId: string) {
  const { data } = await serviceClient.from('tenants').select(BUSINESS_FIELDS).eq('id', tenantId).maybeSingle();
  return data as any;
}

/** PNG or JPEG, decided by the file's own first bytes rather than its name. */
function imageType(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { mime: 'image/png', ext: 'png' };
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  return null;
}

function storagePathOf(url: string | null): string | null {
  const own = ownMediaUrl(url);
  if (!own) return null;
  const marker = `/object/public/${BUCKET}/`;
  const i = own.indexOf(marker);
  return i === -1 ? null : decodeURIComponent(own.slice(i + marker.length));
}

receiptSettingsRouter.get(
  '/receipt-settings',
  requireAuth,
  handler(async (req, res) => {
    const business = await loadBusiness(req.ctx!.tenantId);
    if (!business) return res.status(404).json({ error: 'Business not found' });
    res.json({
      business_name: business.business_name,
      // What the owner has set, and what a receipt will actually print once
      // the gaps are filled from the business's own details.
      settings: storedReceiptSettings(business),
      effective: receiptSettingsOf(business),
    });
  })
);

receiptSettingsRouter.put(
  '/receipt-settings',
  requireAuth,
  requireAdmin,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const business = await loadBusiness(ctx.tenantId);
    if (!business) return res.status(404).json({ error: 'Business not found' });

    const before = storedReceiptSettings(business);
    const receipt = mergeReceiptSettings(business, (req.body ?? {}) as Record<string, unknown>);
    const branding = { ...(business.branding ?? {}), receipt };
    const { error } = await serviceClient.from('tenants')
      .update({ branding, updated_at: new Date().toISOString() }).eq('id', ctx.tenantId);
    if (error) return res.status(500).json({ error: 'The receipt settings could not be saved.' });

    // A picture that was removed is deleted from storage too.
    for (const key of ['logo_url', 'letterhead_url'] as const) {
      if (req.body?.[key] === null && before[key]) {
        const path = storagePathOf(before[key]);
        if (path) await serviceClient.storage.from(BUCKET).remove([path]).catch(() => undefined);
      }
    }

    const after = { ...business, branding };
    res.json({ settings: storedReceiptSettings(after), effective: receiptSettingsOf(after) });
  })
);

/** Upload the logo or the letterhead banner. */
receiptSettingsRouter.post(
  '/receipt-settings/image',
  requireAuth,
  requireAdmin,
  (req: Request, res: Response, next) => {
    upload.single('file')(req, res, (err: unknown) => {
      if (!err) return next();
      const tooBig = (err as { code?: string })?.code === 'LIMIT_FILE_SIZE';
      res.status(400).json({ error: tooBig ? 'That picture is too large. Use one under 2 MB.' : 'That upload was not valid.' });
    });
  },
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const kind = req.body?.kind === 'letterhead' ? 'letterhead' : req.body?.kind === 'logo' ? 'logo' : null;
    const file = (req as Request & { file?: { buffer: Buffer } }).file;
    if (!kind) return res.status(400).json({ error: 'Say whether this is the logo or the letterhead.' });
    if (!file?.buffer?.length) return res.status(400).json({ error: 'Choose a picture to upload.' });

    const type = imageType(file.buffer);
    if (!type) return res.status(400).json({ error: 'Use a PNG or JPG picture.' });

    const business = await loadBusiness(ctx.tenantId);
    if (!business) return res.status(404).json({ error: 'Business not found' });
    const before = storedReceiptSettings(business);

    const path = `receipts/${ctx.tenantId}/${kind}-${Date.now()}.${type.ext}`;
    const storage = serviceClient.storage.from(BUCKET);
    const { error: upErr } = await storage.upload(path, file.buffer, { contentType: type.mime, upsert: false });
    if (upErr) {
      console.error('[receipt-settings] upload failed:', upErr.message);
      return res.status(500).json({ error: 'That picture could not be stored. Please try again.' });
    }
    const url = storage.getPublicUrl(path).data.publicUrl;

    const key = kind === 'logo' ? 'logo_url' : 'letterhead_url';
    const receipt = { ...((business.branding?.receipt ?? {}) as Record<string, unknown>), [key]: url };
    const branding = { ...(business.branding ?? {}), receipt };
    const { error } = await serviceClient.from('tenants')
      .update({ branding, updated_at: new Date().toISOString() }).eq('id', ctx.tenantId);
    if (error) {
      await storage.remove([path]).catch(() => undefined);
      return res.status(500).json({ error: 'The receipt settings could not be saved.' });
    }
    // The picture it replaces is no longer needed.
    const old = storagePathOf(before[key]);
    if (old && old !== path) await storage.remove([old]).catch(() => undefined);

    const after = { ...business, branding };
    res.status(201).json({ settings: storedReceiptSettings(after), effective: receiptSettingsOf(after) });
  })
);

/** A sample receipt, drawn exactly as a real one will be. */
receiptSettingsRouter.post(
  '/receipt-settings/preview',
  requireAuth,
  handler(async (req, res) => {
    const ctx = req.ctx!;
    const business = await loadBusiness(ctx.tenantId);
    if (!business) return res.status(404).json({ error: 'Business not found' });

    // Unsaved edits from the form are shown too, so the owner can look before saving.
    const draft = req.body && typeof req.body === 'object' && Object.keys(req.body).length
      ? { ...business, branding: { ...(business.branding ?? {}), receipt: mergeReceiptSettings(business, req.body as Record<string, unknown>) } }
      : business;
    const settings = receiptSettingsOf(draft);
    const currency = String(business.currency || 'KES').toUpperCase();
    const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

    const png = await renderReceiptPng({
      businessName: business.business_name || 'Your business',
      orderRef: 'ORD-00042',
      receiptNo: 'RCT-SAMPLE01',
      customerName: 'Sample Customer',
      customerPhone: '+254 700 000 000',
      items: [
        { name: 'First item on the order', qty: 2, price: 1500 },
        { name: 'Second item', qty: 1, price: 750 },
      ],
      amount: 3750,
      currency,
      method: 'M-Pesa',
      transactionCode: 'SAMPLE123',
      deliveryLocation: 'Customer delivery address',
      date: today,
      accent: settings.accent,
      settings,
    });
    if (!png) return res.status(503).json({ error: 'The preview could not be drawn just now.' });
    res.json({ image: `data:image/png;base64,${png.toString('base64')}` });
  })
);
