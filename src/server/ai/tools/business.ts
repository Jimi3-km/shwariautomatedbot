import { serviceClient } from '../../supabase.js';
import { ToolInputError, str, num, bool, oneOf, type Tool } from './types.js';

/**
 * Tools that read and shape the business itself: profile, services, opening
 * hours and durable business facts.
 *
 * Every write here is the outcome of the owner saying something in plain
 * English. That is the point of the layer — the owner describes the clinic and
 * these tools turn the description into rows other agents can rely on.
 */

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export const getBusinessProfile: Tool = {
  name: 'get_business_profile',
  description:
    'Read what is currently known about the business: name, what it does, category, timezone and currency. Call this before answering questions about the business or before changing anything.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  mutates: false,

  async run(_args, ctx) {
    const { data } = await serviceClient
      .from('tenants')
      .select('business_name, business_category, business_description, agent_name, timezone, currency, onboarding_completed_at')
      .eq('id', ctx.tenantId)
      .single();

    return {
      business_name: data?.business_name ?? null,
      category: data?.business_category ?? null,
      description: data?.business_description ?? null,
      assistant_name: data?.agent_name ?? null,
      timezone: data?.timezone ?? null,
      currency: data?.currency ?? null,
      live: Boolean(data?.onboarding_completed_at),
    };
  },
};

export const updateBusinessProfile: Tool = {
  name: 'update_business_profile',
  description:
    'Update the business profile. Only send the fields the owner actually told you about; anything you omit is left alone.',
  parameters: {
    type: 'object',
    properties: {
      business_name: { type: 'string', description: 'The trading name of the business.' },
      category: { type: 'string', description: 'Short category, e.g. dental clinic, salon, electronics shop.' },
      description: { type: 'string', description: 'A paragraph describing what the business does and who it serves.' },
      timezone: { type: 'string', description: 'IANA timezone, e.g. Africa/Nairobi.' },
      currency: { type: 'string', description: 'Three-letter code, e.g. KES.' },
    },
    additionalProperties: false,
  },
  mutates: true,

  async run(args, ctx) {
    const patch: Record<string, unknown> = {};
    const name = str(args, 'business_name', { max: 120 });
    const category = str(args, 'category', { max: 80 });
    const description = str(args, 'description', { max: 2000 });
    const timezone = str(args, 'timezone', { max: 64 });
    // Not truncated to three characters before checking: "shillings" would
    // clip to "SHI", pass the pattern, and store a currency nobody named.
    const currency = str(args, 'currency', { max: 40 }).toUpperCase();

    if (name) patch.business_name = name;
    if (category) patch.business_category = category;
    if (description) patch.business_description = description;
    if (timezone) {
      // A bad timezone would silently misreport opening hours forever, so it is
      // checked against the platform's own database rather than a regex.
      try {
        new Intl.DateTimeFormat('en', { timeZone: timezone });
      } catch {
        throw new ToolInputError(`${timezone} is not a recognised timezone. Ask the owner for their city instead.`);
      }
      patch.timezone = timezone;
    }
    if (currency) {
      if (!/^[A-Z]{3}$/.test(currency)) throw new ToolInputError('currency must be a three-letter code such as KES.');
      patch.currency = currency;
    }

    if (!Object.keys(patch).length) throw new ToolInputError('Nothing to update. Send at least one field.');

    const { error } = await serviceClient.from('tenants').update(patch).eq('id', ctx.tenantId);
    if (error) throw new Error(error.message);

    return { updated: Object.keys(patch) };
  },
};

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export const listServices: Tool = {
  name: 'list_services',
  description: 'List the services this business offers, with prices and whether each can be booked directly.',
  parameters: {
    type: 'object',
    properties: {
      include_inactive: { type: 'boolean', description: 'Include services that have been switched off.' },
    },
    additionalProperties: false,
  },
  mutates: false,

  async run(args, ctx) {
    let q = serviceClient
      .from('services')
      .select('id, name, description, price_amount, price_note, duration_minutes, booking_mode, active')
      .eq('tenant_id', ctx.tenantId)
      .order('name');

    if (!bool(args, 'include_inactive', false)) q = q.eq('active', true);

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return { services: data ?? [] };
  },
};

export const saveService: Tool = {
  name: 'save_service',
  description:
    'Create a service, or update it if one with the same name already exists. booking_mode is important: use "direct" when a customer can book it outright, "consultation" when a consultation must happen first, and "enquiry" when staff handle it case by case. Leave the price out entirely if the owner has not given you one — never estimate.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The service name as a customer would say it.' },
      description: { type: 'string' },
      price_amount: { type: 'number', description: 'Numeric price in the business currency. Omit if not fixed.' },
      price_note: { type: 'string', description: 'Free text such as "from 5,000" or "depends on the case".' },
      duration_minutes: { type: 'number' },
      booking_mode: { type: 'string', enum: ['direct', 'consultation', 'enquiry'] },
      active: { type: 'boolean' },
    },
    required: ['name'],
    additionalProperties: false,
  },
  mutates: true,

  async run(args, ctx) {
    const name = str(args, 'name', { required: true, max: 120 });
    const price = num(args, 'price_amount');
    if (price !== null && price < 0) throw new ToolInputError('price_amount cannot be negative.');
    const duration = num(args, 'duration_minutes');

    const row = {
      tenant_id: ctx.tenantId,
      name,
      description: str(args, 'description', { max: 2000 }),
      price_amount: price,
      price_note: str(args, 'price_note', { max: 200 }) || null,
      duration_minutes: duration === null ? null : Math.round(duration),
      booking_mode: oneOf(args, 'booking_mode', ['direct', 'consultation', 'enquiry'] as const, 'enquiry'),
      active: bool(args, 'active', true),
      updated_at: new Date().toISOString(),
    };

    // The unique index is on lower(name), so matching is done the same way
    // rather than relying on the owner retyping the exact capitalisation.
    const { data: existing } = await serviceClient
      .from('services')
      .select('id')
      .eq('tenant_id', ctx.tenantId)
      .ilike('name', name)
      .maybeSingle();

    const { data, error } = existing
      ? await serviceClient.from('services').update(row).eq('id', existing.id)
          .eq('tenant_id', ctx.tenantId).select('id, name, booking_mode').single()
      : await serviceClient.from('services').insert(row).select('id, name, booking_mode').single();

    if (error) throw new Error(error.message);
    return { saved: data, created: !existing };
  },
};

export const removeService: Tool = {
  name: 'remove_service',
  description:
    'Stop offering a service. It is switched off rather than deleted, so past conversations and orders still make sense.',
  parameters: {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
    additionalProperties: false,
  },
  mutates: true,

  async run(args, ctx) {
    const name = str(args, 'name', { required: true, max: 120 });
    const { data, error } = await serviceClient
      .from('services')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('tenant_id', ctx.tenantId)
      .ilike('name', name)
      .select('id, name');

    if (error) throw new Error(error.message);
    if (!data?.length) throw new ToolInputError(`There is no service called "${name}". List the services first.`);
    return { deactivated: data.map((d) => d.name) };
  },
};

// ---------------------------------------------------------------------------
// Opening hours
// ---------------------------------------------------------------------------

export const getOpeningHours: Tool = {
  name: 'get_opening_hours',
  description:
    'Read the opening hours. A day that is missing from the result is genuinely unknown — say so rather than assuming the business is closed.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  mutates: false,

  async run(_args, ctx) {
    const { data, error } = await serviceClient
      .from('business_hours')
      .select('day_of_week, closed, opens, closes, note')
      .eq('tenant_id', ctx.tenantId)
      .order('day_of_week');
    if (error) throw new Error(error.message);

    const known = (data ?? []).map((r) => ({
      day: DAYS[r.day_of_week], closed: r.closed, opens: r.opens, closes: r.closes, note: r.note,
    }));
    const unknown = DAYS.filter((_, i) => !(data ?? []).some((r) => r.day_of_week === i));
    return { hours: known, unknown_days: unknown };
  },
};

export const setOpeningHours: Tool = {
  name: 'set_opening_hours',
  description:
    'Set the opening hours for one or more days. Send only the days the owner mentioned. Use closed: true for a day the business does not open.',
  parameters: {
    type: 'object',
    properties: {
      days: {
        type: 'array',
        description: 'One entry per day being set.',
        items: {
          type: 'object',
          properties: {
            day: {
              type: 'string',
              enum: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
            },
            closed: { type: 'boolean' },
            opens: { type: 'string', description: '24-hour time, e.g. 08:30' },
            closes: { type: 'string', description: '24-hour time, e.g. 17:00' },
            note: { type: 'string', description: 'Anything qualifying, e.g. "emergencies only".' },
          },
          required: ['day'],
        },
      },
    },
    required: ['days'],
    additionalProperties: false,
  },
  mutates: true,

  async run(args, ctx) {
    const days = args.days;
    if (!Array.isArray(days) || !days.length) throw new ToolInputError('days must be a non-empty array.');
    if (days.length > 7) throw new ToolInputError('There are only seven days in a week.');

    const rows = days.map((raw) => {
      const entry = (raw ?? {}) as Record<string, unknown>;
      const dayName = str(entry, 'day', { required: true, lower: true });
      const index = DAYS.findIndex((d) => d.toLowerCase() === dayName);
      if (index === -1) throw new ToolInputError(`"${dayName}" is not a day of the week.`);

      const closed = bool(entry, 'closed', false);
      const opens = closed ? null : time(entry, 'opens');
      const closes = closed ? null : time(entry, 'closes');
      if (!closed && (!opens || !closes)) {
        throw new ToolInputError(`${DAYS[index]} needs both an opening and a closing time, or closed: true.`);
      }

      return {
        tenant_id: ctx.tenantId,
        day_of_week: index,
        closed,
        opens,
        closes,
        note: str(entry, 'note', { max: 200 }) || null,
        updated_at: new Date().toISOString(),
      };
    });

    const { error } = await serviceClient
      .from('business_hours')
      .upsert(rows, { onConflict: 'tenant_id,day_of_week' });
    if (error) throw new Error(error.message);

    return { set: rows.map((r) => DAYS[r.day_of_week]) };
  },
};

/** Accepts "9", "9am", "09:00", "17.30" and normalises to HH:MM. */
function time(entry: Record<string, unknown>, key: string): string | null {
  const raw = str(entry, key, { lower: true }).replace(/\s+/g, '');
  if (!raw) return null;

  const m = raw.match(/^(\d{1,2})(?:[:.](\d{2}))?(am|pm)?$/);
  if (!m) throw new ToolInputError(`"${raw}" is not a time. Use 24-hour form such as 08:30.`);

  let hour = Number(m[1]);
  const minute = Number(m[2] ?? '0');
  const suffix = m[3];

  if (suffix === 'pm' && hour < 12) hour += 12;
  if (suffix === 'am' && hour === 12) hour = 0;

  if (hour > 23 || minute > 59) throw new ToolInputError(`"${raw}" is not a valid time.`);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Business facts
// ---------------------------------------------------------------------------

const FACT_CATEGORIES = [
  'policy', 'payment', 'delivery', 'location', 'contact', 'offering', 'general',
] as const;

export const searchBusinessKnowledge: Tool = {
  name: 'search_business_knowledge',
  description:
    'Look up what the business has told us — policies, payment terms, delivery, location, anything previously recorded. Use this before answering a factual question. If it returns nothing, you do not know the answer.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Words the answer would contain, e.g. "refund" or "parking".' },
      category: { type: 'string', enum: [...FACT_CATEGORIES] },
    },
    additionalProperties: false,
  },
  mutates: false,

  async run(args, ctx) {
    const query = str(args, 'query', { max: 200 });
    const category = str(args, 'category', { lower: true });

    let q = serviceClient
      .from('business_facts')
      .select('category, fact_key, value, source, updated_at')
      .eq('tenant_id', ctx.tenantId)
      .order('updated_at', { ascending: false })
      .limit(25);

    if (category) q = q.eq('category', category);
    if (query) {
      // Retrieval is a keyword match over a deliberately small, structured set.
      // Semantic search would be the answer for a large document corpus; this
      // is dozens of curated facts, where an embedding index would add
      // infrastructure without adding recall.
      const escaped = query.replace(/[%,()]/g, ' ').trim();
      if (escaped) q = q.or(`fact_key.ilike.%${escaped}%,value.ilike.%${escaped}%`);
    }

    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return { facts: data ?? [], found: (data ?? []).length };
  },
};

export const saveBusinessFact: Tool = {
  name: 'save_business_fact',
  description:
    'Record something durable the owner has told you, so every agent can rely on it later. Use this for policies, payment and delivery terms, location and anything a customer might ask. Only record what the owner actually said — never your own assumption.',
  parameters: {
    type: 'object',
    properties: {
      category: { type: 'string', enum: [...FACT_CATEGORIES] },
      key: {
        type: 'string',
        description: 'A short stable slug for the fact, e.g. sunday_hours, refund_window, parking.',
      },
      value: { type: 'string', description: 'The answer, in the owner\'s own terms.' },
    },
    required: ['key', 'value'],
    additionalProperties: false,
  },
  mutates: true,

  async run(args, ctx) {
    const key = str(args, 'key', { required: true, max: 80, lower: true }).replace(/[^a-z0-9]+/g, '_');
    const value = str(args, 'value', { required: true, max: 2000 });
    const category = oneOf(args, 'category', FACT_CATEGORIES, 'general');

    const { error } = await serviceClient.from('business_facts').upsert(
      {
        tenant_id: ctx.tenantId,
        category,
        fact_key: key,
        value,
        // An agent recording something on the owner's behalf is still the
        // owner's statement; anything the model concluded by itself would be
        // 'inferred', and no tool lets it claim otherwise.
        source: 'owner',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,category,fact_key' }
    );
    if (error) throw new Error(error.message);

    // Answering a fact usually closes a gap someone asked about.
    await serviceClient
      .from('knowledge_gaps')
      .update({ status: 'answered', resolution: value, updated_at: new Date().toISOString() })
      .eq('tenant_id', ctx.tenantId)
      .eq('status', 'asked')
      .ilike('question', `%${key.replace(/_/g, ' ')}%`);

    return { saved: { category, key } };
  },
};

export const recordKnowledgeGap: Tool = {
  name: 'record_knowledge_gap',
  description:
    'Record a question you could not answer from business knowledge. Use this instead of guessing. Asking the same question twice increases its count, so the owner sees what customers keep asking about.',
  parameters: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question as a customer would ask it.' },
    },
    required: ['question'],
    additionalProperties: false,
  },
  mutates: true,

  async run(args, ctx) {
    const question = str(args, 'question', { required: true, max: 300 });

    const { data: existing } = await serviceClient
      .from('knowledge_gaps')
      .select('id, times_seen')
      .eq('tenant_id', ctx.tenantId)
      .ilike('question', question)
      .maybeSingle();

    if (existing) {
      await serviceClient
        .from('knowledge_gaps')
        .update({ times_seen: existing.times_seen + 1, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .eq('tenant_id', ctx.tenantId);
      return { recorded: true, times_seen: existing.times_seen + 1 };
    }

    const { error } = await serviceClient
      .from('knowledge_gaps')
      .insert({ tenant_id: ctx.tenantId, question, status: 'open' });
    if (error) throw new Error(error.message);
    return { recorded: true, times_seen: 1 };
  },
};

export const listKnowledgeGaps: Tool = {
  name: 'list_knowledge_gaps',
  description:
    'List questions the agents could not answer, most-asked first. Use this to tell the owner what is missing, then ask them for the answers.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  mutates: false,

  async run(_args, ctx) {
    const { data, error } = await serviceClient
      .from('knowledge_gaps')
      .select('question, times_seen, status')
      .eq('tenant_id', ctx.tenantId)
      .in('status', ['open', 'asked'])
      .order('times_seen', { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return { gaps: data ?? [] };
  },
};
