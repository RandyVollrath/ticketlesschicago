import type { NextApiRequest, NextApiResponse } from 'next';
import { addDays, addYears, format } from 'date-fns';
import { verifyOwnership, handleAuthError } from '../../lib/auth-middleware';

interface Obligation {
  id: string;
  userId: string;
  vehicleId: string;
  type: 'city-sticker' | 'emissions' | 'vehicle-registration';
  dueDate: string;
  description: string;
  completed: boolean;
  autoRegister: boolean;
  reminders: Reminder[];
}

interface Reminder {
  id: string;
  obligationId: string;
  type: 'email' | 'sms';
  scheduledFor: string;
  sent: boolean;
  sentAt?: string;
}

// Chicago-specific obligation rules
const generateObligations = (vehicleId: string, userId: string, vehicleYear: number): Obligation[] => {
  const now = new Date();
  const obligations: Obligation[] = [];

  // City Sticker - due by July 31st each year
  const citySticker: Obligation = {
    id: `cs_${vehicleId}_${now.getFullYear()}`,
    userId,
    vehicleId,
    type: 'city-sticker',
    dueDate: format(new Date(now.getFullYear(), 6, 31), 'yyyy-MM-dd'), // July 31st
    description: `City of Chicago vehicle sticker registration for ${now.getFullYear()}`,
    completed: false,
    autoRegister: false,
    reminders: []
  };
  obligations.push(citySticker);

  // Emissions Testing - required for vehicles 4+ years old, every 2 years
  if (now.getFullYear() - vehicleYear >= 4) {
    const emissionsYear = vehicleYear % 2 === now.getFullYear() % 2 ? now.getFullYear() : now.getFullYear() + 1;
    const emissions: Obligation = {
      id: `em_${vehicleId}_${emissionsYear}`,
      userId,
      vehicleId,
      type: 'emissions',
      dueDate: format(new Date(emissionsYear, 11, 31), 'yyyy-MM-dd'), // December 31st of emission year
      description: `Illinois emissions test for ${emissionsYear}`,
      completed: false,
      autoRegister: false,
      reminders: []
    };
    obligations.push(emissions);
  }

  return obligations;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === 'GET') {
    const { userId, vehicleId } = req.query;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    // SECURITY: Verify user owns this resource or is admin
    try {
      await verifyOwnership(req, userId as string);
    } catch (error: any) {
      return handleAuthError(res, error);
    }

    // TODO: Fetch from database
    // For now, return sample obligations
    const sampleObligations: Obligation[] = [
      {
        id: 'cs_sample_2024',
        userId: userId as string,
        vehicleId: 'sample_vehicle',
        type: 'city-sticker',
        dueDate: '2024-07-31',
        description: 'City of Chicago vehicle sticker registration for 2024',
        completed: false,
        autoRegister: false,
        reminders: []
      },
      {
        id: 'em_sample_2024',
        userId: userId as string,
        vehicleId: 'sample_vehicle',
        type: 'emissions',
        dueDate: '2024-12-31',
        description: 'Illinois emissions test for 2024',
        completed: false,
        autoRegister: false,
        reminders: []
      }
    ];

    return res.status(200).json(sampleObligations);
  }

  if (req.method === 'POST') {
    const { userId, vehicleId, vehicleYear } = req.body;
    
    if (!userId || !vehicleId || !vehicleYear) {
      return res.status(400).json({ error: 'User ID, vehicle ID, and vehicle year are required' });
    }

    const obligations = generateObligations(vehicleId, userId, vehicleYear);
    
    // TODO: Save to database
    
    return res.status(201).json(obligations);
  }

  if (req.method === 'PATCH') {
    const { obligationId } = req.query;
    const { completed, autoRegister } = req.body;
    
    if (!obligationId) {
      return res.status(400).json({ error: 'Obligation ID is required' });
    }

    // TODO: Update obligation in database
    
    return res.status(200).json({ message: 'Obligation updated' });
  }

  res.setHeader('Allow', ['GET', 'POST', 'PATCH']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}