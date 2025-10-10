# Permit Zone Document Verification System

This system enables users to upload required documents (ID and proof of residency) to purchase residential parking permits for Chicago permit zones. The system includes document storage, admin review, and automated email notifications.

## Features

- ✅ Mobile-friendly document upload with drag-and-drop
- ✅ Secure document storage using Vercel Blob
- ✅ Admin review dashboard with approval/rejection workflow
- ✅ Automated email notifications for approvals and rejections
- ✅ Pre-configured common rejection reasons
- ✅ Customer code storage for future permit purchases
- ✅ Documents retained for next year (no auto-delete)

## Setup Instructions

### 1. Database Migration

Run the database migration to create the necessary tables:

```sql
-- Run this migration file:
database-migrations/007-add-permit-zone-documents.sql
```

This creates:
- `permit_zone_documents` table for storing document info and verification status
- Index on `user_id` and `verification_status` for faster queries
- Reference field in `users` table for current permit document

### 2. Environment Variables

Add these environment variables to your `.env.local` file:

```bash
# Vercel Blob Storage
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_xxxxx

# Admin Access Token (generate a secure random string)
ADMIN_API_TOKEN=your_secure_admin_token_here
NEXT_PUBLIC_ADMIN_TOKEN=your_secure_admin_token_here

# Already required (make sure these are set):
RESEND_API_KEY=re_xxxxx
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

#### Getting Vercel Blob Token

1. Go to your Vercel project dashboard
2. Navigate to Storage → Create → Blob
3. Copy the `BLOB_READ_WRITE_TOKEN` from the environment variables

### 3. Admin Password

The admin dashboard is protected by a password. Default password is: `ticketless2025admin`

You can change this in:
- `/pages/admin-permit-documents.tsx` (line with password check)

## User Flow

1. **User visits permit zone documents page**: `/permit-zone-documents`
2. **Check if address is in permit zone**: Uses existing `/api/check-permit-zone` endpoint
3. **Upload documents**:
   - Valid photo ID (driver's license, state ID, passport, military ID)
   - Proof of residency (mortgage/lease, utility bill, tax bill, etc.)
4. **Documents stored in Vercel Blob** and database record created with status "pending"
5. **Admin reviews documents** at `/admin-permit-documents`
6. **Admin approves or rejects**:
   - **Approve**: Enter customer code from City of Chicago, user receives approval email
   - **Reject**: Select reasons from dropdown, user receives email with issues to fix
7. **User can resubmit** if rejected

## API Endpoints

### User Endpoints

#### Upload Documents
```
POST /api/permit-zone/upload-documents
Content-Type: multipart/form-data

Fields:
- userId: number
- address: string
- idDocument: File (JPG, PNG, HEIC, or PDF, max 10MB)
- proofOfResidency: File (JPG, PNG, HEIC, or PDF, max 10MB)

Response:
{
  "success": true,
  "documentId": 123
}
```

#### Get Document Status
```
GET /api/permit-zone/document-status?userId=123

Response:
{
  "success": true,
  "status": "pending" | "approved" | "rejected" | "none",
  "documentId": 123,
  "rejectionReason": "...",
  "customerCode": "..."
}
```

### Admin Endpoints (require Authorization header)

#### Get All Documents
```
GET /api/admin/permit-documents?status=pending
Authorization: Bearer YOUR_ADMIN_TOKEN

Response:
{
  "success": true,
  "documents": [...]
}
```

#### Review Document
```
POST /api/admin/review-permit-document
Authorization: Bearer YOUR_ADMIN_TOKEN
Content-Type: application/json

Body:
{
  "documentId": 123,
  "action": "approve" | "reject",
  "rejectionReasons": ["ID_NOT_CLEAR", "ADDRESS_MISMATCH"],
  "customReason": "Optional additional details",
  "customerCode": "CUST123" // Required for approval
}

Response:
{
  "success": true
}
```

## Rejection Reasons

Pre-configured rejection reasons (defined in `/pages/api/admin/review-permit-document.ts`):

- `ID_NOT_CLEAR`: ID document is not clear or readable
- `ID_EXPIRED`: ID document has expired
- `ID_WRONG_TYPE`: ID document type is not acceptable
- `PROOF_NOT_CLEAR`: Proof of residency is not clear or readable
- `PROOF_OLD`: Utility bill is older than 30 days
- `PROOF_WRONG_TYPE`: Proof of residency type is not acceptable
- `ADDRESS_MISMATCH`: Address on proof doesn't match
- `NAME_MISMATCH`: Name mismatch between documents
- `MISSING_INFO`: Document is missing required information
- `CELL_PHONE_BILL`: Cell phone bills are not accepted
- `OTHER`: Other issue

## Email Notifications

### Approval Email
- Subject: "Your Permit Zone Documents Have Been Approved! ✅"
- Includes: Address, customer code, next steps

### Rejection Email
- Subject: "Action Needed: Permit Zone Documents"
- Includes: List of issues, additional details, link to resubmit

## Admin Dashboard

Access at: `/admin-permit-documents`

**Features:**
- Filter by status (Pending, Approved, Rejected, All)
- View document images in new tabs
- See user info (name, email, phone, address)
- Inline review form with:
  - Customer code input (for approval)
  - Checkbox list of common rejection reasons
  - Custom reason text area
  - Approve/Reject buttons

## Security Considerations

1. **Document Access**: Documents are stored in Vercel Blob with `public` access (URLs are unguessable but not protected)
2. **Admin Authentication**: Currently using simple token auth - consider upgrading to proper session-based auth
3. **File Validation**:
   - File types: JPG, PNG, HEIC, PDF only
   - Max size: 10MB per file
   - File content type validation

## Future Enhancements

- [ ] Add user notification preferences (email/SMS)
- [ ] Implement OCR to auto-extract info from documents
- [ ] Auto-verify address matching
- [ ] Track permit expiration and send renewal reminders
- [ ] Support for multiple vehicles per household
- [ ] Integration with City of Chicago permit purchase API (when available)

## Files Created/Modified

### New Files:
- `database-migrations/007-add-permit-zone-documents.sql`
- `pages/api/permit-zone/upload-documents.ts`
- `pages/api/permit-zone/document-status.ts`
- `pages/api/admin/permit-documents.ts`
- `pages/api/admin/review-permit-document.ts`
- `pages/admin-permit-documents.tsx`
- `pages/permit-zone-documents.tsx`
- `components/PermitZoneDocumentUpload.tsx`
- `PERMIT_ZONE_DOCUMENTS_SETUP.md`

### Modified Files:
- `.env.example` - Added Vercel Blob and admin token variables
- `package.json` - Added `@vercel/blob` dependency

## Testing

### Test User Flow:
1. Create a test user account
2. Navigate to `/permit-zone-documents`
3. Enter an address in a permit zone (e.g., "1710 S Clinton St")
4. Upload test documents (can use any JPG/PDF)
5. Check that documents appear in admin dashboard

### Test Admin Flow:
1. Navigate to `/admin-permit-documents`
2. Enter password: `ticketless2025admin`
3. View pending documents
4. Test rejection with multiple reasons
5. Check that user receives email
6. Test approval with customer code
7. Verify status updates correctly

## Support

For issues or questions, contact the development team or check the main README.
