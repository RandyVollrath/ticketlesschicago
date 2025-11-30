import { NextApiRequest, NextApiResponse } from 'next';
import { getAdminActionItems } from '../../../lib/monitoring';

/**
 * DEBUG ENDPOINT - Remove after testing
 * Tests the consolidated admin digest data
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    console.log('🧪 Testing admin action items...');

    const adminItems = await getAdminActionItems();

    console.log('📊 Results:', JSON.stringify(adminItems, null, 2));

    return res.status(200).json({
      success: true,
      data: adminItems,
      summary: {
        renewalsCount: adminItems.upcomingRenewals.length,
        urgentRenewals: adminItems.upcomingRenewals.filter(r => r.daysUntilExpiry <= 14).length,
        missingDocsCount: adminItems.missingPermitDocs.length,
        criticalDocs: adminItems.missingPermitDocs.filter(d => d.urgency === 'critical').length,
        healthIssues: adminItems.systemHealth.issues.length,
        notificationsWorking: adminItems.systemHealth.notificationsWorking
      }
    });
  } catch (error: any) {
    console.error('❌ Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
}
