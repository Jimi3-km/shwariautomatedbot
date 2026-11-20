import type { Skill } from './index.js';

export const BOOKING_SKILL: Skill = {
  expertise: 'the diary: finding a free time, booking, moving and cancelling appointments',
  procedures: [
    {
      when: 'a customer wants to book or asks what times are free',
      steps: [
        'Read the services (list_services) to match what they want to a real service and its duration. If nothing matches, say it is not offered and name the closest service that is.',
        'Read the diary (list_appointments) and the opening hours (get_opening_hours) for the days in question. A time is free only if it is inside opening hours and not in the busy list.',
        'Offer two specific free times in plain words ("tomorrow, Friday, at 10 in the morning or 2 in the afternoon"). Never offer a time you did not just verify.',
        'The moment they pick a time, call book_appointment in that same turn. Do not ask "shall I book it?" again - picking the time is the yes.',
        'Reply with the result: the service, day, date and time, exactly as the booking returned it.',
      ],
    },
    {
      when: 'a customer wants to move an appointment',
      steps: [
        'Read their appointments (get_customer_history) to get the appointment and its id. If they have more than one upcoming, ask which.',
        'If they named a new time: check it is free (list_appointments, get_opening_hours) and call reschedule_appointment in this same turn.',
        'If they did not name a time: offer two verified free times, and reschedule the moment they choose.',
        'Reply with the old time and the new time. If the new time is taken, say so and offer the two nearest free times.',
      ],
    },
    {
      when: 'a customer wants to cancel',
      steps: [
        'Read their appointments (get_customer_history). Confirm which one in one short question only if there is more than one.',
        'Call cancel_appointment, then say what was cancelled and offer to rebook.',
      ],
    },
    {
      when: 'a service is marked as needing a consultation',
      steps: ['Book the consultation, not the service itself, and say that the consultation comes first.'],
    },
    {
      when: 'you are missing their name or phone number',
      steps: ['Ask for it once, save it with save_customer_details, then carry on with the booking in the same turn.'],
    },
  ],
  examples: [
    {
      customer: 'saturday 2pm',
      wrong: 'I need to check the calendar for Saturday at 2:00 PM availability first. Let me look.',
      right: '[call list_appointments and get_opening_hours, then reschedule_appointment] "Done - I\'ve moved your Wig Revamp from Friday 2pm to Saturday 22 November at 2pm."',
    },
    {
      customer: 'i want to book',
      wrong: 'I\'ll check available times for that service. Let me look at the calendar.',
      right: '[call list_appointments and get_opening_hours] "I can do tomorrow, Friday, at 10am or 2pm. Which suits you?"',
    },
    {
      customer: 'Friday at 2',
      wrong: 'Great, shall I go ahead and book Friday at 2pm for you?',
      right: '[call book_appointment] "You\'re booked: Wig Revamp, Friday 21 November at 2pm. See you then."',
    },
  ],
};
