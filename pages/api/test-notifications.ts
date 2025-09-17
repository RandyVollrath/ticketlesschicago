import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { offset = 1 } = req.body;

  try {
    // Call the renewal reminder endpoint
    const response = await fetch(`${req.headers.origin}/api/send-renewal-reminders.background?offset=${offset}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Notification test failed');
    }

    return res.status(200).json({
      success: true,
      message: `Test completed for offset ${offset}`,
      data
    });

  } catch (error: any) {
    console.error('Test notification error:', error);
    return res.status(500).json({ 
      error: error.message,
      success: false 
    });
  }
}