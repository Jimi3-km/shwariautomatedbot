export async function exchangeWhatsAppCode(code: string, tenantId: string) {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error('Meta App ID or Secret is not configured on the server.');
  }

  // 1. Exchange code for access token
  const tokenRes = await fetch(`https://graph.facebook.com/v20.0/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${code}`);
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    console.error('Failed to exchange code for token:', text);
    throw new Error('Failed to exchange Meta code for access token.');
  }
  const tokenData = await tokenRes.json();
  const accessToken = tokenData.access_token;

  // 2. Fetch WABA
  const wabaRes = await fetch(`https://graph.facebook.com/v20.0/me/client_whatsapp_business_accounts`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  
  if (!wabaRes.ok) {
    console.error('Failed to fetch WABA:', await wabaRes.text());
    throw new Error('Could not retrieve WhatsApp Business Account details.');
  }
  const wabaData = await wabaRes.json();
  
  if (!wabaData.data || wabaData.data.length === 0) {
    throw new Error('No WhatsApp Business Accounts found for this user.');
  }
  
  const wabaId = wabaData.data[0].id;

  // 3. Get the phone numbers for this WABA
  const phonesRes = await fetch(`https://graph.facebook.com/v20.0/${wabaId}/phone_numbers`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!phonesRes.ok) throw new Error('Failed to fetch phone numbers.');
  
  const phonesData = await phonesRes.json();
  if (!phonesData.data || phonesData.data.length === 0) {
    throw new Error('No phone numbers found attached to this WABA.');
  }
  
  const phone = phonesData.data[0];
  const phoneNumberId = phone.id;
  const displayPhoneNumber = phone.display_phone_number;

  return {
    accessToken,
    wabaId,
    phoneNumberId,
    displayPhoneNumber
  };
}

export async function linkInstagramAccount(userAccessToken: string, tenantId: string) {
  // 1. Get user's Facebook Pages
  const pagesRes = await fetch(`https://graph.facebook.com/v20.0/me/accounts`, {
    headers: { Authorization: `Bearer ${userAccessToken}` }
  });
  if (!pagesRes.ok) throw new Error('Failed to fetch Facebook Pages.');
  const pagesData = await pagesRes.json();
  
  if (!pagesData.data || pagesData.data.length === 0) {
    throw new Error('You do not manage any Facebook Pages.');
  }
  
  let targetPage = null;
  let igAccountId = null;
  
  for (const page of pagesData.data) {
    const igRes = await fetch(`https://graph.facebook.com/v20.0/${page.id}?fields=instagram_business_account`, {
      headers: { Authorization: `Bearer ${page.access_token}` }
    });
    const igData = await igRes.json();
    if (igData.instagram_business_account) {
      targetPage = page;
      igAccountId = igData.instagram_business_account.id;
      break;
    }
  }
  
  if (!targetPage || !igAccountId) {
    throw new Error('None of your Facebook Pages have an Instagram Professional account linked.');
  }

  // Retrieve Instagram account details
  const igDetailsRes = await fetch(`https://graph.facebook.com/v20.0/${igAccountId}?fields=username,name`, {
    headers: { Authorization: `Bearer ${targetPage.access_token}` }
  });
  const igDetails = await igDetailsRes.json();

  return {
    pageAccessToken: targetPage.access_token,
    igAccountId,
    igUsername: igDetails.username,
    igName: igDetails.name
  };
}
