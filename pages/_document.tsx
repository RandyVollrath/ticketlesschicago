import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* Google Fonts: Space Grotesk + Inter */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700;800&display=swap" rel="stylesheet" />

        {/* OAuth redirect - must run before ANY page renders */}
        <script dangerouslySetInnerHTML={{
          __html: `
            if (window.location.pathname === '/' && window.location.hash && window.location.hash.includes('access_token')) {
              console.log('🚀 _document.tsx: Redirecting OAuth tokens to callback');
              console.log('Hash:', window.location.hash.substring(0, 50));
              window.location.replace('/auth/callback' + window.location.hash);
            }
          `
        }} />
        <script dangerouslySetInnerHTML={{
          __html: `(function(w,r){w._rwq=r;w[r]=w[r]||function(){(w[r].q=w[r].q||[]).push(arguments)}})(window,'rewardful');`
        }} />
        <script async src="https://r.wdfl.co/rw.js" data-rewardful="4fe255" />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}