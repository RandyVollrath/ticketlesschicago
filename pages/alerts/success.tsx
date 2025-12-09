import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Script from 'next/script';
import { useRouter } from 'next/router';
import { supabase } from '../../lib/supabase';
import { posthog } from '../../lib/posthog';

// Brand Colors - Municipal Fintech
const COLORS = {
  deepHarbor: '#0F172A',
  regulatory: '#2563EB',
  regulatoryDark: '#1d4ed8',
  concrete: '#F8FAFC',
  signal: '#10B981',
  graphite: '#1E293B',
  slate: '#64748B',
  border: '#E2E8F0',
};

export default function AlertsSuccess() {
  const router = useRouter();
  const isProtection = router.query.protection === 'true';
  const isExistingUser = router.query.existing === 'true';
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [magicLinkError, setMagicLinkError] = useState('');

  // License upload for permit zone users
  const [needsLicenseUpload, setNeedsLicenseUpload] = useState(false);
  const [user, setUser] = useState<any>(null);

  // Front of license
  const [licenseFrontFile, setLicenseFrontFile] = useState<File | null>(null);
  const [licenseFrontUploading, setLicenseFrontUploading] = useState(false);
  const [licenseFrontError, setLicenseFrontError] = useState('');
  const [licenseFrontSuccess, setLicenseFrontSuccess] = useState(false);

  // Back of license
  const [licenseBackFile, setLicenseBackFile] = useState<File | null>(null);
  const [licenseBackUploading, setLicenseBackUploading] = useState(false);
  const [licenseBackError, setLicenseBackError] = useState('');
  const [licenseBackSuccess, setLicenseBackSuccess] = useState(false);

  // License consent
  const [thirdPartyConsent, setThirdPartyConsent] = useState(false);
  const [reuseConsent, setReuseConsent] = useState(false);
  const [licenseExpiryDate, setLicenseExpiryDate] = useState('');

  // Combined success state
  const licenseUploadComplete = licenseFrontSuccess && licenseBackSuccess;

  // Permit zone for proof of residency
  const [hasPermitZone, setHasPermitZone] = useState(false);

  // Track activation_complete event and capture UTM parameters
  useEffect(() => {
    const trackActivation = () => {
      if (typeof window !== 'undefined' && posthog) {
        // Extract UTM parameters from URL
        const utmParams: Record<string, string> = {};
        const searchParams = new URLSearchParams(window.location.search);

        ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref'].forEach(param => {
          const value = searchParams.get(param);
          if (value) {
            utmParams[param] = value;
          }
        });

        // Track activation complete with UTM data
        posthog.capture('activation_complete', {
          is_protection: isProtection,
          is_existing_user: isExistingUser,
          ...utmParams
        });
      }
    };

    // Wait a bit for PostHog to initialize
    const timer = setTimeout(trackActivation, 500);
    return () => clearTimeout(timer);
  }, [isProtection, isExistingUser]);

  // Check if user needs license upload (Protection + City Sticker + Permit Zone)
  useEffect(() => {
    const checkLicenseUploadNeed = async () => {
      if (!isProtection) return; // Only for Protection users

      try {
        // Get current user
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (!authUser) return;

        setUser(authUser);

        // Fetch user profile to check if they have city sticker AND permit zone
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('city_sticker_expiry, has_permit_zone, license_image_path')
          .eq('user_id', authUser.id)
          .single();

        // Need license if: has city sticker renewal + has permit zone + no license uploaded yet
        const hasCitySticker = !!profile?.city_sticker_expiry;
        const hasPermitZone = profile?.has_permit_zone === true;
        const hasLicense = !!profile?.license_image_path;

        setNeedsLicenseUpload(hasCitySticker && hasPermitZone && !hasLicense);
        setHasPermitZone(hasPermitZone);
      } catch (error) {
        console.error('Error checking license upload need:', error);
      }
    };

    checkLicenseUploadNeed();
  }, [isProtection]);

  const sendMagicLink = async (email: string) => {
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email,
        options: {
          emailRedirectTo: `${window.location.origin}/settings`
        }
      });

      if (error) throw error;
      setMagicLinkSent(true);
    } catch (error: any) {
      console.error('Error sending magic link:', error);
      setMagicLinkError('Unable to send login link automatically');
    }
  };

  const handleLicenseUpload = async (file: File, side: 'front' | 'back') => {
    const setFile = side === 'front' ? setLicenseFrontFile : setLicenseBackFile;
    const setUploading = side === 'front' ? setLicenseFrontUploading : setLicenseBackUploading;
    const setError = side === 'front' ? setLicenseFrontError : setLicenseBackError;
    const setSuccess = side === 'front' ? setLicenseFrontSuccess : setLicenseBackSuccess;

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      setError('Please upload a JPEG, PNG, or WebP image');
      return;
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      setError('File size must be less than 5MB');
      return;
    }

    // Validate consent
    if (!thirdPartyConsent) {
      setError('Please consent to Google Cloud Vision processing first');
      return;
    }

    // Clear previous errors and set file
    setError('');
    setFile(file);

    // Upload to server
    if (user?.id) {
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append('license', file);
        formData.append('userId', user.id);
        formData.append('side', side);

        const response = await fetch('/api/protection/upload-license', {
          method: 'POST',
          body: formData,
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || 'Upload failed');
        }

        setSuccess(true);
        console.log(`License ${side} uploaded successfully:`, result);

        // Save consents to database after both uploads complete
        if (side === 'back' && licenseFrontSuccess) {
          if (reuseConsent || licenseExpiryDate) {
            await supabase
              .from('user_profiles')
              .update({
                third_party_processing_consent: true,
                third_party_processing_consent_at: new Date().toISOString(),
                license_reuse_consent_given: reuseConsent,
                license_reuse_consent_given_at: reuseConsent ? new Date().toISOString() : null,
                license_valid_until: licenseExpiryDate || null,
              })
              .eq('user_id', user.id);
          }
        }

      } catch (error: any) {
        console.error(`License ${side} upload error:`, error);
        setError(error.message || 'Failed to upload');
        setFile(null);
      } finally {
        setUploading(false);
      }
    }
  };

  const handleFrontChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleLicenseUpload(file, 'front');
  };

  const handleBackChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleLicenseUpload(file, 'back');
  };

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: COLORS.concrete,
      fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px'
    }}>
      <Head>
        <title>You're All Set! - Autopilot America</title>
        <meta name="description" content="Your alerts are now active" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;600;700&display=swap" rel="stylesheet" />
        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
          ::selection { background: #10B981; color: white; }
        `}</style>
      </Head>
      <Script src="https://js.stripe.com/v3/buy-button.js" strategy="lazyOnload" />

      <div style={{
        maxWidth: '600px',
        width: '100%',
        backgroundColor: 'white',
        borderRadius: '16px',
        padding: '48px',
        textAlign: 'center',
        border: `1px solid ${COLORS.border}`,
        boxShadow: '0 4px 20px rgba(0,0,0,0.04)'
      }}>
        {/* Success Icon */}
        <div style={{
          width: '72px',
          height: '72px',
          backgroundColor: `${COLORS.signal}15`,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 24px auto'
        }}>
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={COLORS.signal} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>

        <h1 style={{
          fontSize: '32px',
          fontWeight: '700',
          color: COLORS.graphite,
          marginBottom: '16px',
          margin: '0 0 16px 0',
          fontFamily: '"Space Grotesk", sans-serif',
          letterSpacing: '-1px'
        }}>
          You're All Set!
        </h1>

        <p style={{
          fontSize: '17px',
          color: COLORS.slate,
          marginBottom: '32px',
          lineHeight: '1.6',
          margin: '0 0 32px 0'
        }}>
          {isProtection
            ? "Your Autopilot Protection is now active. We'll handle your renewals and you're covered up to $200/year in tickets."
            : "We'll text, email, and call you before tickets happen. Your alerts are now active for street cleaning, snow removal, city stickers, and license plates."
          }
        </p>

        {/* Profile Completion Warning for Protection */}
        {isProtection && (
          <div style={{
            backgroundColor: '#fffbeb',
            border: `1px solid #fbbf24`,
            borderRadius: '12px',
            padding: '24px',
            marginBottom: '24px',
            textAlign: 'left'
          }}>
            <h3 style={{
              fontSize: '15px',
              fontWeight: '600',
              color: '#92400e',
              marginBottom: '12px',
              margin: '0 0 12px 0',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#92400e" strokeWidth="2">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              Important: Complete Your Profile
            </h3>
            <p style={{
              fontSize: '14px',
              color: '#78350f',
              lineHeight: '1.6',
              margin: '0 0 12px 0'
            }}>
              <strong>Your $200/year ticket guarantee requires a complete and accurate profile.</strong> Please verify:
            </p>
            <ul style={{
              margin: '0 0 12px 0',
              paddingLeft: '20px',
              fontSize: '13px',
              color: '#78350f',
              lineHeight: '1.7'
            }}>
              <li>Vehicle information (license plate, make, model)</li>
              <li>Renewal dates (city sticker, license plate)</li>
              <li>Contact info and street cleaning address</li>
            </ul>
            <p style={{
              fontSize: '12px',
              color: '#92400e',
              margin: 0,
              fontStyle: 'italic'
            }}>
              The guarantee is void if your profile is incomplete or inaccurate.
            </p>
          </div>
        )}

        {/* License Upload for Permit Zone Users */}
        {needsLicenseUpload && !licenseUploadComplete && (
          <div style={{
            backgroundColor: '#fffbeb',
            border: `2px solid #f59e0b`,
            borderRadius: '12px',
            padding: '24px',
            marginBottom: '24px',
            textAlign: 'left'
          }}>
            <h3 style={{
              fontSize: '16px',
              fontWeight: '600',
              color: '#92400e',
              marginBottom: '12px',
              margin: '0 0 12px 0',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#92400e" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
              Upload Driver's License (Front & Back)
            </h3>
            <p style={{
              fontSize: '14px',
              color: '#78350f',
              lineHeight: '1.6',
              margin: '0 0 16px 0'
            }}>
              Because your address is in a <strong>residential permit zone</strong>, we need photos of both sides of your driver's license to process your city sticker renewal.
            </p>

            <div style={{
              backgroundColor: 'white',
              border: `1px solid ${COLORS.border}`,
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '16px'
            }}>
              <p style={{
                fontSize: '12px',
                color: COLORS.slate,
                margin: 0,
                lineHeight: '1.5'
              }}>
                <strong>Photo requirements:</strong> Clear, well-lit images showing all text. Avoid glare, shadows, or blur.
              </p>
            </div>

            <div style={{
              backgroundColor: `${COLORS.regulatory}08`,
              border: `1px solid ${COLORS.regulatory}30`,
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '16px'
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={COLORS.regulatory} strokeWidth="2" style={{ flexShrink: 0, marginTop: '2px' }}>
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
                <div>
                  <p style={{
                    fontSize: '12px',
                    fontWeight: '600',
                    color: COLORS.regulatory,
                    margin: '0 0 4px 0'
                  }}>
                    Privacy & Security
                  </p>
                  <p style={{
                    fontSize: '11px',
                    color: COLORS.slate,
                    margin: 0,
                    lineHeight: '1.5'
                  }}>
                    Your license is encrypted with bank-level security. We access it <strong>only once per year</strong>, 30 days before your city sticker renewal.
                  </p>
                </div>
              </div>
            </div>

            {/* Required Consent */}
            <div style={{
              backgroundColor: '#fef3c7',
              border: '1px solid #fde047',
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '12px'
            }}>
              <label style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                cursor: 'pointer'
              }}>
                <input
                  type="checkbox"
                  checked={thirdPartyConsent}
                  onChange={(e) => setThirdPartyConsent(e.target.checked)}
                  style={{
                    width: '18px',
                    height: '18px',
                    marginTop: '1px',
                    accentColor: '#f59e0b',
                    cursor: 'pointer',
                    flexShrink: 0
                  }}
                />
                <span style={{
                  fontSize: '12px',
                  color: '#92400e',
                  lineHeight: '1.5'
                }}>
                  <strong>Required:</strong> I consent to Google Cloud Vision processing my driver's license images for automated quality verification.
                </span>
              </label>
            </div>

            {/* Optional Multi-Year Consent */}
            <div style={{
              backgroundColor: `${COLORS.signal}08`,
              border: `1px solid ${COLORS.signal}30`,
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '16px'
            }}>
              <label style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                cursor: 'pointer',
                marginBottom: reuseConsent ? '12px' : '0'
              }}>
                <input
                  type="checkbox"
                  checked={reuseConsent}
                  onChange={(e) => setReuseConsent(e.target.checked)}
                  style={{
                    width: '18px',
                    height: '18px',
                    marginTop: '1px',
                    accentColor: COLORS.signal,
                    cursor: 'pointer',
                    flexShrink: 0
                  }}
                />
                <span style={{
                  fontSize: '12px',
                  color: '#166534',
                  lineHeight: '1.5'
                }}>
                  <strong>Optional:</strong> Store my license until it expires for automatic renewals (saves you from uploading every year).
                </span>
              </label>

              {reuseConsent && (
                <div style={{ paddingLeft: '28px' }}>
                  <label style={{
                    display: 'block',
                    fontSize: '12px',
                    fontWeight: '600',
                    color: '#166534',
                    marginBottom: '6px'
                  }}>
                    When does your driver's license expire?
                  </label>
                  <input
                    type="date"
                    value={licenseExpiryDate}
                    onChange={(e) => setLicenseExpiryDate(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      border: `1px solid ${COLORS.signal}50`,
                      borderRadius: '6px',
                      fontSize: '14px',
                      boxSizing: 'border-box'
                    }}
                  />
                </div>
              )}
            </div>

            {/* Front of License Upload */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: '600',
                color: '#374151',
                marginBottom: '8px'
              }}>
                Front of License {licenseFrontSuccess && <span style={{ color: COLORS.signal }}>✓</span>}
              </label>
              {licenseFrontSuccess ? (
                <div style={{
                  backgroundColor: '#f0fdf4',
                  border: '2px solid #86efac',
                  borderRadius: '8px',
                  padding: '12px',
                  fontSize: '13px',
                  color: '#059669',
                  fontWeight: '500'
                }}>
                  ✅ Front uploaded successfully
                </div>
              ) : (
                <>
                  <input
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp"
                    onChange={handleFrontChange}
                    disabled={licenseFrontUploading || !thirdPartyConsent}
                    style={{
                      width: '100%',
                      padding: '12px',
                      border: '2px dashed #d1d5db',
                      borderRadius: '8px',
                      fontSize: '14px',
                      boxSizing: 'border-box',
                      backgroundColor: '#f9fafb',
                      cursor: (licenseFrontUploading || !thirdPartyConsent) ? 'not-allowed' : 'pointer',
                      opacity: !thirdPartyConsent ? 0.5 : 1
                    }}
                  />
                  {licenseFrontUploading && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '13px',
                      color: COLORS.regulatory,
                      marginTop: '8px'
                    }}>
                      <div style={{
                        width: '14px',
                        height: '14px',
                        border: `2px solid ${COLORS.regulatory}`,
                        borderTop: '2px solid transparent',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite'
                      }}></div>
                      <span>Verifying front image...</span>
                    </div>
                  )}
                  {licenseFrontError && (
                    <p style={{ fontSize: '13px', color: '#dc2626', margin: '8px 0 0 0' }}>
                      ❌ {licenseFrontError}
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Back of License Upload */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{
                display: 'block',
                fontSize: '14px',
                fontWeight: '600',
                color: '#374151',
                marginBottom: '8px'
              }}>
                Back of License {licenseBackSuccess && <span style={{ color: COLORS.signal }}>✓</span>}
              </label>
              {licenseBackSuccess ? (
                <div style={{
                  backgroundColor: '#f0fdf4',
                  border: '2px solid #86efac',
                  borderRadius: '8px',
                  padding: '12px',
                  fontSize: '13px',
                  color: '#059669',
                  fontWeight: '500'
                }}>
                  ✅ Back uploaded successfully
                </div>
              ) : (
                <>
                  <input
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp"
                    onChange={handleBackChange}
                    disabled={licenseBackUploading || !thirdPartyConsent}
                    style={{
                      width: '100%',
                      padding: '12px',
                      border: '2px dashed #d1d5db',
                      borderRadius: '8px',
                      fontSize: '14px',
                      boxSizing: 'border-box',
                      backgroundColor: '#f9fafb',
                      cursor: (licenseBackUploading || !thirdPartyConsent) ? 'not-allowed' : 'pointer',
                      opacity: !thirdPartyConsent ? 0.5 : 1
                    }}
                  />
                  {licenseBackUploading && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      fontSize: '13px',
                      color: COLORS.regulatory,
                      marginTop: '8px'
                    }}>
                      <div style={{
                        width: '14px',
                        height: '14px',
                        border: `2px solid ${COLORS.regulatory}`,
                        borderTop: '2px solid transparent',
                        borderRadius: '50%',
                        animation: 'spin 1s linear infinite'
                      }}></div>
                      <span>Verifying back image...</span>
                    </div>
                  )}
                  {licenseBackError && (
                    <p style={{ fontSize: '13px', color: '#dc2626', margin: '8px 0 0 0' }}>
                      ❌ {licenseBackError}
                    </p>
                  )}
                </>
              )}
            </div>

            {/* Skip for now option */}
            <p style={{
              fontSize: '12px',
              color: COLORS.slate,
              margin: '16px 0 0 0',
              textAlign: 'center',
              fontStyle: 'italic'
            }}>
              You can skip this for now and upload later in your <a href="/settings" style={{ color: COLORS.regulatory }}>account settings</a>.
            </p>
          </div>
        )}

        {/* License Upload Success */}
        {licenseUploadComplete && (
          <div style={{
            backgroundColor: `${COLORS.signal}10`,
            border: `2px solid ${COLORS.signal}`,
            borderRadius: '12px',
            padding: '24px',
            marginBottom: '24px',
            textAlign: 'center'
          }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={COLORS.signal} strokeWidth="2" style={{ marginBottom: '12px' }}>
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            <h3 style={{
              fontSize: '16px',
              fontWeight: '600',
              color: '#166534',
              margin: '0 0 8px 0'
            }}>
              License Uploaded Successfully!
            </h3>
            <p style={{
              fontSize: '14px',
              color: '#166534',
              margin: 0,
              lineHeight: '1.5'
            }}>
              Your driver's license has been verified. We'll use this to process your city sticker renewal.
            </p>
          </div>
        )}

        {/* Proof of Residency Upload - For permit zone users */}
        {isProtection && hasPermitZone && (
          <div style={{
            backgroundColor: `${COLORS.regulatory}08`,
            border: `1px solid ${COLORS.regulatory}30`,
            borderRadius: '12px',
            padding: '24px',
            marginBottom: '24px',
            textAlign: 'left'
          }}>
            <h3 style={{
              fontSize: '16px',
              fontWeight: '600',
              color: COLORS.regulatory,
              margin: '0 0 12px 0',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={COLORS.regulatory} strokeWidth="2">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                <polyline points="9 22 9 12 15 12 15 22"/>
              </svg>
              Next Step: Upload Proof of Residency
            </h3>
            <p style={{
              fontSize: '14px',
              color: COLORS.slate,
              lineHeight: '1.6',
              margin: '0 0 16px 0'
            }}>
              Upload a document proving you live at your address for city sticker renewals in permit zones.
            </p>

            <div style={{
              backgroundColor: 'white',
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '16px',
              border: `1px solid ${COLORS.border}`
            }}>
              <p style={{
                fontSize: '12px',
                fontWeight: '600',
                color: COLORS.graphite,
                margin: '0 0 6px 0'
              }}>
                Accepted Documents:
              </p>
              <ul style={{
                margin: 0,
                paddingLeft: '16px',
                fontSize: '13px',
                color: COLORS.slate,
                lineHeight: '1.6'
              }}>
                <li>Utility Bill (ComEd, Peoples Gas) - valid 60 days</li>
                <li>Lease Agreement - valid 12 months</li>
                <li>Mortgage Statement - valid 12 months</li>
              </ul>
            </div>

            <a
              href="/settings#proof-of-residency"
              style={{
                display: 'inline-block',
                backgroundColor: COLORS.regulatory,
                color: 'white',
                padding: '10px 20px',
                borderRadius: '8px',
                textDecoration: 'none',
                fontWeight: '600',
                fontSize: '14px'
              }}
            >
              Go to Settings to Upload
            </a>

            <p style={{
              fontSize: '12px',
              color: COLORS.slate,
              marginTop: '12px',
              margin: '12px 0 0 0',
              fontStyle: 'italic'
            }}>
              You can skip this for now and upload later
            </p>
          </div>
        )}

        {/* What's Next Section - only show for users not logged in */}
        {!isExistingUser && !user && (
          <div style={{
            backgroundColor: COLORS.concrete,
            borderRadius: '12px',
            padding: '20px',
            marginBottom: '24px',
            textAlign: 'center'
          }}>
            <p style={{
              fontSize: '14px',
              color: COLORS.slate,
              lineHeight: '1.6',
              margin: 0
            }}>
              {isProtection
                ? "Check your email for a login link, then complete your profile to activate your guarantee."
                : "Check your email for a login link. You'll receive alerts via email, SMS, and phone before all deadlines."
              }
            </p>
          </div>
        )}

        {/* Action Buttons */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          {/* For new Protection users who are NOT logged in, show email check reminder */}
          {isProtection && !isExistingUser && !user ? (
            <div style={{
              backgroundColor: `${COLORS.regulatory}08`,
              border: `1px solid ${COLORS.regulatory}30`,
              borderRadius: '12px',
              padding: '24px',
              textAlign: 'center'
            }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={COLORS.regulatory} strokeWidth="1.5" style={{ marginBottom: '12px' }}>
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                <polyline points="22,6 12,13 2,6"/>
              </svg>
              <h3 style={{
                fontSize: '16px',
                fontWeight: '600',
                color: COLORS.regulatory,
                margin: '0 0 8px 0',
                fontFamily: '"Space Grotesk", sans-serif'
              }}>
                Check Your Email to Login
              </h3>
              <p style={{
                fontSize: '14px',
                color: COLORS.slate,
                lineHeight: '1.6',
                margin: 0
              }}>
                We've sent a secure login link to <strong style={{ color: COLORS.graphite }}>{router.query.email}</strong>.
                Click the link to access your account and verify your information.
              </p>
              <p style={{
                fontSize: '12px',
                color: COLORS.slate,
                marginTop: '12px',
                margin: '12px 0 0 0',
                fontStyle: 'italic'
              }}>
                Check your spam folder if you don't see it within 2 minutes
              </p>
            </div>
          ) : (
            <>
              {/* Check email reminder for free alerts users */}
              {!isProtection && !isExistingUser && (
                <div style={{
                  backgroundColor: `${COLORS.regulatory}08`,
                  border: `1px solid ${COLORS.regulatory}30`,
                  borderRadius: '12px',
                  padding: '24px',
                  textAlign: 'center',
                  marginBottom: '8px'
                }}>
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={COLORS.regulatory} strokeWidth="1.5" style={{ marginBottom: '12px' }}>
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                    <polyline points="22,6 12,13 2,6"/>
                  </svg>
                  <h3 style={{
                    fontSize: '16px',
                    fontWeight: '600',
                    color: COLORS.regulatory,
                    margin: '0 0 8px 0',
                    fontFamily: '"Space Grotesk", sans-serif'
                  }}>
                    Check Your Email to Login
                  </h3>
                  <p style={{
                    fontSize: '14px',
                    color: COLORS.slate,
                    lineHeight: '1.6',
                    margin: 0
                  }}>
                    We've sent a secure login link to your email. Click the link to access your account settings.
                  </p>
                  <p style={{
                    fontSize: '12px',
                    color: COLORS.slate,
                    marginTop: '12px',
                    margin: '12px 0 0 0',
                    fontStyle: 'italic'
                  }}>
                    Check your spam folder if you don't see it within 2 minutes
                  </p>
                </div>
              )}

              {/* For existing users OR logged-in users (Google OAuth), show account button */}
              {(isExistingUser || user) && (
                <button
                  onClick={() => router.push(isProtection ? '/settings?protection=true' : '/settings')}
                  style={{
                    backgroundColor: COLORS.regulatory,
                    color: 'white',
                    border: 'none',
                    borderRadius: '10px',
                    padding: '14px',
                    fontSize: '15px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.backgroundColor = COLORS.regulatoryDark;
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.backgroundColor = COLORS.regulatory;
                  }}
                >
                  Go to My Account
                </button>
              )}

              {!isProtection && (
                <button
                  onClick={() => router.push('/protection')}
                  style={{
                    backgroundColor: 'transparent',
                    color: COLORS.regulatory,
                    border: `2px solid ${COLORS.regulatory}`,
                    borderRadius: '10px',
                    padding: '12px',
                    fontSize: '15px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.backgroundColor = `${COLORS.regulatory}08`;
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  Learn About Autopilot Protection
                </button>
              )}
            </>
          )}

          <button
            onClick={() => router.push('/')}
            style={{
              backgroundColor: 'transparent',
              color: COLORS.slate,
              border: 'none',
              padding: '12px',
              fontSize: '14px',
              cursor: 'pointer'
            }}
          >
            Back to Home
          </button>
        </div>

        {/* Support */}
        <p style={{
          fontSize: '13px',
          color: COLORS.slate,
          marginTop: '24px',
          margin: '24px 0 0 0'
        }}>
          Questions? Email us at <a href="mailto:support@autopilotamerica.com" style={{ color: COLORS.regulatory, textDecoration: 'none', fontWeight: '500' }}>support@autopilotamerica.com</a>
        </p>
      </div>
    </div>
  );
}
