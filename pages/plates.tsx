import { useEffect } from 'react';
import { useRouter } from 'next/router';

// Plates page now redirects to consolidated dashboard
export default function PlatesPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/dashboard');
  }, [router]);

  return null;
}
