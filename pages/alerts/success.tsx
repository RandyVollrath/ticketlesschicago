import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import Script from 'next/script';
import { useRouter } from 'next/router';
import { supabase } from '../../lib/supabase';
import { posthog } from '../../lib/posthog';

export default function AlertsSuccess() {
  const router = useRouter();
  const isProtection = router.query.protection === 'true';
  const isExistingUser = router.query.existing === 'true';
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [magicLinkError, setMagicLinkError] = useState('');

  // License upload for permit zone users
  const [needsLicenseUpload, setNeedsLicenseUpload] = useState(false);
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [licensePreview, setLicensePreview] = useState<string | null>(null);
  const [licenseUploading, setLicenseUploading] = useState(false);
  const [licenseUploadError, setLicenseUploadError] = useState('');
  const [licenseUploadSuccess, setLicenseUploadSuccess] = useState(false);
  const [user, setUser] = useState<any>(null);

  // License consent
  const [thirdPartyConsent, setThirdPartyConsent] = useState(false);
  const [reuseConsent, setReuseConsent] = useState(false);
  const [licenseExpiryDate, setLicenseExpiryDate] = useState('');

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
      } catch (error) {
        console.error('Error checking license upload need:', error);
      }
    };

    checkLicenseUploadNeed();
  }, [isProtection]);

  // Magic link is now sent from webhook - this effect is no longer needed
  // useEffect(() => {
  //   if (isProtection && !isExistingUser && router.query.email) {
  //     sendMagicLink(router.query.email as string);
  //   }
  // }, [isProtection, isExistingUser, router.query.email]);

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

  const handleLicenseFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      setLicenseUploadError('Please upload a JPEG, PNG, or WebP image');
      return;
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      setLicenseUploadError('File size must be less than 5MB');
      return;
    }

    // Validate consent
    if (!thirdPartyConsent) {
      setLicenseUploadError('Please consent to Google Cloud Vision processing your license image');
      return;
    }

    // Clear previous errors
    setLicenseUploadError('');
    setLicenseFile(file);

    // Create image preview
    const reader = new FileReader();
    reader.onloadend = () => {
      setLicensePreview(reader.result as string);
    };
    reader.readAsDataURL(file);

    // Upload to server immediately with quality verification
    if (user?.id) {
      setLicenseUploading(true);
      try {
        const formData = new FormData();
        formData.append('license', file);
        formData.append('userId', user.id);

        const response = await fetch('/api/protection/upload-license', {
          method: 'POST',
          body: formData,
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || 'Upload failed');
        }

        setLicenseUploadSuccess(true);

        // Save consents to database
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

        console.log('License uploaded successfully:', result);

      } catch (error: any) {
        console.error('License upload error:', error);
        setLicenseUploadError(error.message || 'Failed to upload license image');
        setLicenseFile(null);
        setLicensePreview(null);
      } finally {
        setLicenseUploading(false);
      }
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f9fafb',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px'
    }}>
      <Head>
        <title>You're All Set! - Autopilot America</title>
        <meta name="description" content="Your free alerts are now active" />
      </Head>
      <Script src="https://js.stripe.com/v3/buy-button.js" strategy="lazyOnload" />

      <div style={{
        maxWidth: '600px',
        width: '100%',
        backgroundColor: 'white',
        borderRadius: '16px',
        padding: '48px',
        textAlign: 'center',
        boxShadow: '0 4px 20px rgba(0,0,0,0.08)'
      }}>
        {/* Success Icon */}
        <div style={{
          width: '80px',
          height: '80px',
          backgroundColor: '#dcfce7',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 24px auto',
          fontSize: '40px'
        }}>
          ✓
        </div>

        <h1 style={{
          fontSize: '36px',
          fontWeight: 'bold',
          color: '#1a1a1a',
          marginBottom: '16px',
          margin: '0 0 16px 0'
        }}>
          You're All Set!
        </h1>

        <p style={{
          fontSize: '18px',
          color: '#374151',
          marginBottom: '32px',
          lineHeight: '1.6',
          margin: '0 0 32px 0'
        }}>
          {isProtection
            ? "Your Ticket Protection is now active! We'll handle your renewals and you're covered up to $200/year in tickets."
            : "We'll text, email, and call you before tickets happen. Your alerts are now active for street cleaning, snow removal, city stickers, and license plates."
          }
        </p>

        {/* Profile Completion Warning for Protection */}
        {isProtection && (
          <div style={{
            backgroundColor: '#fff7ed',
            border: '2px solid #fb923c',
            borderRadius: '12px',
            padding: '24px',
            marginBottom: '32px',
            textAlign: 'left'
          }}>
            <h3 style={{
              fontSize: '16px',
              fontWeight: 'bold',
              color: '#9a3412',
              marginBottom: '12px',
              margin: '0 0 12px 0',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              ⚠️ Important: Complete Your Profile
            </h3>
            <p style={{
              fontSize: '15px',
              color: '#7c2d12',
              lineHeight: '1.6',
              margin: '0 0 16px 0'
            }}>
              <strong>Your $200/year ticket guarantee requires a complete and accurate profile.</strong> Please ensure all information in your account settings is correct:
            </p>
            <ul style={{
              margin: '0 0 16px 0',
              paddingLeft: '24px',
              fontSize: '14px',
              color: '#7c2d12',
              lineHeight: '1.6'
            }}>
              <li>Vehicle information (license plate, VIN, make, model)</li>
              <li>Renewal dates (city sticker, license plate, emissions)</li>
              <li>Contact information (phone, email, mailing address)</li>
              <li>Street cleaning address (ward and section)</li>
            </ul>
            <p style={{
              fontSize: '13px',
              color: '#78350f',
              margin: 0,
              fontStyle: 'italic'
            }}>
              The guarantee is void if your profile is incomplete or inaccurate. Take 2 minutes now to verify everything is correct.
            </p>
          </div>
        )}

        {/* License Upload for Permit Zone Users */}
        {needsLicenseUpload && !licenseUploadSuccess && (
          <div style={{
            backgroundColor: '#fef3c7',
            border: '3px solid #f59e0b',
            borderRadius: '12px',
            padding: '24px',
            marginBottom: '32px',
            textAlign: 'left'
          }}>
            <h3 style={{
              fontSize: '18px',
              fontWeight: 'bold',
              color: '#92400e',
              marginBottom: '12px',
              margin: '0 0 12px 0',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              📸 Action Required: Upload Driver's License
            </h3>
            <p style={{
              fontSize: '15px',
              color: '#78350f',
              lineHeight: '1.6',
              margin: '0 0 16px 0'
            }}>
              Because your address is in a <strong>residential permit zone</strong>, we need a photo of your driver's license to process your city sticker renewal with the city clerk.
            </p>
            <div style={{
              backgroundColor: '#fffbeb',
              border: '1px solid #fde047',
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '16px'
            }}>
              <p style={{
                fontSize: '13px',
                color: '#92400e',
                margin: 0,
                lineHeight: '1.5'
              }}>
                <strong>Photo requirements:</strong> Clear, well-lit image showing all text. Avoid glare, shadows, or blur.
              </p>
            </div>

            <div style={{
              backgroundColor: '#f0f9ff',
              border: '1px solid #bae6fd',
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '16px'
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                <span style={{ fontSize: '16px', flexShrink: 0 }}>🔒</span>
                <div>
                  <p style={{
                    fontSize: '13px',
                    fontWeight: '600',
                    color: '#0c4a6e',
                    margin: '0 0 6px 0'
                  }}>
                    Privacy & Security
                  </p>
                  <p style={{
                    fontSize: '12px',
                    color: '#0c4a6e',
                    margin: 0,
                    lineHeight: '1.6'
                  }}>
                    Your license image is stored securely and <strong>temporarily</strong>. We access it ONLY when processing your city sticker renewal (30 days before expiration). The image is <strong>automatically deleted within 48 hours</strong> of verification or processing.
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
                gap: '8px',
                cursor: 'pointer'
              }}>
                <input
                  type="checkbox"
                  checked={thirdPartyConsent}
                  onChange={(e) => setThirdPartyConsent(e.target.checked)}
                  style={{
                    width: '18px',
                    height: '18px',
                    marginTop: '2px',
                    accentColor: '#f59e0b',
                    cursor: 'pointer'
                  }}
                />
                <span style={{
                  fontSize: '12px',
                  color: '#92400e',
                  lineHeight: '1.5'
                }}>
                  <strong>Required:</strong> I consent to Google Cloud Vision processing my driver's license image for automated quality verification (blur detection, text readability). Google's processing is used solely to ensure your image is clear for city clerk processing. <a href="https://cloud.google.com/vision/docs/data-usage" target="_blank" rel="noopener noreferrer" style={{ color: '#0052cc', textDecoration: 'underline' }}>Learn more</a>
                </span>
              </label>
            </div>

            {/* Optional Multi-Year Consent */}
            <div style={{
              backgroundColor: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '16px'
            }}>
              <label style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '8px',
                cursor: 'pointer',
                marginBottom: '12px'
              }}>
                <input
                  type="checkbox"
                  checked={reuseConsent}
                  onChange={(e) => setReuseConsent(e.target.checked)}
                  style={{
                    width: '18px',
                    height: '18px',
                    marginTop: '2px',
                    accentColor: '#10b981',
                    cursor: 'pointer'
                  }}
                />
                <span style={{
                  fontSize: '12px',
                  color: '#166534',
                  lineHeight: '1.5'
                }}>
                  <strong>Optional:</strong> Allow reusing this license image for future city sticker renewals (until license expires). This saves you from uploading every year.
                </span>
              </label>

              {reuseConsent && (
                <div style={{ paddingLeft: '26px' }}>
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
                      border: '1px solid #bbf7d0',
                      borderRadius: '6px',
                      fontSize: '14px',
                      boxSizing: 'border-box'
                    }}
                  />
                  <p style={{
                    fontSize: '11px',
                    color: '#166534',
                    margin: '6px 0 0 0',
                    fontStyle: 'italic'
                  }}>
                    We'll automatically request a new upload ~30 days before this date
                  </p>
                </div>
              )}
            </div>

            <input
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp"
              onChange={handleLicenseFileChange}
              disabled={licenseUploading}
              style={{
                width: '100%',
                padding: '12px',
                border: '2px solid #f59e0b',
                borderRadius: '8px',
                fontSize: '15px',
                boxSizing: 'border-box',
                backgroundColor: 'white',
                cursor: licenseUploading ? 'not-allowed' : 'pointer',
                marginBottom: '12px'
              }}
            />

            {licenseUploading && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                fontSize: '14px',
                color: '#0052cc',
                marginBottom: '12px'
              }}>
                <div style={{
                  width: '16px',
                  height: '16px',
                  border: '2px solid #0052cc',
                  borderTop: '2px solid transparent',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite'
                }}></div>
                <span>Verifying image quality...</span>
              </div>
            )}

            {licenseUploadError && (
              <div style={{
                backgroundColor: '#fee2e2',
                border: '1px solid #fca5a5',
                borderRadius: '8px',
                padding: '12px',
                fontSize: '14px',
                color: '#b91c1c',
                marginBottom: '12px'
              }}>
                <strong>⚠️ Upload failed:</strong> {licenseUploadError}
                <br />
                <span style={{ fontSize: '13px', color: '#991b1b', marginTop: '6px', display: 'block' }}>
                  Please try again with a clearer photo.
                </span>
              </div>
            )}

            {licensePreview && !licenseUploading && !licenseUploadError && (
              <div style={{
                border: '2px solid #16a34a',
                borderRadius: '8px',
                overflow: 'hidden',
                marginTop: '12px'
              }}>
                <img
                  src={licensePreview}
                  alt="License preview"
                  style={{
                    width: '100%',
                    maxHeight: '300px',
                    objectFit: 'contain',
                    display: 'block',
                    backgroundColor: '#f9fafb'
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* License Upload Success */}
        {licenseUploadSuccess && (
          <div style={{
            backgroundColor: '#dcfce7',
            border: '2px solid #16a34a',
            borderRadius: '12px',
            padding: '24px',
            marginBottom: '32px',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>✓</div>
            <h3 style={{
              fontSize: '18px',
              fontWeight: 'bold',
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
              Your driver's license has been verified and uploaded. We'll use this to process your city sticker renewal.
            </p>
          </div>
        )}

        {/* What's Next Section */}
        <div style={{
          backgroundColor: '#f0f8ff',
          borderRadius: '12px',
          padding: '24px',
          marginBottom: '32px',
          textAlign: 'left'
        }}>
          <h3 style={{
            fontSize: '16px',
            fontWeight: 'bold',
            color: '#0052cc',
            marginBottom: '16px',
            margin: '0 0 16px 0'
          }}>
            📋 What happens next:
          </h3>
          <ul style={{
            margin: 0,
            paddingLeft: '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            fontSize: '15px',
            color: '#374151',
            lineHeight: '1.5'
          }}>
            <li>You'll receive alerts via email, SMS, and phone call before any deadlines</li>
            {isProtection && !isExistingUser && (
              <li style={{ backgroundColor: '#dcfce7', padding: '8px', borderRadius: '6px', color: '#166534' }}>
                <strong>✓ Login link sent to your email!</strong> Click the link to access your account and complete your profile.
              </li>
            )}
            {!isProtection && !isExistingUser && (
              <li style={{ backgroundColor: '#dcfce7', padding: '8px', borderRadius: '6px', color: '#166534' }}>
                <strong>✓ Login link sent to your email!</strong> Click the link to access your account settings.
              </li>
            )}
            {isProtection && <li><strong>Verify your profile is 100% complete and accurate</strong> to ensure your guarantee is valid</li>}
            <li>Manage your preferences anytime in your account settings</li>
            {!isProtection && <li>Add more vehicles or upgrade to Ticket Protection whenever you're ready</li>}
          </ul>
        </div>

        {/* Donation Support - Only show for free alerts users */}
        {!isProtection && (
          <div style={{
            backgroundColor: '#f0f4ff',
            borderRadius: '12px',
            padding: '24px',
            marginBottom: '32px',
            textAlign: 'center',
            border: '2px solid #635bff'
          }}>
            <p style={{
              fontSize: '16px',
              color: '#635bff',
              fontWeight: '600',
              marginBottom: '16px',
              margin: '0 0 16px 0',
              lineHeight: '1.5'
            }}>
              💙 Your support helps keep the alerts free for Chicago drivers
            </p>
            <div dangerouslySetInnerHTML={{
              __html: `
                <stripe-buy-button
                  buy-button-id="buy_btn_1SNLupPSdzV8LIExfgCtQqHx"
                  publishable-key="pk_live_51SHvt6PSdzV8LIEx8Zuj7dyiFzP7gqiIomXkOCbpKZ9rgXz49cWRUDRZb4zAvAQdVJXjop1MdtI2DF6ir0pa5ZIN00AKpUqIBH"
                >
                </stripe-buy-button>
              `
            }} />
          </div>
        )}

        {/* Clear Path Relief Program */}
        <div style={{
          backgroundColor: '#fef3c7',
          borderRadius: '12px',
          padding: '20px',
          marginBottom: '32px',
          textAlign: 'left',
          border: '1px solid #fde68a'
        }}>
          <h3 style={{
            fontSize: '16px',
            fontWeight: 'bold',
            color: '#92400e',
            marginBottom: '8px',
            margin: '0 0 8px 0'
          }}>
            Already have ticket debt?
          </h3>
          <p style={{
            fontSize: '14px',
            color: '#78350f',
            lineHeight: '1.5',
            margin: '0 0 12px 0'
          }}>
            Chicago offers the <strong>Clear Path Relief Program</strong>, which can forgive old debt and reduce ticket penalties if you qualify.
          </p>
          <a
            href="https://www.chicago.gov/city/en/sites/clear-path-relief-pilot-program/home.html"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: '#0052cc',
              fontSize: '14px',
              fontWeight: '600',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            Learn more and apply here →
          </a>
        </div>

        {/* Action Buttons */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          {/* For new Protection users, only show email check reminder - don't redirect them to login */}
          {isProtection && !isExistingUser ? (
            <div style={{
              backgroundColor: '#eff6ff',
              border: '2px solid #3b82f6',
              borderRadius: '12px',
              padding: '20px',
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>📧</div>
              <h3 style={{
                fontSize: '18px',
                fontWeight: 'bold',
                color: '#1e40af',
                margin: '0 0 12px 0'
              }}>
                Check Your Email to Login
              </h3>
              <p style={{
                fontSize: '15px',
                color: '#1e40af',
                lineHeight: '1.6',
                margin: 0
              }}>
                We've sent a secure login link to <strong>{router.query.email}</strong>.
                Click the "Complete My Profile" button in the email to access your account and verify your information.
              </p>
              <p style={{
                fontSize: '13px',
                color: '#60a5fa',
                marginTop: '12px',
                margin: '12px 0 0 0',
                fontStyle: 'italic'
              }}>
                Tip: Check your spam folder if you don't see it within 2 minutes
              </p>
            </div>
          ) : (
            <>
              {/* Check email reminder for free alerts users */}
              {!isProtection && !isExistingUser && (
                <div style={{
                  backgroundColor: '#eff6ff',
                  border: '2px solid #3b82f6',
                  borderRadius: '12px',
                  padding: '20px',
                  textAlign: 'center',
                  marginBottom: '16px'
                }}>
                  <div style={{ fontSize: '48px', marginBottom: '12px' }}>📧</div>
                  <h3 style={{
                    fontSize: '18px',
                    fontWeight: 'bold',
                    color: '#1e40af',
                    margin: '0 0 12px 0'
                  }}>
                    Check Your Email to Login
                  </h3>
                  <p style={{
                    fontSize: '15px',
                    color: '#1e40af',
                    lineHeight: '1.6',
                    margin: 0
                  }}>
                    We've sent a secure login link to your email. Click the link to access your account settings.
                  </p>
                  <p style={{
                    fontSize: '13px',
                    color: '#60a5fa',
                    marginTop: '12px',
                    margin: '12px 0 0 0',
                    fontStyle: 'italic'
                  }}>
                    Tip: Check your spam folder if you don't see it within 2 minutes
                  </p>
                </div>
              )}

              {/* For existing users, show account button */}
              {isExistingUser && (
                <button
                  onClick={() => router.push('/settings')}
                  style={{
                    backgroundColor: '#0052cc',
                    color: 'white',
                    border: 'none',
                    borderRadius: '12px',
                    padding: '16px',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.backgroundColor = '#003d99';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.backgroundColor = '#0052cc';
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
                    color: '#0052cc',
                    border: '2px solid #0052cc',
                    borderRadius: '12px',
                    padding: '14px',
                    fontSize: '16px',
                    fontWeight: '600',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                  onMouseOver={(e) => {
                    e.currentTarget.style.backgroundColor = '#f0f8ff';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  Learn About Ticket Protection
                </button>
              )}
            </>
          )}

          <button
            onClick={() => router.push('/')}
            style={{
              backgroundColor: 'transparent',
              color: '#6b7280',
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
          fontSize: '14px',
          color: '#9ca3af',
          marginTop: '32px',
          margin: '32px 0 0 0'
        }}>
          Questions? Email us at <a href="mailto:support@autopilotamerica.com" style={{ color: '#0052cc', textDecoration: 'none' }}>support@autopilotamerica.com</a>
        </p>
      </div>
    </div>
  );
}