import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* Google Fonts: Space Grotesk + Inter */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700;800&display=swap" rel="stylesheet" />

        {/* OAuth redirect - must run before ANY page renders. Skip in mobile WebView. */}
        <script dangerouslySetInnerHTML={{
          __html: `
            if (!(window.location.search && window.location.search.indexOf('mobile_access_token') !== -1)) {
              if (window.location.pathname === '/' && window.location.hash && window.location.hash.includes('access_token')) {
                console.log('_document.tsx: Redirecting OAuth tokens to callback');
                window.location.replace('/auth/callback' + window.location.hash);
              }
            }
          `
        }} />
        {/* Rewardful affiliate tracking — skip in mobile WebView (detected by URL param).
            Rewardful's rw.js accesses DOM APIs (document.querySelector, document.cookie) during
            init that can crash inside WKWebView/Android WebView during React hydration. */}
        <script dangerouslySetInnerHTML={{
          __html: `
            if (!(window.location.search && window.location.search.indexOf('mobile_access_token') !== -1)) {
              (function(w,r){w._rwq=r;w[r]=w[r]||function(){(w[r].q=w[r].q||[]).push(arguments)}})(window,'rewardful');
              var s=document.createElement('script');s.async=true;s.src='https://r.wdfl.co/rw.js';s.dataset.rewardful='4fe255';document.head.appendChild(s);
            }
          `
        }} />
      </Head>
      <body>
        <Main />
        <NextScript />
      </body>
    </Html>
  )
}