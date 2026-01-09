/**
 * Property Tax Appeal Assistant - Sellable Assist Mode
 *
 * User flow:
 * 1. Landing/Lookup (free) - Enter address or PIN
 * 2. Analysis (free) - See opportunity score and estimated savings
 * 3. Paywall ($179) - Consent and payment
 * 4. Preparing - Generate appeal letter
 * 5. Complete - Download appeal packet
 */

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { supabase } from '../lib/supabase';
import MobileNav from '../components/MobileNav';
import {
  trackPropertyTaxPageViewed,
  trackPropertyTaxAnalysisComplete,
  trackPropertyTaxCheckoutStarted,
  trackPropertyTaxCheckoutCompleted,
  trackPropertyTaxLetterGenerated,
  trackPropertyTaxLetterCopied
} from '../lib/analytics';

// Brand Colors
const COLORS = {
  deepHarbor: '#0F172A',
  regulatory: '#2563EB',
  regulatoryDark: '#1d4ed8',
  regulatoryLight: '#3B82F6',
  concrete: '#F8FAFC',
  signal: '#10B981',
  signalLight: '#34D399',
  graphite: '#1E293B',
  slate: '#64748B',
  border: '#E2E8F0',
  warning: '#F59E0B',
  warningLight: '#FBBF24',
  danger: '#EF4444',
  white: '#FFFFFF',
};

// Product pricing
const PRICE = 179;

// Appeal stages for sellable flow
type AppealStage = 'lookup' | 'analysis' | 'paywall' | 'preparing' | 'complete';

interface PropertyData {
  pin: string;
  pinFormatted: string;
  address: string;
  city: string;
  township: string;
  propertyClass: string;
  propertyClassDescription: string;
  yearBuilt: number | null;
  squareFootage: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  assessedValue: number | null;
  marketValue: number | null;
  priorAssessedValue: number | null;
}

interface AnalysisData {
  opportunityScore: number;
  estimatedOvervaluation: number;
  estimatedTaxSavings: number;
  medianComparableValue: number;
  comparableCount: number;
  appealGrounds: string[];
  confidence: 'high' | 'medium' | 'low';
}

interface ComparableProperty {
  pin: string;
  pinFormatted: string;
  address: string;
  squareFootage: number | null;
  yearBuilt: number | null;
  assessedValue: number | null;
  valuePerSqft: number | null;
}

interface AppealData {
  id?: string;
  property: PropertyData;
  analysis: AnalysisData;
  comparables: ComparableProperty[];
  appealLetter?: string;
  paidAt?: string;
}

// Disclaimer component
function Disclaimer() {
  return (
    <div style={{
      marginTop: '24px',
      padding: '12px 16px',
      backgroundColor: '#F1F5F9',
      borderRadius: '8px',
      fontSize: '12px',
      color: COLORS.slate,
      lineHeight: '1.6'
    }}>
      <strong>Important:</strong> This service provides data analysis and document preparation only.
      We are not attorneys and do not provide legal advice. Filing deadlines are set by Cook County;
      verify current deadlines at{' '}
      <a href="https://www.cookcountyboardofreview.com" target="_blank" rel="noopener noreferrer" style={{ color: COLORS.regulatory }}>
        cookcountyboardofreview.com
      </a>{' '}
      before submitting. Estimated savings are not guaranteed. Appeal outcomes are determined by the Cook County Board of Review.
    </div>
  );
}

export default function PropertyTax() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState<AppealStage>('lookup');

  // Lookup state
  const [lookupMethod, setLookupMethod] = useState<'address' | 'pin'>('address');
  const [addressInput, setAddressInput] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [searchResults, setSearchResults] = useState<PropertyData[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  // Analysis state
  const [appealData, setAppealData] = useState<AppealData | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState('');

  // Paywall state
  const [consentAnalysis, setConsentAnalysis] = useState(false);
  const [consentNotLegal, setConsentNotLegal] = useState(false);
  const [processing, setProcessing] = useState(false);

  // Preparation state
  const [preparingProgress, setPreparingProgress] = useState(0);

  useEffect(() => {
    checkAuth();
    handleReturnFromStripe();
    trackPropertyTaxPageViewed();
  }, []);

  // Handle return from Stripe Checkout
  async function handleReturnFromStripe() {
    const urlParams = new URLSearchParams(window.location.search);
    const success = urlParams.get('success');
    const sessionId = urlParams.get('session_id');
    const canceled = urlParams.get('canceled');
    const appealId = urlParams.get('appeal_id');

    if (success === 'true' && sessionId) {
      // Payment successful - load the appeal and generate letter
      setStage('preparing');
      setPreparingProgress(10);

      try {
        const { data: { session: authSession } } = await supabase.auth.getSession();
        if (!authSession) return;

        // Get the appeal details
        const appealsResponse = await fetch('/api/property-tax/appeals', {
          headers: { 'Authorization': `Bearer ${authSession.access_token}` }
        });
        const appealsData = await appealsResponse.json();

        // Find the most recent paid appeal
        const paidAppeal = appealsData.appeals?.find((a: any) =>
          a.status === 'paid' || a.stripe_session_id === sessionId
        );

        if (paidAppeal) {
          setPreparingProgress(30);

          // Set appeal data
          setAppealData({
            id: paidAppeal.id,
            property: {
              pin: paidAppeal.pin,
              pinFormatted: paidAppeal.pin,
              address: paidAppeal.address,
              city: 'Chicago',
              township: paidAppeal.township,
              propertyClass: '',
              propertyClassDescription: '',
              yearBuilt: null,
              squareFootage: null,
              bedrooms: null,
              bathrooms: null,
              assessedValue: paidAppeal.current_assessed_value,
              marketValue: paidAppeal.current_market_value,
              priorAssessedValue: null
            },
            analysis: {
              opportunityScore: paidAppeal.opportunity_score || 0,
              estimatedOvervaluation: paidAppeal.current_assessed_value - paidAppeal.proposed_assessed_value,
              estimatedTaxSavings: paidAppeal.estimated_tax_savings || 0,
              medianComparableValue: paidAppeal.proposed_assessed_value,
              comparableCount: 0,
              appealGrounds: paidAppeal.appeal_grounds || [],
              confidence: 'high'
            },
            comparables: [],
            paidAt: paidAppeal.paid_at
          });

          // Track checkout completed
          trackPropertyTaxCheckoutCompleted({
            opportunityScore: paidAppeal.opportunity_score || 0,
            estimatedSavings: paidAppeal.estimated_tax_savings || 0,
            township: paidAppeal.township
          });

          // Check if letter already exists
          if (paidAppeal.appeal_letter) {
            setAppealData(prev => prev ? {
              ...prev,
              appealLetter: paidAppeal.appeal_letter
            } : null);
            setPreparingProgress(100);
            setStage('complete');
          } else {
            // Generate the letter
            setPreparingProgress(50);
            const letterResponse = await fetch('/api/property-tax/generate-letter', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authSession.access_token}`
              },
              body: JSON.stringify({ appealId: paidAppeal.id })
            });

            setPreparingProgress(80);
            const letterData = await letterResponse.json();

            if (letterResponse.ok) {
              setAppealData(prev => prev ? {
                ...prev,
                appealLetter: letterData.letter
              } : null);

              // Track letter generated
              trackPropertyTaxLetterGenerated({
                township: paidAppeal.township,
                opportunityScore: paidAppeal.opportunity_score || 0
              });
            }

            setPreparingProgress(100);
            setTimeout(() => setStage('complete'), 500);
          }
        }
      } catch (error) {
        console.error('Error handling Stripe return:', error);
        setStage('lookup');
      }

      // Clean up URL
      window.history.replaceState({}, '', '/property-tax');
    } else if (canceled === 'true') {
      // User canceled - return to analysis if we have appeal data
      if (appealId) {
        // Could load appeal data here, but for now just go to lookup
        setStage('lookup');
      }
      window.history.replaceState({}, '', '/property-tax');
    }
  }

  async function checkAuth() {
    try {
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) {
        router.push('/login?redirect=/property-tax');
        return;
      }
      setUser(currentUser);
    } catch (error) {
      console.error('Error checking auth:', error);
      router.push('/login?redirect=/property-tax');
    } finally {
      setLoading(false);
    }
  }

  async function searchProperty() {
    setSearching(true);
    setSearchError('');
    setSearchResults([]);

    try {
      const body = lookupMethod === 'address'
        ? { address: addressInput }
        : { pin: pinInput };

      // Lookup doesn't require auth - uses IP-based rate limiting
      const response = await fetch('/api/property-tax/lookup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to search property');
      }

      if (data.properties && data.properties.length > 0) {
        setSearchResults(data.properties);
      } else if (data.property) {
        setSearchResults([data.property]);
      } else {
        setSearchError('No properties found. Please check your address or PIN.');
      }
    } catch (error) {
      console.error('Search error:', error);
      setSearchError(error instanceof Error ? error.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  }

  async function analyzeProperty(property: PropertyData) {
    setAnalyzing(true);
    setAnalysisError('');

    try {
      const { data: { session } } = await supabase.auth.getSession();

      const response = await fetch('/api/property-tax/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`
        },
        body: JSON.stringify({ pin: property.pin })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Analysis failed');
      }

      setAppealData({
        property: data.property,
        analysis: data.analysis,
        comparables: data.comparables || []
      });

      // Track analysis complete
      trackPropertyTaxAnalysisComplete({
        opportunityScore: data.analysis.opportunityScore,
        estimatedSavings: data.analysis.estimatedTaxSavings,
        township: data.property.township,
        confidence: data.analysis.confidence
      });

      setStage('analysis');
    } catch (error) {
      console.error('Analysis error:', error);
      setAnalysisError(error instanceof Error ? error.message : 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  }

  async function handlePayment() {
    if (!appealData || !consentAnalysis || !consentNotLegal) return;

    setProcessing(true);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        throw new Error('Please log in to continue');
      }

      // Step 1: Create the appeal record (this will check deadlines)
      const startResponse = await fetch('/api/property-tax/start-appeal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          pin: appealData.property.pin,
          appealGrounds: appealData.analysis.appealGrounds
        })
      });

      const startData = await startResponse.json();

      if (!startResponse.ok) {
        throw new Error(startData.message || startData.error || 'Failed to start appeal');
      }

      // Update appeal data with ID
      const appealId = startData.appeal.id;
      setAppealData({
        ...appealData,
        id: appealId
      });

      // Track checkout started
      trackPropertyTaxCheckoutStarted({
        opportunityScore: appealData.analysis.opportunityScore,
        estimatedSavings: appealData.analysis.estimatedTaxSavings,
        township: appealData.property.township
      });

      // Step 2: Create Stripe Checkout session
      const checkoutResponse = await fetch('/api/property-tax/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          appealId: appealId,
          pin: appealData.property.pin,
          address: appealData.property.address,
          township: appealData.property.township,
          assessedValue: appealData.property.assessedValue,
          estimatedSavings: appealData.analysis.estimatedTaxSavings,
          opportunityScore: appealData.analysis.opportunityScore
        })
      });

      const checkoutData = await checkoutResponse.json();

      if (!checkoutResponse.ok) {
        throw new Error(checkoutData.message || checkoutData.error || 'Failed to create checkout');
      }

      // Step 3: Redirect to Stripe Checkout
      if (checkoutData.url) {
        window.location.href = checkoutData.url;
      } else {
        throw new Error('No checkout URL returned');
      }

    } catch (error) {
      console.error('Payment/preparation error:', error);
      alert(error instanceof Error ? error.message : 'An error occurred. Please try again.');
      setProcessing(false);
    }
  }

  function getScoreColor(score: number) {
    if (score >= 70) return COLORS.signal;
    if (score >= 40) return COLORS.warning;
    return COLORS.slate;
  }

  function getConfidenceLabel(confidence: string) {
    switch (confidence) {
      case 'high': return { label: 'Strong Case', color: COLORS.signal };
      case 'medium': return { label: 'Moderate Case', color: COLORS.warning };
      default: return { label: 'Weak Case', color: COLORS.danger };
    }
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  if (loading) {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: COLORS.concrete,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
      }}>
        <div style={{
          width: '40px',
          height: '40px',
          border: `3px solid ${COLORS.border}`,
          borderTopColor: COLORS.regulatory,
          borderRadius: '50%',
          animation: 'spin 1s linear infinite'
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: COLORS.concrete, fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <Head>
        <title>Lower Your Property Taxes - Autopilot America</title>
        <meta name="description" content="Analyze your Cook County property assessment and get a complete appeal package to reduce your property taxes." />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />
        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
          @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
          @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
          @keyframes scaleIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
          @keyframes ringPulse { 0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4); } 70% { box-shadow: 0 0 0 15px rgba(16, 185, 129, 0); } 100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); } }
          @keyframes shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }

          @media (max-width: 768px) {
            .nav-desktop { display: none !important; }
            .nav-mobile { display: flex !important; }
            .hero-title { font-size: 28px !important; }
            .hero-subtitle { font-size: 16px !important; }
            .stats-grid { grid-template-columns: 1fr !important; }
            .property-grid { grid-template-columns: 1fr !important; }
          }
          .nav-mobile { display: none; }

          .card-hover { transition: all 0.2s ease; }
          .card-hover:hover { transform: translateY(-2px); box-shadow: 0 8px 25px -5px rgba(0, 0, 0, 0.1); }

          .btn-primary { transition: all 0.2s ease; }
          .btn-primary:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(37, 99, 235, 0.4); }
          .btn-primary:active:not(:disabled) { transform: translateY(0); }

          .btn-success { transition: all 0.2s ease; }
          .btn-success:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4); }

          .input-focus:focus { border-color: #2563EB; box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1); }

          .animate-fade-in { animation: fadeIn 0.4s ease-out; }
          .animate-scale-in { animation: scaleIn 0.3s ease-out; }
        `}</style>
      </Head>

      {/* Navigation */}
      <nav style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: '72px',
        backgroundColor: 'rgba(255,255,255,0.95)',
        backdropFilter: 'blur(12px)',
        borderBottom: `1px solid ${COLORS.border}`,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 32px'
      }}>
        <div onClick={() => router.push('/')} style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '8px',
            background: COLORS.regulatory,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
          </div>
          <span style={{
            fontSize: '18px',
            fontWeight: '700',
            color: COLORS.graphite,
            fontFamily: '"Space Grotesk", sans-serif',
            letterSpacing: '-0.5px'
          }}>
            Autopilot America
          </span>
        </div>

        <div className="nav-desktop" style={{ display: 'flex', gap: '24px', alignItems: 'center' }}>
          <button
            onClick={() => router.push('/settings')}
            style={{
              color: COLORS.slate,
              background: 'none',
              border: 'none',
              fontSize: '14px',
              fontWeight: '500',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
            Back to Settings
          </button>
        </div>

        <div className="nav-mobile" style={{ display: 'none', alignItems: 'center' }}>
          <MobileNav user={user} />
        </div>
      </nav>

      {/* Main Content */}
      <main style={{
        maxWidth: '900px',
        margin: '0 auto',
        padding: '104px 24px 60px 24px'
      }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '40px' }} className="animate-fade-in">
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 14px',
            backgroundColor: '#EEF2FF',
            borderRadius: '100px',
            marginBottom: '16px'
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.regulatory} strokeWidth="2">
              <path d="M3 21h18M3 10h18M3 7l9-4 9 4M4 10v11M20 10v11"/>
              <circle cx="12" cy="14" r="2"/>
            </svg>
            <span style={{ fontSize: '13px', fontWeight: '600', color: COLORS.regulatory }}>
              Cook County Property Tax Appeals
            </span>
          </div>
          <h1 className="hero-title" style={{
            fontSize: '40px',
            fontWeight: '800',
            color: COLORS.graphite,
            margin: '0 0 16px 0',
            fontFamily: '"Space Grotesk", sans-serif',
            letterSpacing: '-1.5px',
            lineHeight: '1.1'
          }}>
            Lower Your Property Taxes
          </h1>
          <p className="hero-subtitle" style={{
            fontSize: '18px',
            color: COLORS.slate,
            margin: 0,
            lineHeight: '1.7',
            maxWidth: '560px',
            marginLeft: 'auto',
            marginRight: 'auto'
          }}>
            Get a complete appeal package to challenge your Cook County property assessment.
            <span style={{ color: COLORS.signal, fontWeight: '600' }}> Typical successful appeals save $300-$1,500/year.</span>
          </p>
        </div>

        {/* Progress Steps */}
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '8px',
          marginBottom: '32px'
        }}>
          {[
            { key: 'lookup', label: 'Find Property' },
            { key: 'analysis', label: 'Analysis' },
            { key: 'paywall', label: 'Get Package' },
            { key: 'complete', label: 'Download' }
          ].map((step, i) => {
            const stages: AppealStage[] = ['lookup', 'analysis', 'paywall', 'preparing', 'complete'];
            const currentIndex = stages.indexOf(stage);
            const stepIndex = stages.indexOf(step.key as AppealStage);
            const isActive = stage === step.key || (step.key === 'paywall' && stage === 'preparing');
            const isComplete = stepIndex < currentIndex || (step.key === 'paywall' && stage === 'complete');

            return (
              <div key={step.key} style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '4px'
                }}>
                  <div style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    backgroundColor: isActive ? COLORS.regulatory : isComplete ? COLORS.signal : COLORS.border,
                    color: isActive || isComplete ? 'white' : COLORS.slate,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '14px',
                    fontWeight: '600'
                  }}>
                    {isComplete ? '✓' : i + 1}
                  </div>
                  <span style={{
                    fontSize: '11px',
                    color: isActive ? COLORS.graphite : COLORS.slate,
                    fontWeight: isActive ? '600' : '400'
                  }}>
                    {step.label}
                  </span>
                </div>
                {i < 3 && (
                  <div style={{
                    width: '40px',
                    height: '2px',
                    backgroundColor: isComplete ? COLORS.signal : COLORS.border,
                    marginBottom: '20px'
                  }} />
                )}
              </div>
            );
          })}
        </div>

        {/* Stage: Property Lookup */}
        {stage === 'lookup' && (
          <div className="animate-fade-in" style={{
            backgroundColor: 'white',
            borderRadius: '20px',
            padding: '36px',
            border: `1px solid ${COLORS.border}`,
            boxShadow: '0 4px 20px -2px rgba(0, 0, 0, 0.06)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
              <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '12px',
                background: `linear-gradient(135deg, ${COLORS.regulatory} 0%, ${COLORS.regulatoryLight} 100%)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
                  <circle cx="12" cy="10" r="3"/>
                </svg>
              </div>
              <h2 style={{
                fontSize: '22px',
                fontWeight: '700',
                color: COLORS.graphite,
                margin: 0,
                fontFamily: '"Space Grotesk", sans-serif'
              }}>
                Find Your Property
              </h2>
            </div>
            <p style={{ fontSize: '15px', color: COLORS.slate, margin: '0 0 28px 0', paddingLeft: '52px' }}>
              Search by address or enter your 14-digit Property Index Number (PIN)
            </p>

            {/* Search Method Toggle */}
            <div style={{
              display: 'flex',
              gap: '8px',
              marginBottom: '20px'
            }}>
              <button
                onClick={() => setLookupMethod('address')}
                style={{
                  flex: 1,
                  padding: '12px',
                  borderRadius: '8px',
                  border: `2px solid ${lookupMethod === 'address' ? COLORS.regulatory : COLORS.border}`,
                  backgroundColor: lookupMethod === 'address' ? `${COLORS.regulatory}10` : 'white',
                  color: lookupMethod === 'address' ? COLORS.regulatory : COLORS.slate,
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: 'pointer'
                }}
              >
                Search by Address
              </button>
              <button
                onClick={() => setLookupMethod('pin')}
                style={{
                  flex: 1,
                  padding: '12px',
                  borderRadius: '8px',
                  border: `2px solid ${lookupMethod === 'pin' ? COLORS.regulatory : COLORS.border}`,
                  backgroundColor: lookupMethod === 'pin' ? `${COLORS.regulatory}10` : 'white',
                  color: lookupMethod === 'pin' ? COLORS.regulatory : COLORS.slate,
                  fontSize: '14px',
                  fontWeight: '500',
                  cursor: 'pointer'
                }}
              >
                Enter PIN
              </button>
            </div>

            {/* Search Input */}
            {lookupMethod === 'address' ? (
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: COLORS.graphite, marginBottom: '8px' }}>
                  Property Address
                </label>
                <input
                  type="text"
                  value={addressInput}
                  onChange={(e) => setAddressInput(e.target.value)}
                  placeholder="e.g., 123 N Main St"
                  style={{
                    width: '100%',
                    padding: '14px 16px',
                    borderRadius: '10px',
                    border: `1px solid ${COLORS.border}`,
                    fontSize: '16px',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && searchProperty()}
                />
              </div>
            ) : (
              <div style={{ marginBottom: '20px' }}>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', color: COLORS.graphite, marginBottom: '8px' }}>
                  Property Index Number (PIN)
                </label>
                <input
                  type="text"
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value)}
                  placeholder="e.g., 14-08-203-001-0000"
                  style={{
                    width: '100%',
                    padding: '14px 16px',
                    borderRadius: '10px',
                    border: `1px solid ${COLORS.border}`,
                    fontSize: '16px',
                    outline: 'none',
                    boxSizing: 'border-box'
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && searchProperty()}
                />
                <p style={{ fontSize: '12px', color: COLORS.slate, margin: '8px 0 0 0' }}>
                  Find your PIN on your property tax bill or at cookcountyassessor.com
                </p>
              </div>
            )}

            {/* Search Button */}
            <button
              className="btn-primary"
              onClick={searchProperty}
              disabled={searching || (lookupMethod === 'address' ? !addressInput : !pinInput)}
              style={{
                width: '100%',
                padding: '16px',
                borderRadius: '12px',
                border: 'none',
                background: searching || (lookupMethod === 'address' ? !addressInput : !pinInput)
                  ? COLORS.border
                  : `linear-gradient(135deg, ${COLORS.regulatory} 0%, ${COLORS.regulatoryDark} 100%)`,
                color: 'white',
                fontSize: '16px',
                fontWeight: '600',
                cursor: searching ? 'wait' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '10px'
              }}
            >
              {searching ? (
                <>
                  <div style={{
                    width: '18px',
                    height: '18px',
                    border: '2px solid rgba(255,255,255,0.3)',
                    borderTopColor: 'white',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite'
                  }} />
                  Searching...
                </>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <circle cx="11" cy="11" r="8"/>
                    <path d="M21 21l-4.35-4.35"/>
                  </svg>
                  Check My Property
                </>
              )}
            </button>

            {/* Error Message */}
            {searchError && (
              <div style={{
                marginTop: '16px',
                padding: '12px 16px',
                backgroundColor: '#FEF2F2',
                border: '1px solid #FECACA',
                borderRadius: '8px',
                color: '#DC2626',
                fontSize: '14px'
              }}>
                {searchError}
              </div>
            )}

            {/* Search Results */}
            {searchResults.length > 0 && (
              <div style={{ marginTop: '24px' }}>
                <h3 style={{ fontSize: '16px', fontWeight: '600', color: COLORS.graphite, margin: '0 0 16px 0' }}>
                  {searchResults.length === 1 ? 'Property Found' : `${searchResults.length} Properties Found`}
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {searchResults.map((property) => (
                    <div
                      key={property.pin}
                      onClick={() => analyzeProperty(property)}
                      style={{
                        padding: '16px',
                        borderRadius: '12px',
                        border: `1px solid ${COLORS.border}`,
                        backgroundColor: '#FAFAFA',
                        cursor: analyzing ? 'wait' : 'pointer',
                        transition: 'all 0.2s'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                          <p style={{ fontSize: '16px', fontWeight: '600', color: COLORS.graphite, margin: '0 0 4px 0' }}>
                            {property.address || 'Address not available'}
                          </p>
                          <p style={{ fontSize: '13px', color: COLORS.slate, margin: '0 0 8px 0' }}>
                            PIN: {property.pinFormatted} | {property.township} Township
                          </p>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          {property.assessedValue && (
                            <>
                              <p style={{ fontSize: '14px', fontWeight: '600', color: COLORS.graphite, margin: '0 0 2px 0' }}>
                                ${property.assessedValue.toLocaleString()}
                              </p>
                              <p style={{ fontSize: '12px', color: COLORS.slate, margin: 0 }}>
                                Assessed Value
                              </p>
                            </>
                          )}
                        </div>
                      </div>
                      <div style={{
                        marginTop: '12px',
                        paddingTop: '12px',
                        borderTop: `1px solid ${COLORS.border}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between'
                      }}>
                        <span style={{ fontSize: '13px', color: COLORS.regulatory, fontWeight: '500' }}>
                          Analyze this property
                        </span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.regulatory} strokeWidth="2">
                          <path d="M5 12h14M12 5l7 7-7 7"/>
                        </svg>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Analyzing Indicator */}
            {analyzing && (
              <div style={{
                marginTop: '16px',
                padding: '16px',
                backgroundColor: `${COLORS.regulatory}10`,
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
              }}>
                <div style={{
                  width: '24px',
                  height: '24px',
                  border: `3px solid ${COLORS.border}`,
                  borderTopColor: COLORS.regulatory,
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite'
                }} />
                <div>
                  <p style={{ fontSize: '14px', fontWeight: '500', color: COLORS.graphite, margin: 0 }}>
                    Analyzing property...
                  </p>
                  <p style={{ fontSize: '12px', color: COLORS.slate, margin: '4px 0 0 0' }}>
                    Finding comparable properties and calculating potential savings
                  </p>
                </div>
              </div>
            )}

            {analysisError && (
              <div style={{
                marginTop: '16px',
                padding: '12px 16px',
                backgroundColor: '#FEF2F2',
                border: '1px solid #FECACA',
                borderRadius: '8px',
                color: '#DC2626',
                fontSize: '14px'
              }}>
                {analysisError}
              </div>
            )}

            <Disclaimer />
          </div>
        )}

        {/* Stage: Analysis Results (Free Preview) */}
        {stage === 'analysis' && appealData && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Opportunity Score Card */}
            <div style={{
              backgroundColor: 'white',
              borderRadius: '20px',
              padding: '40px 32px',
              border: `1px solid ${COLORS.border}`,
              boxShadow: '0 4px 20px -2px rgba(0, 0, 0, 0.06)',
              textAlign: 'center',
              position: 'relative',
              overflow: 'hidden'
            }}>
              {/* Background decoration */}
              <div style={{
                position: 'absolute',
                top: '-100px',
                right: '-100px',
                width: '250px',
                height: '250px',
                borderRadius: '50%',
                background: `radial-gradient(circle, ${getScoreColor(appealData.analysis.opportunityScore)}10 0%, transparent 70%)`,
                pointerEvents: 'none'
              }} />
              <div style={{
                position: 'absolute',
                bottom: '-80px',
                left: '-80px',
                width: '200px',
                height: '200px',
                borderRadius: '50%',
                background: `radial-gradient(circle, ${COLORS.regulatory}08 0%, transparent 70%)`,
                pointerEvents: 'none'
              }} />

              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 16px',
                backgroundColor: '#F0FDF4',
                borderRadius: '100px',
                marginBottom: '20px'
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={COLORS.signal} strokeWidth="2.5">
                  <polyline points="20,6 9,17 4,12"/>
                </svg>
                <span style={{ fontSize: '13px', fontWeight: '600', color: COLORS.signal }}>
                  Free Analysis Complete
                </span>
              </div>

              <h2 style={{
                fontSize: '24px',
                fontWeight: '700',
                color: COLORS.graphite,
                margin: '0 0 28px 0',
                fontFamily: '"Space Grotesk", sans-serif'
              }}>
                Your Appeal Opportunity
              </h2>

              {/* Score Circle with animation */}
              <div style={{
                width: '160px',
                height: '160px',
                borderRadius: '50%',
                background: `conic-gradient(${getScoreColor(appealData.analysis.opportunityScore)} ${appealData.analysis.opportunityScore * 3.6}deg, ${COLORS.border} 0deg)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 24px auto',
                animation: appealData.analysis.opportunityScore >= 70 ? 'ringPulse 2s ease-in-out infinite' : 'none',
                position: 'relative'
              }}>
                <div style={{
                  width: '130px',
                  height: '130px',
                  borderRadius: '50%',
                  backgroundColor: 'white',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.04)'
                }}>
                  <span style={{
                    fontSize: '48px',
                    fontWeight: '800',
                    color: getScoreColor(appealData.analysis.opportunityScore),
                    fontFamily: '"Space Grotesk", sans-serif',
                    lineHeight: 1
                  }}>
                    {appealData.analysis.opportunityScore}
                  </span>
                  <span style={{ fontSize: '13px', color: COLORS.slate, marginTop: '4px' }}>out of 100</span>
                </div>
              </div>

              {/* Confidence Badge */}
              <div style={{
                display: 'inline-block',
                padding: '8px 16px',
                borderRadius: '100px',
                backgroundColor: `${getConfidenceLabel(appealData.analysis.confidence).color}15`,
                color: getConfidenceLabel(appealData.analysis.confidence).color,
                fontSize: '14px',
                fontWeight: '600',
                marginBottom: '24px'
              }}>
                {getConfidenceLabel(appealData.analysis.confidence).label}
              </div>

              {/* Key Stats */}
              <div className="stats-grid" style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '16px',
                marginTop: '20px',
                position: 'relative',
                zIndex: 1
              }}>
                <div className="card-hover" style={{
                  padding: '20px 16px',
                  backgroundColor: '#F0FDF4',
                  borderRadius: '14px',
                  border: '1px solid #BBF7D0'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginBottom: '8px' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={COLORS.signal} strokeWidth="2">
                      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
                    </svg>
                  </div>
                  <p style={{ fontSize: '32px', fontWeight: '800', color: COLORS.signal, margin: '0 0 4px 0', fontFamily: '"Space Grotesk", sans-serif' }}>
                    ${Math.round(appealData.analysis.estimatedTaxSavings).toLocaleString()}
                  </p>
                  <p style={{ fontSize: '13px', color: '#166534', margin: 0, fontWeight: '500' }}>
                    Est. Annual Savings
                  </p>
                </div>
                <div className="card-hover" style={{
                  padding: '20px 16px',
                  backgroundColor: '#FEF3C7',
                  borderRadius: '14px',
                  border: '1px solid #FDE68A'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginBottom: '8px' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#92400E" strokeWidth="2">
                      <path d="M12 19V5M5 12l7-7 7 7"/>
                    </svg>
                  </div>
                  <p style={{ fontSize: '32px', fontWeight: '800', color: '#92400E', margin: '0 0 4px 0', fontFamily: '"Space Grotesk", sans-serif' }}>
                    ${Math.round(appealData.analysis.estimatedOvervaluation).toLocaleString()}
                  </p>
                  <p style={{ fontSize: '13px', color: '#92400E', margin: 0, fontWeight: '500' }}>
                    Potential Overassessment
                  </p>
                </div>
                <div className="card-hover" style={{
                  padding: '20px 16px',
                  backgroundColor: '#EEF2FF',
                  borderRadius: '14px',
                  border: '1px solid #C7D2FE'
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginBottom: '8px' }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={COLORS.regulatory} strokeWidth="2">
                      <path d="M3 21h18M3 10h18M3 7l9-4 9 4M4 10v11M20 10v11"/>
                    </svg>
                  </div>
                  <p style={{ fontSize: '32px', fontWeight: '800', color: COLORS.regulatory, margin: '0 0 4px 0', fontFamily: '"Space Grotesk", sans-serif' }}>
                    {appealData.analysis.comparableCount}
                  </p>
                  <p style={{ fontSize: '13px', color: COLORS.regulatoryDark, margin: 0, fontWeight: '500' }}>
                    Comparable Properties
                  </p>
                </div>
              </div>
            </div>

            {/* Property Summary */}
            <div style={{
              backgroundColor: 'white',
              borderRadius: '16px',
              padding: '24px',
              border: `1px solid ${COLORS.border}`
            }}>
              <h3 style={{ fontSize: '16px', fontWeight: '600', color: COLORS.graphite, margin: '0 0 16px 0' }}>
                Your Property
              </h3>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '16px'
              }}>
                <div>
                  <p style={{ fontSize: '13px', color: COLORS.slate, margin: '0 0 4px 0' }}>Address</p>
                  <p style={{ fontSize: '15px', fontWeight: '500', color: COLORS.graphite, margin: 0 }}>
                    {appealData.property.address}
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: '13px', color: COLORS.slate, margin: '0 0 4px 0' }}>PIN</p>
                  <p style={{ fontSize: '15px', fontWeight: '500', color: COLORS.graphite, margin: 0 }}>
                    {appealData.property.pinFormatted}
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: '13px', color: COLORS.slate, margin: '0 0 4px 0' }}>Current Assessed Value</p>
                  <p style={{ fontSize: '15px', fontWeight: '500', color: COLORS.graphite, margin: 0 }}>
                    ${appealData.property.assessedValue?.toLocaleString() || 'N/A'}
                  </p>
                </div>
                <div>
                  <p style={{ fontSize: '13px', color: COLORS.slate, margin: '0 0 4px 0' }}>Median Comparable Value</p>
                  <p style={{ fontSize: '15px', fontWeight: '500', color: COLORS.signal, margin: 0 }}>
                    ${Math.round(appealData.analysis.medianComparableValue).toLocaleString()}
                  </p>
                </div>
              </div>
            </div>

            {/* CTA to Paywall */}
            {appealData.analysis.opportunityScore >= 40 ? (
              <div style={{
                background: `linear-gradient(135deg, ${COLORS.signal} 0%, #059669 100%)`,
                borderRadius: '20px',
                padding: '40px 32px',
                textAlign: 'center',
                color: 'white',
                position: 'relative',
                overflow: 'hidden'
              }}>
                {/* Decorative elements */}
                <div style={{
                  position: 'absolute',
                  top: '-30px',
                  right: '-30px',
                  width: '120px',
                  height: '120px',
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.1)',
                  pointerEvents: 'none'
                }} />
                <div style={{
                  position: 'absolute',
                  bottom: '-40px',
                  left: '-40px',
                  width: '150px',
                  height: '150px',
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.08)',
                  pointerEvents: 'none'
                }} />

                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 16px',
                  backgroundColor: 'rgba(255,255,255,0.2)',
                  borderRadius: '100px',
                  marginBottom: '16px'
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                    <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
                    <polyline points="22,4 12,14.01 9,11.01"/>
                  </svg>
                  <span style={{ fontSize: '13px', fontWeight: '600' }}>Strong Case Detected</span>
                </div>

                <h3 style={{
                  fontSize: '28px',
                  fontWeight: '800',
                  margin: '0 0 12px 0',
                  fontFamily: '"Space Grotesk", sans-serif',
                  position: 'relative'
                }}>
                  You have a strong case for appeal!
                </h3>
                <p style={{ fontSize: '17px', margin: '0 0 28px 0', opacity: 0.95, maxWidth: '400px', marginLeft: 'auto', marginRight: 'auto' }}>
                  Get your complete appeal package for just <strong>${PRICE}</strong>
                </p>
                <button
                  className="btn-success"
                  onClick={() => setStage('paywall')}
                  style={{
                    padding: '18px 56px',
                    borderRadius: '12px',
                    border: 'none',
                    backgroundColor: 'white',
                    color: COLORS.signal,
                    fontSize: '18px',
                    fontWeight: '700',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '10px',
                    boxShadow: '0 4px 14px rgba(0,0,0,0.15)'
                  }}
                >
                  Get My Appeal Package
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                  </svg>
                </button>
              </div>
            ) : (
              <div style={{
                backgroundColor: '#FEF3C7',
                borderRadius: '16px',
                padding: '24px',
                border: '1px solid #FDE68A'
              }}>
                <h3 style={{ fontSize: '18px', fontWeight: '600', color: '#92400E', margin: '0 0 8px 0' }}>
                  Lower opportunity detected
                </h3>
                <p style={{ fontSize: '14px', color: '#92400E', margin: '0 0 16px 0' }}>
                  Based on our analysis, you may not have a strong case for appeal.
                  You can still proceed, but success is less likely.
                </p>
                <button
                  onClick={() => setStage('paywall')}
                  style={{
                    padding: '12px 24px',
                    borderRadius: '8px',
                    border: '1px solid #92400E',
                    backgroundColor: 'transparent',
                    color: '#92400E',
                    fontSize: '14px',
                    fontWeight: '600',
                    cursor: 'pointer'
                  }}
                >
                  Proceed Anyway - ${PRICE}
                </button>
              </div>
            )}

            <button
              onClick={() => {
                setStage('lookup');
                setAppealData(null);
                setSearchResults([]);
              }}
              style={{
                padding: '12px',
                borderRadius: '8px',
                border: `1px solid ${COLORS.border}`,
                backgroundColor: 'white',
                color: COLORS.slate,
                fontSize: '14px',
                cursor: 'pointer'
              }}
            >
              Search a different property
            </button>

            <Disclaimer />
          </div>
        )}

        {/* Stage: Paywall */}
        {stage === 'paywall' && appealData && (
          <div className="animate-fade-in" style={{
            backgroundColor: 'white',
            borderRadius: '20px',
            padding: '40px 36px',
            border: `1px solid ${COLORS.border}`,
            boxShadow: '0 4px 20px -2px rgba(0, 0, 0, 0.06)'
          }}>
            <div style={{ textAlign: 'center', marginBottom: '32px' }}>
              <div style={{
                width: '56px',
                height: '56px',
                borderRadius: '16px',
                background: `linear-gradient(135deg, ${COLORS.regulatory} 0%, ${COLORS.regulatoryLight} 100%)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px auto'
              }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                  <polyline points="14,2 14,8 20,8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                  <polyline points="10,9 9,9 8,9"/>
                </svg>
              </div>
              <h2 style={{
                fontSize: '28px',
                fontWeight: '800',
                color: COLORS.graphite,
                margin: '0 0 8px 0',
                fontFamily: '"Space Grotesk", sans-serif'
              }}>
                Get Your Appeal Package
              </h2>
              <p style={{ fontSize: '15px', color: COLORS.slate, margin: 0 }}>
                One-time payment. No recurring fees. No hidden costs.
              </p>
            </div>

            {/* What's Included */}
            <div style={{
              backgroundColor: '#F8FAFC',
              borderRadius: '16px',
              padding: '28px',
              marginBottom: '28px',
              border: '1px solid #E2E8F0'
            }}>
              <h3 style={{ fontSize: '17px', fontWeight: '700', color: COLORS.graphite, margin: '0 0 20px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={COLORS.signal} strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
                  <polyline points="22,4 12,14.01 9,11.01"/>
                </svg>
                What's Included:
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {[
                  { icon: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8M16 17H8', text: 'Professional appeal letter customized for your property' },
                  { icon: 'M3 21h18M3 10h18M3 7l9-4 9 4M4 10v11M20 10v11', text: 'Comparable properties analysis with supporting data' },
                  { icon: 'M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11', text: 'Filing instructions for Cook County Board of Review' },
                  { icon: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3', text: 'Downloadable packet ready to submit' }
                ].map((item, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <div style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '8px',
                      backgroundColor: `${COLORS.signal}15`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={COLORS.signal} strokeWidth="2.5">
                        <polyline points="20,6 9,17 4,12"/>
                      </svg>
                    </div>
                    <span style={{ fontSize: '15px', color: COLORS.graphite, lineHeight: '1.5' }}>{item.text}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Property Summary + Price */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '20px',
              background: `linear-gradient(135deg, #F0FDF4 0%, #DCFCE7 100%)`,
              borderRadius: '14px',
              marginBottom: '28px',
              border: '1px solid #BBF7D0'
            }}>
              <div>
                <p style={{ fontSize: '15px', fontWeight: '600', color: COLORS.graphite, margin: '0 0 4px 0' }}>
                  {appealData.property.address}
                </p>
                <p style={{ fontSize: '13px', color: '#166534', margin: 0, display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>
                  </svg>
                  Est. savings: <strong>${Math.round(appealData.analysis.estimatedTaxSavings).toLocaleString()}/year</strong>
                </p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <p style={{ fontSize: '36px', fontWeight: '800', color: COLORS.signal, margin: 0, fontFamily: '"Space Grotesk", sans-serif', lineHeight: 1 }}>
                  ${PRICE}
                </p>
                <p style={{ fontSize: '12px', color: '#166534', margin: '4px 0 0 0' }}>one-time</p>
              </div>
            </div>

            {/* Consent Checkboxes */}
            <div style={{ marginBottom: '24px' }}>
              <label style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                padding: '12px',
                borderRadius: '8px',
                border: `1px solid ${consentAnalysis ? COLORS.regulatory : COLORS.border}`,
                backgroundColor: consentAnalysis ? `${COLORS.regulatory}05` : 'white',
                cursor: 'pointer',
                marginBottom: '12px'
              }}>
                <input
                  type="checkbox"
                  checked={consentAnalysis}
                  onChange={(e) => setConsentAnalysis(e.target.checked)}
                  style={{ width: '20px', height: '20px', marginTop: '2px', accentColor: COLORS.regulatory }}
                />
                <span style={{ fontSize: '14px', color: COLORS.graphite, lineHeight: '1.5' }}>
                  I authorize Autopilot America to analyze my property assessment data using Cook County public records and prepare appeal documents on my behalf.
                </span>
              </label>

              <label style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px',
                padding: '12px',
                borderRadius: '8px',
                border: `1px solid ${consentNotLegal ? COLORS.regulatory : COLORS.border}`,
                backgroundColor: consentNotLegal ? `${COLORS.regulatory}05` : 'white',
                cursor: 'pointer'
              }}>
                <input
                  type="checkbox"
                  checked={consentNotLegal}
                  onChange={(e) => setConsentNotLegal(e.target.checked)}
                  style={{ width: '20px', height: '20px', marginTop: '2px', accentColor: COLORS.regulatory }}
                />
                <span style={{ fontSize: '14px', color: COLORS.graphite, lineHeight: '1.5' }}>
                  I understand this is <strong>not legal advice</strong> and I am responsible for filing the appeal myself.
                  Estimated savings are not guaranteed.
                </span>
              </label>
            </div>

            {/* Pay Button */}
            <button
              className="btn-primary"
              onClick={handlePayment}
              disabled={!consentAnalysis || !consentNotLegal || processing}
              style={{
                width: '100%',
                padding: '20px',
                borderRadius: '14px',
                border: 'none',
                background: consentAnalysis && consentNotLegal
                  ? `linear-gradient(135deg, ${COLORS.regulatory} 0%, ${COLORS.regulatoryDark} 100%)`
                  : COLORS.border,
                color: consentAnalysis && consentNotLegal ? 'white' : COLORS.slate,
                fontSize: '18px',
                fontWeight: '700',
                cursor: consentAnalysis && consentNotLegal && !processing ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '12px'
              }}
            >
              {processing ? (
                <>
                  <div style={{
                    width: '20px',
                    height: '20px',
                    border: '2px solid rgba(255,255,255,0.3)',
                    borderTopColor: 'white',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite'
                  }} />
                  Processing...
                </>
              ) : (
                <>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
                    <line x1="1" y1="10" x2="23" y2="10"/>
                  </svg>
                  Pay ${PRICE} & Get Package
                </>
              )}
            </button>

            <button
              onClick={() => setStage('analysis')}
              disabled={processing}
              style={{
                width: '100%',
                marginTop: '12px',
                padding: '14px',
                borderRadius: '10px',
                border: `1px solid ${COLORS.border}`,
                backgroundColor: 'white',
                color: COLORS.slate,
                fontSize: '14px',
                cursor: processing ? 'not-allowed' : 'pointer',
                fontWeight: '500'
              }}
            >
              Go Back
            </button>

            {/* Trust Badges */}
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              gap: '24px',
              marginTop: '28px',
              paddingTop: '24px',
              borderTop: `1px solid ${COLORS.border}`
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: COLORS.slate }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0110 0v4"/>
                </svg>
                <span style={{ fontSize: '12px', fontWeight: '500' }}>Secure Payment</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: COLORS.slate }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
                <span style={{ fontSize: '12px', fontWeight: '500' }}>Data Protected</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: COLORS.slate }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
                  <line x1="1" y1="10" x2="23" y2="10"/>
                </svg>
                <span style={{ fontSize: '12px', fontWeight: '500' }}>Stripe</span>
              </div>
            </div>

            <Disclaimer />
          </div>
        )}

        {/* Stage: Preparing */}
        {stage === 'preparing' && (
          <div className="animate-scale-in" style={{
            backgroundColor: 'white',
            borderRadius: '24px',
            padding: '60px 40px',
            border: `1px solid ${COLORS.border}`,
            boxShadow: '0 8px 30px -4px rgba(0, 0, 0, 0.1)',
            textAlign: 'center'
          }}>
            <div style={{
              width: '100px',
              height: '100px',
              borderRadius: '50%',
              background: `linear-gradient(135deg, ${COLORS.regulatory}20 0%, ${COLORS.regulatoryLight}10 100%)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 32px auto',
              position: 'relative'
            }}>
              <div style={{
                width: '50px',
                height: '50px',
                border: `4px solid ${COLORS.border}`,
                borderTopColor: COLORS.regulatory,
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }} />
              <div style={{
                position: 'absolute',
                width: '120px',
                height: '120px',
                borderRadius: '50%',
                border: `2px dashed ${COLORS.border}`,
                animation: 'spin 8s linear infinite reverse'
              }} />
            </div>

            <h2 style={{
              fontSize: '28px',
              fontWeight: '800',
              color: COLORS.graphite,
              margin: '0 0 12px 0',
              fontFamily: '"Space Grotesk", sans-serif'
            }}>
              Preparing Your Appeal Package
            </h2>

            <p style={{ fontSize: '16px', color: COLORS.slate, margin: '0 0 40px 0', maxWidth: '400px', marginLeft: 'auto', marginRight: 'auto' }}>
              We're generating your customized appeal letter and compiling your evidence...
            </p>

            {/* Progress Bar */}
            <div style={{
              width: '100%',
              maxWidth: '400px',
              height: '10px',
              backgroundColor: COLORS.border,
              borderRadius: '5px',
              margin: '0 auto',
              overflow: 'hidden'
            }}>
              <div style={{
                width: `${preparingProgress}%`,
                height: '100%',
                background: `linear-gradient(90deg, ${COLORS.regulatory} 0%, ${COLORS.regulatoryLight} 100%)`,
                borderRadius: '5px',
                transition: 'width 0.5s ease',
                backgroundSize: '200% 100%',
                animation: 'shimmer 2s ease-in-out infinite'
              }} />
            </div>
            <p style={{ fontSize: '15px', color: COLORS.slate, margin: '16px 0 0 0', fontWeight: '500' }}>
              <span style={{ color: COLORS.regulatory, fontWeight: '700' }}>{preparingProgress}%</span> complete
            </p>

            {/* Status messages based on progress */}
            <p style={{ fontSize: '13px', color: COLORS.slate, margin: '24px 0 0 0', opacity: 0.8 }}>
              {preparingProgress < 30 && 'Retrieving your property data...'}
              {preparingProgress >= 30 && preparingProgress < 60 && 'Analyzing comparable properties...'}
              {preparingProgress >= 60 && preparingProgress < 90 && 'Generating appeal letter...'}
              {preparingProgress >= 90 && 'Finalizing your package...'}
            </p>
          </div>
        )}

        {/* Stage: Complete */}
        {stage === 'complete' && appealData && (
          <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* Payment Success Banner */}
            <div style={{
              background: 'linear-gradient(135deg, #F0FDF4 0%, #DCFCE7 100%)',
              borderRadius: '16px',
              padding: '20px 24px',
              border: '1px solid #86EFAC',
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              boxShadow: '0 4px 12px rgba(16, 185, 129, 0.1)'
            }}>
              <div style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #10B981 0%, #059669 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5">
                  <polyline points="20,6 9,17 4,12"/>
                </svg>
              </div>
              <div>
                <p style={{ fontSize: '18px', fontWeight: '700', color: '#166534', margin: '0 0 4px 0' }}>
                  Payment Successful!
                </p>
                <p style={{ fontSize: '15px', color: '#166534', margin: 0 }}>
                  Your $179 property tax appeal package is ready to download.
                </p>
              </div>
            </div>

            {/* Success Header */}
            <div style={{
              backgroundColor: 'white',
              borderRadius: '16px',
              padding: '32px',
              border: `1px solid ${COLORS.border}`,
              textAlign: 'center'
            }}>
              <div style={{
                width: '80px',
                height: '80px',
                borderRadius: '50%',
                backgroundColor: '#F0FDF4',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 24px auto'
              }}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={COLORS.signal} strokeWidth="2.5">
                  <path d="M9 12l2 2 4-4"/>
                  <rect x="3" y="5" width="18" height="14" rx="2"/>
                </svg>
              </div>

              <h2 style={{
                fontSize: '28px',
                fontWeight: '700',
                color: COLORS.graphite,
                margin: '0 0 12px 0',
                fontFamily: '"Space Grotesk", sans-serif'
              }}>
                Your Appeal Package is Ready
              </h2>

              <p style={{ fontSize: '16px', color: COLORS.slate, margin: '0 0 16px 0' }}>
                You now have access to your complete appeal letter and filing instructions.
              </p>

              {/* What you have access to */}
              <div style={{
                display: 'inline-flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: '8px',
                padding: '16px 24px',
                backgroundColor: '#F8FAFC',
                borderRadius: '10px',
                textAlign: 'left',
                marginBottom: '24px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.signal} strokeWidth="2.5">
                    <polyline points="20,6 9,17 4,12"/>
                  </svg>
                  <span style={{ fontSize: '14px', color: COLORS.graphite }}>Professional appeal letter</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.signal} strokeWidth="2.5">
                    <polyline points="20,6 9,17 4,12"/>
                  </svg>
                  <span style={{ fontSize: '14px', color: COLORS.graphite }}>Comparable property evidence</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.signal} strokeWidth="2.5">
                    <polyline points="20,6 9,17 4,12"/>
                  </svg>
                  <span style={{ fontSize: '14px', color: COLORS.graphite }}>Step-by-step filing instructions</span>
                </div>
              </div>

              {/* Next Steps */}
              <div style={{
                backgroundColor: `${COLORS.regulatory}10`,
                borderRadius: '10px',
                padding: '16px',
                textAlign: 'left'
              }}>
                <p style={{ fontSize: '14px', fontWeight: '600', color: COLORS.regulatory, margin: '0 0 8px 0' }}>
                  Next Steps:
                </p>
                <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '14px', color: COLORS.graphite, lineHeight: '1.8' }}>
                  <li>Review your appeal letter below</li>
                  <li>Copy or print the letter</li>
                  <li>Mail to the Board of Review before your deadline</li>
                </ol>
              </div>
            </div>

            {/* Appeal Letter Preview */}
            {appealData.appealLetter && (
              <div style={{
                backgroundColor: 'white',
                borderRadius: '16px',
                padding: '24px',
                border: `1px solid ${COLORS.border}`
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: '16px'
                }}>
                  <h3 style={{ fontSize: '18px', fontWeight: '600', color: COLORS.graphite, margin: 0 }}>
                    Your Appeal Letter
                  </h3>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(appealData.appealLetter || '');
                      trackPropertyTaxLetterCopied();
                      alert('Letter copied to clipboard!');
                    }}
                    style={{
                      padding: '8px 16px',
                      borderRadius: '6px',
                      border: `1px solid ${COLORS.border}`,
                      backgroundColor: 'white',
                      color: COLORS.graphite,
                      fontSize: '13px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
                    </svg>
                    Copy
                  </button>
                </div>
                <div style={{
                  padding: '20px',
                  backgroundColor: '#FAFAFA',
                  borderRadius: '10px',
                  border: `1px solid ${COLORS.border}`,
                  fontFamily: 'Georgia, serif',
                  fontSize: '14px',
                  lineHeight: '1.8',
                  color: COLORS.graphite,
                  whiteSpace: 'pre-wrap',
                  maxHeight: '400px',
                  overflowY: 'auto'
                }}>
                  {appealData.appealLetter}
                </div>
              </div>
            )}

            {/* Filing Instructions */}
            <div style={{
              backgroundColor: 'white',
              borderRadius: '16px',
              padding: '24px',
              border: `1px solid ${COLORS.border}`
            }}>
              <h3 style={{ fontSize: '18px', fontWeight: '600', color: COLORS.graphite, margin: '0 0 16px 0' }}>
                Next Steps: How to File
              </h3>
              <ol style={{ margin: 0, paddingLeft: '20px', color: COLORS.graphite, lineHeight: '2.2' }}>
                <li>
                  <strong>Download your appeal packet</strong> (click the button above)
                </li>
                <li>
                  <strong>Print and sign</strong> the appeal letter where indicated
                </li>
                <li>
                  <strong>File online</strong> at{' '}
                  <a href="https://www.cookcountyboardofreview.com" target="_blank" rel="noopener noreferrer" style={{ color: COLORS.regulatory }}>
                    cookcountyboardofreview.com
                  </a>
                  {' '}or mail to:
                  <div style={{ marginLeft: '20px', marginTop: '8px', fontSize: '14px', color: COLORS.slate }}>
                    Cook County Board of Review<br />
                    118 N. Clark Street, Room 601<br />
                    Chicago, IL 60602
                  </div>
                </li>
                <li>
                  <strong>Keep a copy</strong> for your records
                </li>
              </ol>
            </div>

            {/* Deadline Warning */}
            <div style={{
              padding: '16px 20px',
              backgroundColor: '#FEF3C7',
              border: '1px solid #FDE68A',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px'
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#92400E" strokeWidth="2" style={{ flexShrink: 0, marginTop: '2px' }}>
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <div>
                <p style={{ fontSize: '14px', fontWeight: '600', color: '#92400E', margin: '0 0 4px 0' }}>
                  Check Your Township Deadline
                </p>
                <p style={{ fontSize: '14px', color: '#92400E', margin: 0, lineHeight: '1.5' }}>
                  Filing deadlines vary by township. Visit the Board of Review website to confirm your deadline
                  for {appealData.property.township} Township before submitting.
                </p>
              </div>
            </div>

            {/* Done Button */}
            <button
              onClick={() => router.push('/settings')}
              style={{
                width: '100%',
                padding: '16px',
                borderRadius: '10px',
                border: 'none',
                backgroundColor: COLORS.graphite,
                color: 'white',
                fontSize: '16px',
                fontWeight: '600',
                cursor: 'pointer'
              }}
            >
              Done
            </button>

            <Disclaimer />
          </div>
        )}

        {/* FAQ Section - always visible */}
        <div style={{
          marginTop: '48px',
          backgroundColor: 'white',
          borderRadius: '16px',
          padding: '32px',
          border: `1px solid ${COLORS.border}`
        }}>
          <h2 style={{
            fontSize: '24px',
            fontWeight: '700',
            color: COLORS.graphite,
            margin: '0 0 24px 0',
            fontFamily: '"Space Grotesk", sans-serif'
          }}>
            Frequently Asked Questions
          </h2>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: '600', color: COLORS.graphite, margin: '0 0 8px 0' }}>
                What do I get for $179?
              </h3>
              <p style={{ fontSize: '14px', color: COLORS.slate, margin: 0, lineHeight: '1.6' }}>
                You get a complete appeal package including a professionally written appeal letter using your property data
                and comparable properties, plus step-by-step filing instructions. We handle the research and writing;
                you handle the mailing.
              </p>
            </div>

            <div>
              <h3 style={{ fontSize: '16px', fontWeight: '600', color: COLORS.graphite, margin: '0 0 8px 0' }}>
                Is this legal advice?
              </h3>
              <p style={{ fontSize: '14px', color: COLORS.slate, margin: 0, lineHeight: '1.6' }}>
                No. We provide document preparation services only. We are not attorneys and do not provide legal advice.
                The appeal letter uses public data to present your case, but you are responsible for reviewing and filing it yourself.
              </p>
            </div>

            <div>
              <h3 style={{ fontSize: '16px', fontWeight: '600', color: COLORS.graphite, margin: '0 0 8px 0' }}>
                What are my chances of success?
              </h3>
              <p style={{ fontSize: '14px', color: COLORS.slate, margin: 0, lineHeight: '1.6' }}>
                Success rates vary. Our analysis shows your "opportunity score" based on how your assessment compares
                to similar properties. Properties with higher scores tend to have better outcomes, but we cannot guarantee results.
                The Cook County Board of Review makes all final decisions.
              </p>
            </div>

            <div>
              <h3 style={{ fontSize: '16px', fontWeight: '600', color: COLORS.graphite, margin: '0 0 8px 0' }}>
                When is my filing deadline?
              </h3>
              <p style={{ fontSize: '14px', color: COLORS.slate, margin: 0, lineHeight: '1.6' }}>
                Filing deadlines vary by township and are set by Cook County. Check{' '}
                <a href="https://www.cookcountyboardofreview.com" target="_blank" rel="noopener noreferrer" style={{ color: COLORS.regulatory }}>
                  cookcountyboardofreview.com
                </a>{' '}
                for current deadlines. We recommend filing at least a week before the deadline.
              </p>
            </div>

            <div>
              <h3 style={{ fontSize: '16px', fontWeight: '600', color: COLORS.graphite, margin: '0 0 8px 0' }}>
                Can I get a refund?
              </h3>
              <p style={{ fontSize: '14px', color: COLORS.slate, margin: 0, lineHeight: '1.6' }}>
                Because we generate your appeal letter immediately upon payment, we cannot offer refunds once your
                package is created. You can review your free analysis before purchasing to make an informed decision.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
