// Direct ClickSend API implementation without the broken npm package
export async function sendClickSendSMS(to: string, message: string): Promise<{success: boolean, error?: string}> {
  const username = process.env.CLICKSEND_USERNAME;
  const apiKey = process.env.CLICKSEND_API_KEY;
  
  if (!username || !apiKey) {
    console.log('📱 MOCK: No ClickSend credentials configured');
    return { success: false, error: 'No credentials' };
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
      return { success: true };
    } else {
      console.error('❌ ClickSend SMS failed:', result);
      return { success: false, error: result.data?.messages?.[0]?.status || 'Unknown error' };
    }
  } catch (error) {
    console.error('❌ Error sending SMS via ClickSend:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Network error' };
  }
}

// Voice call implementation using ClickSend Voice API
export async function sendClickSendVoiceCall(to: string, message: string): Promise<{success: boolean, error?: string}> {
  const username = process.env.CLICKSEND_USERNAME;
  const apiKey = process.env.CLICKSEND_API_KEY;
  
  if (!username || !apiKey) {
    console.log('📞 MOCK: No ClickSend credentials configured for voice');
    return { success: false, error: 'No credentials' };
  }

  try {
    const response = await fetch('https://rest.clicksend.com/v3/voice/send', {
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
            voice: 'female', // or 'male'
            custom_string: 'ticketless-reminder',
            source: 'nodejs'
          }
        ]
      })
    });

    const result = await response.json();
    
    if (response.ok && result.data?.messages?.[0]?.status === 'SUCCESS') {
      console.log('✅ Voice call sent successfully via ClickSend to', to);
      return { success: true };
    } else {
      console.error('❌ ClickSend voice call failed:', result);
      return { success: false, error: result.data?.messages?.[0]?.status || 'Unknown error' };
    }
  } catch (error) {
    console.error('❌ Error sending voice call via ClickSend:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Network error' };
  }
}