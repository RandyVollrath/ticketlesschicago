const REWARDFUL_API_KEY = process.env.REWARDFUL_API_SECRET;
const REWARDFUL_API_URL = 'https://api.getrewardful.com/v1';

interface CreateAffiliateParams {
  email: string;
  first_name: string;
  last_name: string;
  campaign_id?: string;
  stripe_customer_id?: string;
}

interface RewardfulAffiliate {
  id: string;
  token: string;
  email: string;
  first_name: string;
  last_name: string;
  links: Array<{
    url: string;
    campaign_id: string;
  }>;
}

export async function createRewardfulAffiliate(
  params: CreateAffiliateParams
): Promise<RewardfulAffiliate | null> {
  if (!REWARDFUL_API_KEY) {
    console.error('REWARDFUL_API_SECRET not configured');
    return null;
  }

  try {
    // Sanitize names to only contain letters, spaces, hyphens, and apostrophes
    // Rewardful has strict validation on these fields
    const sanitizeName = (name: string | null | undefined): string => {
      if (!name || typeof name !== 'string') {
        return 'User';
      }
      // Remove any non-letter characters except spaces, hyphens, apostrophes
      const cleaned = name.replace(/[^a-zA-Z\s\-']/g, '').trim();
      // If nothing left, use default
      return cleaned.length > 0 ? cleaned : 'User';
    };

    const firstName = sanitizeName(params.first_name || params.email.split('@')[0]);
    const lastName = sanitizeName(params.last_name);

    const body: any = {
      email: params.email,
      first_name: firstName,
      last_name: lastName || 'Member', // Rewardful requires non-empty last_name
      state: 'active',
      receive_new_commission_notifications: true,
    };

    if (params.campaign_id) {
      body.campaign_id = params.campaign_id;
    }

    if (params.stripe_customer_id) {
      body.stripe_customer_id = params.stripe_customer_id;
    }

    const response = await fetch(`${REWARDFUL_API_URL}/affiliates`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${REWARDFUL_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to create Rewardful affiliate:', {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
        requestBody: body
      });

      // Try to parse error as JSON for more details
      let errorJson: any = null;
      try {
        errorJson = JSON.parse(errorText);
        console.error('Rewardful API error details:', errorJson);
      } catch (e) {
        // errorText is not JSON, already logged above
      }

      // If email already exists (422 status), try to find the existing affiliate
      if (response.status === 422 && errorJson?.details?.some((d: string) => d.includes('Email has already been taken'))) {
        console.log('Email already exists, attempting to find existing affiliate...');
        try {
          const existingAffiliate = await findAffiliateByEmail(params.email);
          if (existingAffiliate) {
            console.log('✅ Found existing affiliate:', existingAffiliate.id);
            return existingAffiliate;
          }
        } catch (err) {
          console.error('Could not retrieve existing affiliate:', err);
        }
      }

      // Don't throw error - just log it and return null
      // We don't want to break the webhook if affiliate creation fails
      return null;
    }

    const data = await response.json();
    console.log('✅ Created Rewardful affiliate:', {
      id: data.id,
      email: data.email,
      token: data.token,
      referral_link: data.links?.[0]?.url
    });

    return data;
  } catch (error) {
    console.error('Error creating Rewardful affiliate:', error);
    return null;
  }
}

export async function getRewardfulAffiliate(
  affiliateId: string
): Promise<RewardfulAffiliate | null> {
  if (!REWARDFUL_API_KEY) {
    console.error('REWARDFUL_API_SECRET not configured');
    return null;
  }

  try {
    const response = await fetch(`${REWARDFUL_API_URL}/affiliates/${affiliateId}`, {
      headers: {
        'Authorization': `Bearer ${REWARDFUL_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error('Failed to get Rewardful affiliate:', response.status, await response.text());
      return null;
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error getting Rewardful affiliate:', error);
    return null;
  }
}

export async function findAffiliateByEmail(
  email: string
): Promise<RewardfulAffiliate | null> {
  if (!REWARDFUL_API_KEY) {
    console.error('REWARDFUL_API_SECRET not configured');
    return null;
  }

  try {
    // List affiliates filtered by email
    const response = await fetch(`${REWARDFUL_API_URL}/affiliates?email=${encodeURIComponent(email)}`, {
      headers: {
        'Authorization': `Bearer ${REWARDFUL_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      console.error('Failed to find affiliate by email:', response.status, await response.text());
      return null;
    }

    const data = await response.json();

    // Rewardful returns an array of affiliates
    if (data.data && data.data.length > 0) {
      return data.data[0]; // Return first match
    }

    return null;
  } catch (error) {
    console.error('Error finding affiliate by email:', error);
    return null;
  }
}