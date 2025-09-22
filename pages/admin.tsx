import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { supabase } from '../lib/supabase';

interface VehicleReminder {
  id: string;
  user_id: string;
  license_plate: string;
  email: string;
  phone: string;
  city_sticker_expiry: string;
  license_plate_expiry: string;
  emissions_due_date: string | null;
  notification_preferences: any;
  subscription_status: string;
  created_at: string;
}

export default function AdminDashboard() {
  const [users, setUsers] = useState<VehicleReminder[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [notificationResults, setNotificationResults] = useState<any>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (authenticated) {
      fetchUsers();
    }
  }, [authenticated]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === 'ticketless2025admin') {
      setAuthenticated(true);
    } else {
      setMessage('Invalid password');
    }
  };

  if (!authenticated) {
    return (
      <div style={{ fontFamily: 'Arial, sans-serif', padding: '20px', maxWidth: '400px', margin: '100px auto' }}>
        <Head>
          <title>Admin Access</title>
        </Head>
        <h2>Admin Access Required</h2>
        <form onSubmit={handleLogin}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter admin password"
            style={{ width: '100%', padding: '10px', marginBottom: '10px', border: '1px solid #ddd', borderRadius: '4px' }}
            required
          />
          <button
            type="submit"
            style={{ width: '100%', padding: '10px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px' }}
          >
            Login
          </button>
        </form>
        {message && <p style={{ color: 'red', marginTop: '10px' }}>{message}</p>}
      </div>
    );
  }

  const fetchUsers = async () => {
    setLoading(true);
    try {
      // First check if we can access the table at all
      console.log('Fetching users from vehicle_reminders table...');
      
      const { data, error } = await supabase
        .from('vehicle_reminders')
        .select('*')
        .order('created_at', { ascending: false });

      console.log('Vehicle reminders query result:', { data, error });

      if (error) {
        console.error('Vehicle reminders error:', error);
        setMessage(`Vehicle reminders error: ${error.message}`);
        
        // Also try to check auth users table to see if users exist there
        const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();
        console.log('Auth users:', { authUsers, authError });
        
        if (authUsers) {
          setMessage(`Found ${authUsers.users?.length || 0} auth users, but 0 vehicle reminders. Database connection issue.`);
        }
      } else {
        setUsers(data || []);
        setMessage(data?.length ? `Found ${data.length} users` : 'No vehicle reminder records found');
      }
    } catch (error: any) {
      console.error('Fetch error:', error);
      setMessage(`Fetch error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const testNotifications = async () => {
    setLoading(true);
    setMessage('Processing notifications...');
    
    try {
      const response = await fetch('/api/notifications/process', {
        method: 'POST',
      });
      
      const results = await response.json();
      setNotificationResults(results);
      setMessage(`Processed ${results.processed} reminders, ${results.successful} successful, ${results.failed} failed`);
    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const createTestUser = async () => {
    setLoading(true);
    setMessage('Creating test user...');
    
    try {
      const response = await fetch('/api/test-webhook', {
        method: 'POST',
      });
      
      const result = await response.json();
      if (result.success) {
        setMessage('Test user created successfully!');
        await fetchUsers(); // Refresh the user list
      } else {
        setMessage(`Error: ${result.error}`);
      }
    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ fontFamily: 'Arial, sans-serif', padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <Head>
        <title>TicketLess America Admin</title>
      </Head>

      <h1>TicketLess America Admin Dashboard</h1>
      
      <div style={{ marginBottom: '30px' }}>
        <h2>Users ({users.length})</h2>
        <button 
          onClick={fetchUsers} 
          disabled={loading}
          style={{ marginRight: '10px', padding: '10px', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '4px' }}
        >
          Refresh Users
        </button>
        <button 
          onClick={testNotifications}
          disabled={loading}
          style={{ marginRight: '10px', padding: '10px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '4px' }}
        >
          Test Notifications
        </button>
        <button 
          onClick={createTestUser}
          disabled={loading}
          style={{ padding: '10px', backgroundColor: '#ffc107', color: 'black', border: 'none', borderRadius: '4px' }}
        >
          Create Test User
        </button>
      </div>

      {message && (
        <div style={{ 
          padding: '10px', 
          marginBottom: '20px', 
          backgroundColor: message.includes('Error') ? '#f8d7da' : '#d4edda',
          color: message.includes('Error') ? '#721c24' : '#155724',
          borderRadius: '4px'
        }}>
          {message}
        </div>
      )}

      {notificationResults && (
        <div style={{ marginBottom: '20px', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
          <h3>Notification Results</h3>
          <pre style={{ fontSize: '12px' }}>{JSON.stringify(notificationResults, null, 2)}</pre>
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', border: '1px solid #ddd' }}>
          <thead>
            <tr style={{ backgroundColor: '#f8f9fa' }}>
              <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>Email</th>
              <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>License Plate</th>
              <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>City Sticker</th>
              <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>License Renewal</th>
              <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>Emissions</th>
              <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>Status</th>
              <th style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'left' }}>Created</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td style={{ padding: '10px', border: '1px solid #ddd' }}>{user.email}</td>
                <td style={{ padding: '10px', border: '1px solid #ddd' }}>{user.license_plate}</td>
                <td style={{ padding: '10px', border: '1px solid #ddd' }}>{user.city_sticker_expiry}</td>
                <td style={{ padding: '10px', border: '1px solid #ddd' }}>{user.license_plate_expiry}</td>
                <td style={{ padding: '10px', border: '1px solid #ddd' }}>{user.emissions_due_date || 'N/A'}</td>
                <td style={{ padding: '10px', border: '1px solid #ddd' }}>{user.subscription_status || 'unknown'}</td>
                <td style={{ padding: '10px', border: '1px solid #ddd' }}>{new Date(user.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {users.length === 0 && !loading && (
        <p>No users found. Check if the webhook is working and users are being created properly.</p>
      )}

      <div style={{ marginTop: '40px', padding: '20px', backgroundColor: '#f8f9fa', borderRadius: '4px' }}>
        <h3>System Status</h3>
        <ul>
          <li><strong>Cron Job:</strong> Set to run daily at 9 AM UTC (vercel.json)</li>
          <li><strong>Database:</strong> vehicle_reminders table</li>
          <li><strong>Notifications:</strong> Email (Resend), SMS (ClickSend), Voice (ClickSend)</li>
          <li><strong>Reminder Days:</strong> 60, 30, 14, 7, 3, 1 days before expiry</li>
        </ul>
      </div>
    </div>
  );
}