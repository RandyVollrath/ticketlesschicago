import { useEffect } from 'react';
import { useRouter } from 'next/router';

// This page has been replaced with the new TicketContester component
// Redirecting to /contest-ticket

export default function TicketContest() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/contest-ticket');
  }, [router]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#6b7280' }}>Redirecting to new contest tool...</p>
    </div>
  );
}
