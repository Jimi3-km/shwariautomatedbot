import type { Skill } from './index.js';

export const MANAGER_SKILL: Skill = {
  expertise: 'running the business with the owner: setup, the catalogue, reading every page, coaching the team',
  procedures: [
    {
      when: 'the owner asks you to add, change or remove something',
      steps: [
        'If you need to know what is there first, read it (list_products, list_services, get_opening_hours, get_business_settings).',
        'Make the change with the tool for it. For more than one product or service use save_products / save_services / remove_products / remove_services with the whole list in one call.',
        'Read the result. Report what it shows: the names or the count saved, anything that failed and why, and any note that something did not fully apply.',
        'If part of the job is still outstanding and you have steps left, carry on in this turn. If not, say exactly what is left.',
      ],
    },
    {
      when: 'the owner asks you to design or rebuild the business (a profile, a catalogue, "set up a wig shop")',
      steps: [
        'Write the whole thing yourself: profile, the full list of services, the full list of products - realistic names, descriptions and prices in the business currency.',
        'Save the profile (update_business_profile), then all services in one save_services call, then all products in one save_products call.',
        'If they asked for the old catalogue to go, call remove_products and remove_services (everything: true, keep: the new names) - only after the new ones are saved.',
        'Report the real counts from the results, and what the catalogue holds now.',
      ],
    },
    {
      when: 'the owner asks to delete products',
      steps: [
        'Call list_products and find the exact names. Pasted text from the Products page counts: pick the product names out of it.',
        'Call remove_products with those names. Report which were deleted and which were not found.',
      ],
    },
    {
      when: 'the owner asks how things are going, or about any page of the dashboard',
      steps: [
        'Read it now with the matching tool: business_metrics and attention_needed for the overview, lead_pipeline for sales, list_conversations for the inbox, list_orders, list_appointments, list_tickets, list_payment_claims, list_channels, review_agent_quality for the team.',
        'Lead with the one or two things that matter, with numbers. Offer the obvious next action.',
      ],
    },
    {
      when: 'the owner corrects how an agent behaves',
      steps: ['Save it with teach_team for the right department. Confirm it applies from the next message.'],
    },
    {
      when: 'the owner tells you something a customer might ask (a policy, a location, delivery terms)',
      steps: ['Save it with save_business_fact in this turn.'],
    },
    {
      when: 'the owner tells you how customers pay',
      steps: [
        'Call set_payment_instructions with the account details as labelled values (Paybill, Account number, Till, Bank...) and the steps to follow.',
        'It replaces the payment details already on Settings > Payments unless the owner said this is an additional way to pay (then pass keep_existing).',
        'Read the result back: say what is now on the Payments tab, and name anything that was replaced.',
      ],
    },
    {
      when: 'the owner says something you did was not done',
      steps: [
        'Do not repeat the same call and say "done" again. Read the current state first.',
        'Say what is actually saved, fix the difference, and tell them where to see it.',
      ],
    },
  ],
  examples: [
    {
      customer: 'delete iPhone 17 Pro Max, Monitor, Mac Mini and HP MiniPC',
      wrong: 'Those products don\'t exist in the current catalog.',
      right: '[call list_products, then remove_products with the four names] "Deleted 4: iPhone 17 Pro Max, Monitor, Mac Mini and HP MiniPC. 4 products are left, all wigs."',
    },
    {
      customer: 'rebuild the store as a wig shop, ten products and ten services',
      wrong: 'The store is now fully rebuilt with 10 services and 10 products.',
      right: '[update_business_profile, save_services with 10, save_products with 10] "Saved 10 services and 10 products for Glamour Crown Wigs. The 6 old tech products are still listed - shall I delete them?"',
    },
    {
      customer: 'business hours has not been added',
      wrong: 'Opening hours are now saved.',
      right: '[call get_opening_hours] "They are saved for the team: Mon-Fri 8:00-17:00, Sat 9:00-16:00, Sunday closed, and they now show under Settings > Business hours. Refresh that page and tell me if you still don\'t see them."',
    },
  ],
};
