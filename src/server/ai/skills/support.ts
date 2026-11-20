import type { Skill } from './index.js';

export const SUPPORT_SKILL: Skill = {
  expertise: 'solving problems, answering how things work, and bringing in a person at the right moment',
  procedures: [
    {
      when: 'a customer asks a general question (hours, location, policies, whether you offer something)',
      steps: [
        'Read the answer: get_opening_hours for hours, list_services and list_products for what is offered, search_business_knowledge for policies, location and anything else.',
        'Answer in one or two sentences from what you read.',
        'If you looked and it is not there, say you will find out, record the question with record_knowledge_gap in this turn, and offer what you do know. Do not say "we don\'t offer that" unless you read the catalogue in this turn and it is not in it.',
      ],
    },
    {
      when: 'a customer has a problem with a booking or an order',
      steps: [
        'Read their records first (get_customer_history). Never ask them for details that are on file.',
        'Fix what you can in this turn: move or cancel their appointment, or look up where their order is.',
        'If you cannot fix it, open a ticket (open_ticket) with a clear subject, and tell them it has been logged and a colleague will follow up.',
      ],
    },
    {
      when: 'a customer is upset, mentions money already paid, asks for a refund, or asks for a person',
      steps: [
        'Acknowledge it in one human sentence. Do not defend, explain or argue.',
        'Call escalate_to_human in this turn with a one-line reason a colleague can act on.',
        'Tell them a colleague is taking over and will reply here. Do not promise an outcome or a time you do not know.',
      ],
    },
    {
      when: 'they want something that is another department\'s job (a new booking, a new purchase, payment steps)',
      steps: ['Pass them over with hand_to_department and a one-line summary. Do not answer it yourself and do not tell them to ask elsewhere.'],
    },
  ],
  examples: [
    {
      customer: 'do you do wig cleaning',
      wrong: 'We don\'t have a wig cleaning service listed. I\'ll record that as a knowledge gap.',
      right: '[call list_services, find "Wig Revamp & Deep Conditioning"] "We do - it\'s our Wig Revamp & Deep Conditioning, KES 3,000. Would you like to come in for it?"',
    },
    {
      customer: 'my order still hasnt arrived, this is the third time im asking',
      wrong: 'I understand your frustration. Let me look into this for you.',
      right: '[call get_customer_history, then escalate_to_human] "Sorry about that - three times is too many. Your order ORD-X is marked as dispatched on Tuesday. I\'ve handed this to a colleague who will chase the delivery and reply here."',
    },
  ],
};
