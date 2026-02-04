import Head from 'next/head';
import dynamic from 'next/dynamic';

/**
 * Lightweight map page for the mobile app's "Check Destination Parking" feature.
 * Loaded in a WebView with URL params: ?lat=X&lng=Y&address=X&permitZone=X
 *
 * No header/footer - full-screen map optimized for mobile WebView embedding.
 */

const DestinationMapView = dynamic(() => import('../components/DestinationMapView'), {
  ssr: false,
  loading: () => (
    <div style={{
      width: '100%',
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#F5F7FA',
      fontFamily: 'system-ui',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: '36px',
          height: '36px',
          border: '3px solid #E9ECEF',
          borderTopColor: '#0066FF',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
          margin: '0 auto 10px',
        }} />
        <div style={{ fontSize: '14px', color: '#6C727A' }}>Loading map...</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    </div>
  ),
});

export default function DestinationMapPage() {
  return (
    <>
      <Head>
        <title>Destination Parking Check | Autopilot America</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <style>{`
          html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; }
          #__next { height: 100%; }
        `}</style>
      </Head>
      <DestinationMapView />
    </>
  );
}
