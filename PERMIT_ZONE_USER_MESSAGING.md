# Permit Zone Document Collection - User Messaging Guide

## ✅ READY TO USE - Admin Dashboard Fixed

**Admin Dashboard:** https://ticketlessamerica.com/admin-permit-documents
**Password:** `ticketless2025admin`

The database query error has been fixed. You should now be able to see uploaded documents.

---

## 📱 RECOMMENDED APPROACH: Text/Email Response

Based on user experience, **text/email response is easier for users** than asking them to visit a website.

### **SMS Message to Send Users:**

```
Hi! To purchase your residential parking permit, please text back 2 photos:
1. Your driver's license or state ID
2. Proof of residency (utility bill, lease, or mortgage)

Reply with the photos and we'll handle the rest!
```

### **When Users Text Back Documents:**

**Option A (Manual):**
- Save the photos they send
- Review them yourself
- Process the permit purchase manually

**Option B (Use the System):**
- You (admin) can upload their docs to the portal on their behalf
- OR forward them to upload at: https://ticketlessamerica.com/permit-zone-documents
- Use the admin dashboard to track status

---

## 🌐 ALTERNATIVE: Upload Portal Link

If you prefer users to upload directly:

### **SMS Message:**
```
Hi! To purchase your residential parking permit, upload your ID and proof of residency here:
https://ticketlessamerica.com/permit-zone-documents

Need help? Just reply to this text.
```

### **Email Template:**

**Subject:** Action Required: Upload Documents for Your Parking Permit

```
Hi there!

To complete your residential parking permit purchase, we need to verify your residency.

**Documents Required:**
1. Valid Photo ID - Driver's license, state ID, passport, or military ID
2. Proof of Residency - Utility bill, mortgage/lease, property tax bill, etc.

**Option 1: Text Us** (Fastest)
Text photos of both documents to: [YOUR_PHONE_NUMBER]

**Option 2: Upload Online**
Visit: https://ticketlessamerica.com/permit-zone-documents

**Already have a Customer Code from the City?**
If you've purchased a permit before, just text us your Customer Code or enter it at the link above.

Questions? Reply to this email.

Best,
Ticketless America Team
```

---

## 🎯 HYBRID APPROACH (Recommended)

Give users both options - most will text, some will prefer the portal:

1. **Primary:** Text them asking to reply with photos
2. **Secondary:** Mention they can also upload at the link
3. **You decide:** Which method to track in the admin system

---

## 📋 What Documents Are Required

Per City of Chicago requirements:

### **ID (choose one):**
- Driver's license or state ID
- Chicago CityKey ID
- U.S. Passport
- U.S. Military ID

### **Proof of Residency (choose one):**
- Current mortgage or lease
- Utility bill from last 30 days (water, gas, electric)
- Property tax bill
- Landline phone bill (NOT cell phone)
- Cable or satellite TV bill
- USPS Change of Address confirmation

### **Important Rules:**
- Name on ID must match proof of residency
- Address must match the permit zone address
- All documents must be clear and readable
- Utility bills must be within 30 days

---

## 🔄 Using the Admin System

Once docs are uploaded (by user or by you):

1. **Go to:** https://ticketlessamerica.com/admin-permit-documents
2. **Login** with password
3. **Review documents:** Click to view ID and proof of residency
4. **Approve or Reject:**
   - **Approve:** Enter the Customer Code from City of Chicago
   - **Reject:** Select reason(s) from dropdown
5. **User gets email** automatically with the decision

### **If Approving:**
- You'll need to purchase the permit from the City first
- Get the Customer Code from the City
- Enter it in the admin system
- User gets approval email with their code

### **If Rejecting:**
- Select reasons (blurry, expired, wrong address, etc.)
- Add custom notes if needed
- User gets email explaining what to fix
- They can resubmit

---

## 💡 My Recommendation

**For Users:** Ask them to text photos back (easiest for them)

**For You:** Use the admin system to:
- Track who you've requested docs from
- Keep documents organized
- Send automated approval/rejection emails
- Store customer codes for renewals

**Best of Both Worlds:** Text for collection, portal for organization.

---

## 📞 Getting Started

1. **Test it yourself first:**
   - Upload some test documents at the user portal
   - Review them in the admin dashboard
   - Test approval/rejection emails

2. **Decide your approach:**
   - Text-only, portal-only, or hybrid?

3. **Send first message to users in permit zones**

All messaging templates are in: `lib/permit-zone-messaging.ts`

---

## ❓ Questions?

- **How do I know who's in a permit zone?** Check their address at `/api/check-permit-zone`
- **What if they already have a Customer Code?** They can enter it directly (no docs needed)
- **Do documents expire?** Keep them for next year's renewal
- **Can I upload on their behalf?** Yes, you could build that feature if needed

The system is ready - you choose how much automation to use! 🚀
