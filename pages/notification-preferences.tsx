import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { GetServerSideProps } from 'next';
import { createPagesServerClient } from '@supabase/auth-helpers-nextjs';

/**
 * Notification Preferences Page - REDIRECT
 *
 * This page now redirects to /settings with notification accordion open
 * All notification settings have been consolidated into the main settings page
 *
 * Access: /notification-preferences (requires auth) → redirects to /settings
 */

interface PageProps {
  userEmail: string;
  userId: string;
}

export default function NotificationPreferencesPage({
  userEmail,
  userId
}: PageProps) {
  const router = useRouter();

  // Redirect to settings page on mount
  useEffect(() => {
    router.replace('/settings');
  }, [router]);

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-md p-8 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Redirecting to Settings...</h2>
        <p className="text-gray-600">Notification preferences have been moved to the Settings page.</p>
      </div>
    </div>
  );
}

// Keep the getServerSideProps for auth check
export const getServerSideProps: GetServerSideProps = async (context) => {
  try {
    const supabase = createPagesServerClient(context);
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      return {
        redirect: {
          destination: '/login?redirect=/notification-preferences',
          permanent: false
        }
      };
    }

    return {
      props: {
        userEmail: session.user.email || '',
        userId: session.user.id
      }
    };
  } catch (error) {
    console.error('Error in getServerSideProps:', error);
    return {
      redirect: {
        destination: '/login',
        permanent: false
      }
    };
  }
};
