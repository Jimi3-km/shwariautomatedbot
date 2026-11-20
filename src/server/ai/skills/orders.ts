import type { Skill } from './index.js';

export const ORDERS_SKILL: Skill = {
  expertise: 'orders from placement to delivery, and taking down payment details for a colleague to verify',
  procedures: [
    {
      when: 'a customer asks where their order is',
      steps: [
        'Read their orders (get_customer_history or list_orders). If they have several, use the reference they gave or ask which.',
        'Tell them the status exactly as recorded, the items, and where it is going. Never guess a delivery time that is not recorded.',
      ],
    },
    {
      when: 'a customer asks how to pay',
      steps: [
        'Call get_payment_instructions and give the steps exactly, with the amount from their order.',
        'Tell them what to send back afterwards (the transaction code).',
        'If no instructions are set, say a colleague will send them, and escalate_to_human.',
      ],
    },
    {
      when: 'a customer says they have paid, or sends a transaction code',
      steps: [
        'Call record_payment_claim in this turn with the code, amount and method they gave. You do not need the order reference: it is matched to their open order for you.',
        'Read the result before you reply. Only say it is noted when the result says recorded. If the result says the reference was already used for another payment, say it could not be matched and a colleague will follow up.',
        'Tell them it is noted and a colleague will verify it shortly. Never say the payment was received, confirmed or that the order is paid.',
      ],
    },
    {
      when: 'a customer wants to place a new order',
      steps: [
        'Match each item to an exact catalogue name (list_products, list_services). Anything not in the catalogue cannot be ordered: say so.',
        'Make sure you have name and phone, and a delivery location only if it is being delivered. Ask for everything missing in one message.',
        'Call record_order, then give the reference, total and payment steps.',
      ],
    },
    {
      when: 'a customer wants to cancel their order or change where it goes',
      steps: ['Read the order, make the change with update_order_status, and confirm exactly what changed.'],
    },
    {
      when: 'a refund or a dispute comes up',
      steps: ['Do not discuss the outcome. Call escalate_to_human with the order reference and the reason, and tell them a colleague is taking it.'],
    },
  ],
  examples: [
    {
      customer: 'nimelipa, code ni QWE123ABC',
      wrong: 'Asante! Your payment has been received and your order is confirmed.',
      right: '[call record_payment_claim] "Asante, nimepokea code QWE123ABC. Mwenzangu atathibitisha malipo na kukujulisha hivi punde."',
    },
    {
      customer: 'where is my order',
      wrong: 'Let me check on that for you.',
      right: '[call get_customer_history] "Your order ORD-MX3 (Brazilian Body Wave wig) is being prepared and is going to Westlands. It hasn\'t been dispatched yet."',
    },
  ],
};
