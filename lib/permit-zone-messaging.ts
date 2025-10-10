/**
 * Messaging templates for requesting permit zone documents from users
 */

export const PERMIT_ZONE_MESSAGES = {
  /**
   * SMS message to send to users when they need to upload documents
   * Keep under 160 characters if possible for single SMS
   */
  sms: {
    // Option 1: Text back method (RECOMMENDED - easiest for users)
    textBack: `Hi! To purchase your residential parking permit, please text back 2 photos:
1. Your driver's license or state ID
2. Proof of residency (utility bill, lease, or mortgage)

Reply with the photos and we'll handle the rest!`,

    // Option 2: Upload link method
    uploadLink: `Hi! To purchase your residential parking permit, upload your ID and proof of residency here: https://ticketlessamerica.com/permit-zone-documents

Need help? Just reply to this text.`,

    // Option 3: Customer code method (for returning users)
    customerCode: `Hi! Do you already have a Customer Code from the City of Chicago for parking permits? If yes, text it back. If no, reply "NO" and we'll guide you through getting one.`,
  },

  /**
   * Email templates for requesting documents
   */
  email: {
    subject: 'Action Required: Upload Documents for Your Parking Permit',

    // Option 1: Text back method
    textBackBody: `
Hi there!

To complete your residential parking permit purchase for your Chicago address, we need two documents from you:

1. **Valid Photo ID** - Driver's license, state ID, CityKey, U.S. Passport, or Military ID
2. **Proof of Residency** - Any ONE of the following:
   - Current mortgage or lease
   - Utility bill from last 30 days (water, gas, electric)
   - Property tax bill
   - Landline phone bill (cell phone bills NOT accepted)
   - Cable or satellite TV bill
   - USPS Change of Address confirmation

**How to submit:**
Simply **reply to this email** with both documents attached as photos or PDFs.

**Important:** The name and address on your documents must match the information you provided to us.

Questions? Just reply to this email.

Best,
Ticketless America Team
    `.trim(),

    // Option 2: Upload portal method
    uploadPortalBody: `
Hi there!

To complete your residential parking permit purchase for your Chicago address, we need to verify your residency.

**Documents Required:**
1. **Valid Photo ID** - Driver's license, state ID, CityKey, U.S. Passport, or Military ID
2. **Proof of Residency** - Utility bill, mortgage/lease, property tax bill, etc.

**Upload Your Documents:**
Click here to securely upload your documents: https://ticketlessamerica.com/permit-zone-documents

**Already have a Customer Code from the City of Chicago?**
If you've purchased a permit online before, you can skip the document upload and just enter your Customer Code at the link above.

Questions? Just reply to this email.

Best,
Ticketless America Team
    `.trim(),

    // Option 3: Hybrid method (both options)
    hybridBody: `
Hi there!

To complete your residential parking permit purchase, we need to verify your Chicago residency.

**Option 1: Text Us** (Fastest)
Text photos of your ID and proof of residency to: [YOUR_PHONE_NUMBER]

**Option 2: Upload Online**
Visit: https://ticketlessamerica.com/permit-zone-documents

**Already have a Customer Code?**
If you have a Customer Code from the City of Chicago, just text it to us or enter it at the link above.

**Documents We Need:**
- Valid Photo ID (driver's license, state ID, passport, or military ID)
- Proof of Residency (utility bill, lease, mortgage, property tax bill, etc.)

Questions? Reply to this email or text us.

Best,
Ticketless America Team
    `.trim(),
  },

  /**
   * Follow-up messages
   */
  followUp: {
    smsReminder: `Quick reminder: We still need your ID and proof of residency to purchase your parking permit. Text them back when you get a chance!`,

    emailReminder: {
      subject: 'Reminder: Documents Needed for Your Parking Permit',
      body: `
Hi there,

Just a friendly reminder that we're still waiting for your documents to complete your parking permit purchase.

We need:
1. Valid photo ID
2. Proof of residency

Reply to this email with the documents or upload at: https://ticketlessamerica.com/permit-zone-documents

Let us know if you need any help!

Best,
Ticketless America Team
      `.trim(),
    },
  },

  /**
   * Rejection/resubmission messages
   */
  resubmission: {
    // These are handled automatically by the admin review system
    // See: pages/api/admin/review-permit-document.ts
  },
};

/**
 * Helper function to get the recommended message based on delivery method
 */
export function getRecommendedMessage(deliveryMethod: 'sms' | 'email'): string {
  if (deliveryMethod === 'sms') {
    return PERMIT_ZONE_MESSAGES.sms.textBack;
  }
  return PERMIT_ZONE_MESSAGES.email.textBackBody;
}

/**
 * City of Chicago requirements reference
 * For your internal use / customer support
 */
export const CHICAGO_PERMIT_REQUIREMENTS = {
  acceptableIDs: [
    'Driver\'s license',
    'State ID',
    'Chicago CityKey ID',
    'U.S. Passport',
    'U.S. Military ID',
  ],

  acceptableProofOfResidency: [
    'Current mortgage or lease',
    'USPS Change of Address Confirmation',
    'Water, gas, or electric utility bill (within 30 days)',
    'Property tax bill',
    'Landline phone bill (cell phone NOT accepted)',
    'Satellite or cable television bill',
  ],

  rules: [
    'Name on ID must match name on proof of residency',
    'Address on proof must match the address for the permit zone',
    'Utility bills must be within 30 days',
    'Cell phone bills are NOT accepted',
    'All documents must be clear and readable',
  ],

  officialLink: 'https://www.chicago.gov/city/en/depts/cdot/provdrs/parking_and_transportation/svcs/parking_permits.html',
};
