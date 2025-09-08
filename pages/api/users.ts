import type { NextApiRequest, NextApiResponse } from 'next';

interface User {
  id: string;
  email: string;
  phone?: string;
  createdAt: string;
  vehicles: Vehicle[];
}

interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  licensePlate: string;
  userId: string;
}

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === 'POST') {
    // Create new user
    const { email, phone } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // TODO: Validate email format
    // TODO: Check if user already exists
    // TODO: Save to database
    
    const newUser: Partial<User> = {
      id: `user_${Date.now()}`,
      email,
      phone,
      createdAt: new Date().toISOString(),
      vehicles: []
    };

    return res.status(201).json(newUser);
  }

  if (req.method === 'GET') {
    // Get user by email or ID
    const { email, id } = req.query;
    
    // TODO: Implement user lookup from database
    
    return res.status(200).json({ message: 'User lookup not implemented' });
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}