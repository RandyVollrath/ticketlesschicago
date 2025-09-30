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
    const body: any = {
      email: params.email,
      first_name: params.first_name || params.email.split('@')[0],
      last_name: params.last_name || '',
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
      console.error('Failed to create Rewardful affiliate:', response.status, errorText);

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