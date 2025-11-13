import { Html, Head, Main, NextScript } from 'next/document'

export default function Document() {
  return (
    <Html lang="en">
      <Head>
        {/* OAuth redirect - must run before ANY page renders */}
        <script dangerouslySetInnerHTML={{
          __html: `
            if (window.location.pathname === '/' && window.location.hash && window.location.hash.includes('access_token')) {
              window.location.href = '/auth/callback' + window.location.hash;
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