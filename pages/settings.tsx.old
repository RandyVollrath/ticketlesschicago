import { useEffect } from 'react';
import { useRouter } from 'next/router';

// Settings page now redirects to consolidated dashboard
export default function SettingsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard');
  }, [router]);

  return null;
}
