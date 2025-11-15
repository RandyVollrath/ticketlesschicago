# User Profile Page - Code Examples & Snippets

## Key Code Patterns

### 1. Protection Status Display (UpgradeCard Component)

**Location**: `/home/randy-vollrath/ticketless-chicago/components/UpgradeCard.tsx:17-150`

**Free User Rendering**:
```tsx
return (
  <div style={{
    backgroundColor: 'white',
    borderRadius: '16px',
    border: '2px solid #0052cc',
    padding: '24px',
    boxShadow: '0 4px 12px rgba(0, 82, 204, 0.1)'
  }}>
    <div style={{ ... }}>
      <div style={{ flex: 1 }}>
        <div style={{ ... }}>PREMIUM</div>
        <h3>Upgrade to Ticket Protection</h3>
        <p>Get comprehensive renewal reminders so you never miss city sticker, 
           license plate, or emissions deadlines. Plus 80% reimbursement on 
           eligible tickets (up to $200/year).</p>
        <ul>
          <li>Renewal reminders & tracking</li>
          <li>80% ticket reimbursement (up to $200/year)</li>
          <li>Priority customer support</li>
        </ul>
        <button onClick={handleUpgradeClick}>Get Protected →</button>
      </div>
      <div>Starting at $12 per month</div>
    </div>
  </div>
);
```

**Protected User Rendering**:
```tsx
if (hasProtection) {
  return (
    <div style={{ border: '2px solid #10b981', ... }}>
      <div style={{ ... }}>
        <div style={{ backgroundColor: '#dcfce7', ... }}>ACTIVE</div>
        <h3>🎉 You're Protected!</h3>
        <p>Your Ticket Protection is active. Get renewal reminders and 80% 
           reimbursement on eligible tickets (up to $200/year).</p>
        <ul>
          <li>✓ Renewal reminders & tracking</li>
          <li>✓ 80% ticket reimbursement (up to $200/year)</li>
          <li>✓ Priority customer support</li>
        </ul>
        <p>Make sure your profile is complete and accurate to maintain your 
           coverage guarantee.</p>
      </div>
      <div style={{ backgroundColor: '#f0fdf4', ... }}>🛡️ Protected</div>
    </div>
  );
}
```

### 2. License Upload Section Visibility (Settings Page)

**Location**: `/home/randy-vollrath/ticketless-chicago/pages/settings.tsx:1650`

```tsx
{/* Driver's License Upload - Only for Protection users with city sticker + permit zone */}
{profile.has_protection && profile.city_sticker_expiry && profile.has_permit_zone && (
  <div id="license-upload" style={{ ... }}>
    {/* Content only shows if all three conditions are true */}
  </div>
)}
```

### 3. Document Status Component (Permit Zone Users)

**Location**: `/home/randy-vollrath/ticketless-chicago/components/DocumentStatus.tsx:65-250`

**Conditional Rendering**:
```tsx
if (!hasPermitZone) {
  return null; // Only show for permit zone users
}

// Driver's License Status Section
<div style={{
  padding: '16px',
  backgroundColor: docs?.hasLicense ? '#f0fdf4' : '#fef3c7',
  borderRadius: '8px',
  border: `2px solid ${docs?.hasLicense ? '#10b981' : '#f59e0b'}`
}}>
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span style={{ fontSize: '24px' }}>
          {docs?.hasLicense ? '✅' : '⚠️'}
        </span>
        <strong>Driver's License</strong>
      </div>
      {docs?.hasLicense ? (
        <div style={{ marginTop: '8px', fontSize: '14px', color: '#059669' }}>
          <div>✓ Uploaded: {formatDate(docs.licenseUploadedAt)}</div>
          {docs.licenseExpiresAt && (
            <div style={{
              color: isExpiringSoon(docs.licenseExpiresAt) ? '#f59e0b' : '#059669',
              fontWeight: isExpiringSoon(docs.licenseExpiresAt) ? 'bold' : 'normal'
            }}>
              {isExpiringSoon(docs.licenseExpiresAt) ? '⚠️' : '✓'} 
              Expires: {formatDate(docs.licenseExpiresAt)}
            </div>
          )}
        </div>
      ) : (
        <div style={{ marginTop: '8px', fontSize: '14px', color: '#d97706' }}>
          Not uploaded yet
        </div>
      )}
    </div>
    {!docs?.hasLicense && (
      <a href="#license-upload" style={{ ... }}>Upload Now</a>
    )}
  </div>
</div>
```

**Proof of Residency Status Section**:
```tsx
<div style={{
  padding: '16px',
  backgroundColor: docs?.hasBill ? '#f0fdf4' : '#fef3c7',
  borderRadius: '8px',
  border: `2px solid ${docs?.hasBill ? '#10b981' : '#f59e0b'}`
}}>
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span>{docs?.hasBill ? '✅' : '⚠️'}</span>
        <strong>Proof of Residency (Utility Bill)</strong>
      </div>
      {docs?.hasBill ? (
        <div style={{ marginTop: '8px', fontSize: '14px', color: '#059669' }}>
          <div>✓ Most recent bill: {formatDate(docs.billUploadedAt)}</div>
          <div>✓ {docs.billVerified ? 'Verified and ready' : 'Processing...'}</div>
        </div>
      ) : (
        <div style={{ marginTop: '8px', fontSize: '14px', color: '#d97706' }}>
          <div>No bill received yet</div>
          {docs?.emailForwardingAddress && (
            <div style={{ marginTop: '4px', fontSize: '12px', color: '#666' }}>
              Forward bills to: <code>{docs.emailForwardingAddress}</code>
            </div>
          )}
        </div>
      )}
    </div>
    {!docs?.hasBill && (
      <a href="#email-forwarding">Set Up</a>
    )}
  </div>
</div>
```

### 4. License Upload Form (Separate Front & Back)

**Location**: `/home/randy-vollrath/ticketless-chicago/pages/settings.tsx:1876-2075`

**Upload States**:
```tsx
// State management for front license
const [licenseFrontFile, setLicenseFrontFile] = useState<File | null>(null)
const [licenseFrontPreview, setLicenseFrontPreview] = useState<string | null>(null)
const [licenseFrontUploading, setLicenseFrontUploading] = useState(false)
const [licenseFrontUploadError, setLicenseFrontUploadError] = useState('')
const [licenseFrontUploadSuccess, setLicenseFrontUploadSuccess] = useState(false)

// Same states for back
const [licenseBackFile, setLicenseBackFile] = useState<File | null>(null)
// ... etc
```

**File Input**:
```tsx
<div style={{ marginBottom: '24px' }}>
  <h3 style={{ fontSize: '16px', fontWeight: '600', color: '#111827', marginBottom: '12px' }}>
    Front of License
  </h3>
  <input
    type="file"
    accept="image/jpeg,image/jpg,image/png,image/webp"
    onChange={(e) => handleLicenseFileChange(e, 'front')}
    disabled={licenseFrontUploading}
    style={{
      width: '100%',
      padding: '12px',
      border: '2px solid #d1d5db',
      borderRadius: '8px',
      fontSize: '15px',
      boxSizing: 'border-box',
      backgroundColor: 'white',
      cursor: licenseFrontUploading ? 'not-allowed' : 'pointer',
      marginBottom: '12px'
    }}
  />

  {licenseFrontUploading && (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      fontSize: '14px',
      color: '#0052cc',
      marginBottom: '12px'
    }}>
      <div style={{ ... /* spinner styles */ }}></div>
      <span>Verifying front image quality...</span>
    </div>
  )}

  {licenseFrontUploadError && (
    <div style={{
      backgroundColor: '#fee2e2',
      border: '1px solid #fca5a5',
      borderRadius: '8px',
      padding: '12px',
      fontSize: '14px',
      color: '#b91c1c',
      marginBottom: '12px'
    }}>
      <strong>⚠️ Upload failed:</strong> {licenseFrontUploadError}
    </div>
  )}

  {licenseFrontPreview && !licenseFrontUploading && !licenseFrontUploadError && (
    <div style={{ border: '2px solid #10b981', borderRadius: '8px', overflow: 'hidden' }}>
      <img src={licenseFrontPreview} alt="License front preview" />
      {licenseFrontUploadSuccess && (
        <div style={{ backgroundColor: '#dcfce7', padding: '12px', textAlign: 'center' }}>
          ✓ Front uploaded successfully! Image verified and ready for processing.
        </div>
      )}
    </div>
  )}
</div>
```

### 5. Consent Checkboxes

**Location**: `/home/randy-vollrath/ticketless-chicago/pages/settings.tsx:1769-1873`

```tsx
{/* Consent Checkboxes */}
<div style={{
  backgroundColor: '#fefce8',
  border: '2px solid #fde047',
  borderRadius: '8px',
  padding: '16px',
  marginBottom: '16px'
}}>
  <p style={{
    fontSize: '14px',
    fontWeight: '600',
    color: '#854d0e',
    margin: '0 0 12px 0'
  }}>
    Required Consent
  </p>

  {/* Vision API Consent */}
  <label style={{
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    cursor: 'pointer',
    marginBottom: '12px'
  }}>
    <input
      type="checkbox"
      checked={thirdPartyConsent}
      onChange={(e) => setThirdPartyConsent(e.target.checked)}
      style={{
        marginTop: '3px',
        width: '18px',
        height: '18px',
        cursor: 'pointer',
        flexShrink: 0
      }}
    />
    <span style={{
      fontSize: '13px',
      color: '#713f12',
      lineHeight: '1.5'
    }}>
      I consent to Google Cloud Vision API processing my driver's license image 
      to verify image quality. The image will be immediately encrypted after 
      verification and stored securely.
    </span>
  </label>

  {/* License Storage Consent */}
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
      style={{ ... }}
    />
    <span style={{
      fontSize: '13px',
      color: '#713f12',
      lineHeight: '1.5'
    }}>
      <strong>Optional:</strong> Store my license until it expires (recommended). 
      If unchecked, we'll delete it within 48 hours after processing your renewal, 
      and you'll need to upload it again next year.
    </span>
  </label>

  {/* Conditional Expiry Date Input */}
  {reuseConsent && (
    <div style={{ marginTop: '12px' }}>
      <label style={{
        display: 'block',
        fontSize: '13px',
        fontWeight: '600',
        color: '#713f12',
        marginBottom: '6px'
      }}>
        Driver's License Expiration Date
      </label>
      <input
        type="date"
        value={licenseExpiryDate}
        onChange={(e) => setLicenseExpiryDate(e.target.value)}
        style={{
          width: '100%',
          padding: '8px',
          border: '1px solid #d1d5db',
          borderRadius: '6px',
          fontSize: '13px'
        }}
      />
      <p style={{
        fontSize: '11px',
        color: '#92400e',
        margin: '4px 0 0 0'
      }}>
        We'll automatically delete your license on this date
      </p>
    </div>
  )}
</div>
```

### 6. Email Forwarding Setup Component

**Location**: `/home/randy-vollrath/ticketless-chicago/components/EmailForwardingSetup.tsx:24-150`

```tsx
<div id="email-forwarding" className="bg-white shadow sm:rounded-lg">
  <div className="px-4 py-5 sm:p-6">
    <h3 className="text-lg font-medium leading-6 text-gray-900">
      Set Up Automatic Bill Forwarding
    </h3>
    <div className="mt-2 max-w-xl text-sm text-gray-500">
      <p>
        Forward your monthly utility bills automatically so we always have 
        your most recent proof of residency.
      </p>
    </div>

    {/* Forwarding Address Display */}
    <div className="mt-5">
      <div className="rounded-md bg-blue-50 p-4">
        <div className="flex">
          <div className="flex-shrink-0">
            <CheckCircleIcon className="h-5 w-5 text-blue-400" />
          </div>
          <div className="ml-3 flex-1">
            <h3 className="text-sm font-medium text-blue-800">Your Forwarding Address</h3>
            <div className="mt-2 text-sm text-blue-700">
              <div className="flex items-center gap-2">
                <code className="rounded bg-blue-100 px-2 py-1 font-mono text-xs break-all">
                  {forwardingEmail}
                </code>
                <button
                  onClick={copyToClipboard}
                  className="inline-flex items-center rounded-md bg-blue-600 px-2 py-1 text-xs font-semibold text-white"
                >
                  {copied ? (
                    <>
                      <CheckCircleIcon className="h-4 w-4 mr-1" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <ClipboardDocumentIcon className="h-4 w-4 mr-1" />
                      Copy
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    {/* Setup Instructions - Example: ComEd */}
    <div className="mt-6">
      <h4 className="text-sm font-medium text-gray-900 mb-3">Setup Instructions</h4>

      <details className="group border border-gray-200 rounded-lg">
        <summary className="cursor-pointer px-4 py-3 font-medium text-gray-900 hover:bg-gray-50">
          ComEd (Commonwealth Edison)
        </summary>
        <div className="px-4 pb-4 pt-2 text-sm text-gray-600 space-y-2">
          <p className="font-medium text-gray-700">Step 1: Open Gmail and search for ComEd emails</p>
          <p>Search for: <code className="bg-gray-100 px-2 py-0.5 rounded">from:@comed.com</code></p>

          <p className="font-medium text-gray-700 mt-3">Step 2: Create a filter</p>
          <ol className="list-decimal list-inside space-y-1 ml-2">
            <li>Click the search options dropdown (Show search options)</li>
            <li>Enter <code className="bg-gray-100 px-2 py-0.5 rounded">@comed.com</code> in the "From" field</li>
            <li>Enter <code className="bg-gray-100 px-2 py-0.5 rounded">bill OR statement</code> in "Has the words" field</li>
            <li>Click "Create filter"</li>
          </ol>

          <p className="font-medium text-gray-700 mt-3">Step 3: Set up forwarding</p>
          <ol className="list-decimal list-inside space-y-1 ml-2">
            <li>Check "Forward it to"</li>
            <li>Add forwarding address: <code className="bg-gray-100 px-2 py-0.5 rounded text-xs">{forwardingEmail}</code></li>
            <li>Gmail will send a verification email - click the confirmation link</li>
            <li>Click "Create filter"</li>
          </ol>

          <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded">
            <p className="text-xs text-yellow-800">
              <strong>Note:</strong> You'll receive a one-time verification email at your 
              forwarding address. Just click the link to confirm. After that, all your 
              ComEd bills will forward automatically.
            </p>
          </div>
        </div>
      </details>
    </div>
  </div>
</div>
```

### 7. Database Field Updates

**Location**: `/home/randy-vollrath/ticketless-chicago/pages/settings.tsx` (within update function)

```typescript
interface UserProfile {
  // ... other fields ...
  has_protection: boolean
  is_paid: boolean
  has_permit_zone: boolean
  
  // License fields
  license_image_path: string | null
  license_image_path_back: string | null
  license_image_uploaded_at: string | null
  license_image_back_uploaded_at: string | null
  license_valid_until: string | null
  
  // Residency fields
  residency_proof_path: string | null
  residency_proof_uploaded_at: string | null
  residency_proof_verified: boolean | null
  
  // Email forwarding
  email_forwarding_address: string | null
}
```

## Key Conditional Patterns

### Pattern 1: Protection Status
```tsx
if (profile.has_protection) {
  // Show "You're Protected!" card
} else {
  // Show "Upgrade" card
}
```

### Pattern 2: License Upload Visibility
```tsx
if (profile.has_protection && profile.city_sticker_expiry && profile.has_permit_zone) {
  // Show license upload form
}
```

### Pattern 3: Permit Zone Features
```tsx
if (profile.has_permit_zone) {
  // Show DocumentStatus
  // Show EmailForwardingSetup
}
```

### Pattern 4: License Expiration Verification
```tsx
const isExpiringSoon = (expiryDate: string | null) => {
  if (!expiryDate) return false;
  const expiry = new Date(expiryDate);
  const today = new Date();
  const daysUntilExpiry = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  return daysUntilExpiry <= 90; // 90 days before expiration
};
```

