import axios from 'axios';
import { config } from './config.js';

export async function sendWhatsAppMessage(toPhone: string, text: string) {
  if (!config.META_ACCESS_TOKEN || !config.META_PHONE_NUMBER_ID) {
    console.error('Meta credentials are not configured. Cannot send WhatsApp message.');
    return;
  }

  try {
    await axios.post(
      `https://graph.facebook.com/v21.0/${config.META_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: toPhone,
        type: 'text',
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${config.META_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error: any) {
    console.error('Error sending WhatsApp message:', error.response?.data || error.message);
  }
}
