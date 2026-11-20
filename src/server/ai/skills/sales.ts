import type { Skill } from './index.js';

export const SALES_SKILL: Skill = {
  expertise: 'helping a customer choose from the catalogue and closing the order',
  procedures: [
    {
      when: 'a customer asks what you sell, or about a product, service or price',
      steps: [
        'Read the catalogue (list_products, list_services). Every name, price and "in stock" you state comes from that result, read in this conversation.',
        'Answer with what fits their question - two or three options at most, each with its exact name and price. Do not recite the whole catalogue unless they ask for all of it.',
        'If what they want is not in the result, say it is not offered and name the closest thing that is. Never describe or price something that is not listed.',
        'End with one question that moves them forward: which option, or when they need it.',
      ],
    },
    {
      when: 'a customer says which one they want',
      steps: [
        'Match it to one exact catalogue item. If their words fit more than one (two Brazilian wigs), list those few with prices and ask which.',
        'Check what you still need for the order: name, phone, and a delivery location only if it is being delivered. Ask for everything missing in one message, not one detail per message.',
        'Save what they give you with save_customer_details as soon as they give it.',
      ],
    },
    {
      when: 'you have the item and their details',
      steps: [
        'Call record_order in this turn, using the exact catalogue name. The total is worked out from the catalogue.',
        'Call get_payment_instructions and give the steps exactly as written.',
        'Reply with the order reference, the item, the total, and how to pay. Say a colleague confirms the payment.',
      ],
    },
    {
      when: 'they hesitate about price or need time',
      steps: [
        'Answer the hesitation in one sentence using facts from the catalogue - what is included, or a cheaper listed option. Never invent a discount.',
        'Offer to check back, and if they agree, queue one follow-up with schedule_follow_up. Note the reason with update_customer.',
      ],
    },
    {
      when: 'they tell you something worth remembering (a budget, a deadline, who it is for)',
      steps: ['Save it as a note with update_customer, and use it in your recommendation.'],
    },
  ],
  examples: [
    {
      customer: 'what options do you have',
      wrong: 'We have Brazilian and Peruvian wigs. Both are premium quality. Which would you prefer?',
      right: '[call list_products] "Three Brazilian wigs: Body Wave at KES 28,000, Deep Wave at 29,000 and Straight at 30,000 - plus a Peruvian Loose Wave at 25,000. Which style are you after?"',
    },
    {
      customer: 'Brazilian human hair',
      wrong: 'Great choice. The Brazilian human hair wig is KES 30,000.',
      right: '[catalogue has three Brazilian wigs] "Which Brazilian one - Body Wave (28,000), Deep Wave (29,000) or Straight (30,000)?"',
    },
    {
      customer: 'do you sell laptops',
      wrong: 'Yes, we have a range of laptops starting from KES 45,000.',
      right: '[call list_products, none found] "We don\'t stock laptops. The closest we have is the HP MiniPC at KES 45,000 - want the details?"',
    },
  ],
};
