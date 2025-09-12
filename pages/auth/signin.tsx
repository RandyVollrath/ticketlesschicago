import { signIn } from 'next-auth/react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import Link from 'next/link';

export default function SignIn() {
  const router = useRouter();
  const { callbackUrl } = router.query;

  return (
    <div style={{ 
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    }}>
      <Head>
        <title>Sign In - Ticket Insurance Chicago</title>
        <meta name="description" content="Sign in to your Ticket Insurance account" />
      </Head>

      <div style={{
        backgroundColor: 'white',
        borderRadius: '16px',
        padding: '48px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
        maxWidth: '440px',
        width: '100%',
        margin: '20px'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <Link href="/" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>🛡️</div>
            <h1 style={{ 
              fontSize: '28px', 
              fontWeight: 'bold', 
              color: '#333',
              margin: '0 0 8px 0'
            }}>
              Ticket Insurance Chicago
            </h1>
          </Link>
          <p style={{ color: '#666', fontSize: '16px', margin: 0 }}>
            Sign in to manage your coverage
          </p>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <button
            onClick={() => signIn('google', { callbackUrl: callbackUrl as string || '/profile' })}
            style={{
              width: '100%',
              padding: '14px',
              backgroundColor: '#4285f4',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: '600',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '12px',
              transition: 'background-color 0.2s ease'
            }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#357ae8'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#4285f4'}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M19.6 10.23c0-.71-.06-1.4-.18-2.05H10v3.87h5.38a4.6 4.6 0 01-2 3.02v2.5h3.24c1.89-1.74 2.98-4.3 2.98-7.34z" fill="#4285F4"/>
              <path d="M10 20c2.7 0 4.96-.9 6.62-2.43l-3.24-2.5c-.9.6-2.04.95-3.38.95-2.6 0-4.8-1.76-5.59-4.12H1.05v2.59A9.97 9.97 0 0010 20z" fill="#34A853"/>
              <path d="M4.41 11.9c-.2-.6-.31-1.24-.31-1.9s.11-1.3.31-1.9V5.51H1.05A9.97 9.97 0 000 10c0 1.61.39 3.14 1.05 4.49l3.36-2.6z" fill="#FBBC05"/>
              <path d="M10 3.98c1.47 0 2.79.5 3.82 1.5l2.87-2.87A9.95 9.95 0 0010 0 9.97 9.97 0 001.05 5.51l3.36 2.6C5.2 5.73 7.4 3.97 10 3.97z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </button>
        </div>

        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          margin: '24px 0',
          color: '#999'
        }}>
          <div style={{ flex: 1, height: '1px', backgroundColor: '#e1e5e9' }}></div>
          <span style={{ padding: '0 16px', fontSize: '14px' }}>or</span>
          <div style={{ flex: 1, height: '1px', backgroundColor: '#e1e5e9' }}></div>
        </div>

        <div style={{ marginBottom: '24px' }}>
          <input
            type="email"
            placeholder="Email address"
            style={{
              width: '100%',
              padding: '14px',
              border: '2px solid #e1e5e9',
              borderRadius: '8px',
              fontSize: '16px',
              marginBottom: '12px',
              outline: 'none'
            }}
          />
          <input
            type="password"
            placeholder="Password"
            style={{
              width: '100%',
              padding: '14px',
              border: '2px solid #e1e5e9',
              borderRadius: '8px',
              fontSize: '16px',
              marginBottom: '12px',
              outline: 'none'
            }}
          />
          <button
            style={{
              width: '100%',
              padding: '14px',
              backgroundColor: '#667eea',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: '600',
              cursor: 'pointer',
              opacity: 0.5,
              pointerEvents: 'none'
            }}
          >
            Email Sign In (Coming Soon)
          </button>
        </div>

        <div style={{ 
          textAlign: 'center',
          paddingTop: '20px',
          borderTop: '1px solid #e1e5e9'
        }}>
          <p style={{ color: '#666', fontSize: '14px', marginBottom: '8px' }}>
            Don't have an account?
          </p>
          <Link href="/" style={{
            color: '#667eea',
            textDecoration: 'none',
            fontWeight: '600',
            fontSize: '14px'
          }}>
            Get Coverage Now →
          </Link>
        </div>

        <div style={{ 
          textAlign: 'center',
          marginTop: '24px',
          fontSize: '12px',
          color: '#999'
        }}>
          By signing in, you agree to our{' '}
          <a href="/terms" style={{ color: '#667eea', textDecoration: 'none' }}>Terms</a>
          {' '}and{' '}
          <a href="/privacy" style={{ color: '#667eea', textDecoration: 'none' }}>Privacy Policy</a>
        </div>
      </div>
    </div>
  );
}