import { useEffect } from 'react';
import { useRouter } from 'next/router';

// Profile page now redirects to consolidated dashboard
export default function ProfilePage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard');
  }, [router]);

  return null;
}
