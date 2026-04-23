import type { GetServerSideProps } from 'next';

// Legacy /get-started required Google sign-in before the user could do anything.
// The real funnel lives at /start (auth happens only at the Stripe handoff), so
// forward every hit there and preserve any query string (?plan=monthly|annual,
// utm_*, etc.) so downstream pre-fill still works.
export const getServerSideProps: GetServerSideProps = async ({ resolvedUrl }) => {
  const qs = resolvedUrl.includes('?') ? resolvedUrl.slice(resolvedUrl.indexOf('?')) : '';
  return {
    redirect: {
      destination: `/start${qs}`,
      permanent: false,
    },
  };
};

export default function GetStartedRedirect() {
  return null;
}
