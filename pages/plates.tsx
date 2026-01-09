import { useEffect } from 'react';
import { useRouter } from 'next/router';

// Plates page now redirects to consolidated dashboard
// Preserves checkout query params for success modal
export default function PlatesPage() {
  const router = useRouter();

  useEffect(() => {
    // Preserve checkout success param
    const { checkout } = router.query;
    if (checkout === 'success') {
      router.replace('/settings?checkout=success');
    } else {
      router.replace('/settings');
    }
  }, [router]);

  return null;
}
