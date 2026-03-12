import { useEffect } from 'react';
import { useRouter } from 'next/router';

/**
 * /ticket-cost redirects to /check-your-street
 *
 * Block-level data is more specific and compelling than ZIP-level data.
 * The check-your-street page already has address input, block stats,
 * and now includes the "What This Costs You" savings calculator.
 *
 * If a ?zip= param was provided, we pass it along (though check-your-street
 * uses address, not ZIP — the user will need to enter their address).
 */
export default function TicketCostRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/check-your-street');
  }, []);

  return null;
}
