import { NextApiRequest, NextApiResponse } from 'next';
import { sanitizeErrorMessage } from '../../lib/error-utils';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const hasCredentials = !!process.env.GOOGLE_CLOUD_VISION_CREDENTIALS;
  const credentialsLength = process.env.GOOGLE_CLOUD_VISION_CREDENTIALS?.length || 0;

  let parseable = false;
  let credentialDetails = null;

  if (hasCredentials) {
    try {
      const parsed = JSON.parse(process.env.GOOGLE_CLOUD_VISION_CREDENTIALS!);
      parseable = true;
      credentialDetails = {
        hasPrivateKey: !!parsed.private_key,
        hasClientEmail: !!parsed.client_email,
        hasProjectId: !!parsed.project_id,
        type: parsed.type,
        clientEmail: parsed.client_email ? parsed.client_email.substring(0, 30) + '...' : null
      };
    } catch (error: any) {
      credentialDetails = { parseError: sanitizeErrorMessage(error) };
    }
  }

  return res.status(200).json({
    configured: hasCredentials,
    credentialsLength,
    parseable,
    details: credentialDetails,
    message: hasCredentials
      ? parseable
        ? '✅ Google Cloud Vision credentials are properly configured!'
        : '❌ Credentials exist but cannot be parsed as JSON'
      : '❌ No Google Cloud Vision credentials found in environment variables'
  });
}
