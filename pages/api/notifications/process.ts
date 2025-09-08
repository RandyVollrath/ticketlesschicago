import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../lib/database';
import { notificationService } from '../../../lib/notifications';

// API endpoint to process pending notifications
// This would typically be called by a cron job or scheduled task
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  try {
    // Get pending reminders
    const pendingReminders = await db.getPendingReminders();
    
    console.log(`Processing ${pendingReminders.length} pending reminders`);

    const results = {
      processed: 0,
      successful: 0,
      failed: 0,
      errors: [] as string[]
    };

    for (const reminder of pendingReminders) {
      results.processed++;

      try {
        // Get the associated obligation and user
        const obligation = await db.getObligationsByUserId(reminder.obligationId)
          .then(obligations => obligations.find(o => o.id === reminder.obligationId));
        
        if (!obligation) {
          results.failed++;
          results.errors.push(`Obligation not found for reminder ${reminder.id}`);
          continue;
        }

        const user = await db.getUserById(obligation.userId);
        if (!user) {
          results.failed++;
          results.errors.push(`User not found for reminder ${reminder.id}`);
          continue;
        }

        // Calculate days until due
        const dueDate = new Date(obligation.dueDate);
        const today = new Date();
        const daysUntilDue = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        // Generate notification content
        const content = notificationService.generateReminderContent(obligation, user, daysUntilDue);

        // Send the appropriate notification type
        let success = false;
        if (reminder.type === 'email') {
          success = await notificationService.sendEmail(content.email);
        } else if (reminder.type === 'sms') {
          success = await notificationService.sendSMS(content.sms);
        }

        if (success) {
          // Mark reminder as sent
          await db.markReminderSent(reminder.id);
          results.successful++;
        } else {
          results.failed++;
          results.errors.push(`Failed to send ${reminder.type} reminder ${reminder.id}`);
        }

      } catch (error) {
        results.failed++;
        results.errors.push(`Error processing reminder ${reminder.id}: ${error}`);
        console.error(`Error processing reminder ${reminder.id}:`, error);
      }
    }

    console.log('Notification processing results:', results);

    return res.status(200).json({
      success: true,
      results
    });

  } catch (error) {
    console.error('Error processing notifications:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}