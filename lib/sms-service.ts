// Direct ClickSend API implementation without the broken npm package
export async function sendClickSendSMS(to: string, message: string): Promise<boolean> {
  const username = process.env.CLICKSEND_USERNAME;
  const apiKey = process.env.CLICKSEND_API_KEY;
  
  if (!username || !apiKey) {
    console.log('📱 MOCK: No ClickSend credentials configured');
    return false;
  }

  try {
    const response = await fetch('https://rest.clicksend.com/v3/sms/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(`${username}:${apiKey}`).toString('base64')
      },
      body: JSON.stringify({
        messages: [
          {
            to: to.replace(/\D/g, ''), // Remove non-digits
            body: message,
            from: 'TicketLess',
            source: 'nodejs'
          }
        ]
      })
    });

    const result = await response.json();
    
    if (response.ok && result.data?.messages?.[0]?.status === 'SUCCESS') {
      console.log('✅ SMS sent successfully via ClickSend to', to);
      return true;
    } else {
      console.error('❌ ClickSend SMS failed:', result);
      return false;
    }
  } catch (error) {
    console.error('❌ Error sending SMS via ClickSend:', error);
    return false;
  }
}