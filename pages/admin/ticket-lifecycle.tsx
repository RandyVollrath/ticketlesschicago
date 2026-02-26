import { useEffect } from 'react';
import { useRouter } from 'next/router';

// Redirect to the Lifecycle tab within the unified Contest Pipeline admin page
export default function TicketLifecycleRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/admin/contest-pipeline?tab=lifecycle');
  }, [router]);
  return null;
}
