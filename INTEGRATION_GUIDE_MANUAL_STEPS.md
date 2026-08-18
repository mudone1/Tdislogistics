# Email Management System - Integration Guide

**Status:** API Routes Complete & Ready for Integration  
**Date:** August 18, 2026  
**What's Been Done:** All API endpoints, TypeScript types, error handling, and WhatsApp integration logic

---

## 📋 What I've Built For You

### ✅ API Routes (6 Endpoints)
1. **POST /api/email/upload-ticket** - Upload ticket screenshot and generate draft
2. **POST /api/email/send** - Send approved email to airline
3. **POST /api/email/edit** - Edit draft before sending
4. **POST /api/email/cancel** - Cancel email case
5. **GET /api/email/cases/[caseId]** - Get case details with replies and audit trail
6. **GET /api/email/reports/now** - Generate manual status update

### ✅ Supporting Infrastructure
- **Error handler** with standardized error responses
- **TypeScript types** for all requests/responses
- **WhatsApp message handler** to route WhatsApp messages to API
- **App initialization** module for system startup
- **Button response handler** for interactive WhatsApp messages

### ✅ File Structure
```
src/
├── app/api/email/
│   ├── upload-ticket/route.ts       ← Upload & parse tickets
│   ├── send/route.ts                 ← Send emails
│   ├── edit/route.ts                 ← Edit drafts
│   ├── cancel/route.ts               ← Cancel cases
│   ├── cases/[caseId]/route.ts       ← Get case status
│   ├── reports/now/route.ts          ← Manual status update
│   └── admin/init/route.ts           ← Initialize system
├── modules/email-management/
│   ├── api/errorHandler.ts           ← Error handling utilities
│   ├── types/email.types.ts          ← TypeScript types
│   ├── integrations/whatsappMessageHandler.ts  ← WhatsApp handler
│   └── app-init.ts                   ← Initialization helper
```

---

## 🔧 What YOU Need to Do Manually (Step-by-Step)

### PHASE 1: Add Environment Variables (5 minutes)

Add these to your `.env.local` file (for local dev) and Railway dashboard (for production):

```bash
# Database (already configured)
DATABASE_URL=postgresql://...
DIRECT_URL=postgresql://...

# SMTP Configuration - REQUIRED
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-business-email@gmail.com
SMTP_PASSWORD=your-app-specific-password
SMTP_FROM_NAME=TDIS Logistics
SMTP_FROM_EMAIL=your-business-email@gmail.com

# WhatsApp Integration - REQUIRED
WHATSAPP_SERVICE_URL=http://whatsapp-service:4200
ADMIN_WHATSAPP_CHAT_ID=120xx@g.us  # Your admin group chat ID

# Feature Flags (optional but recommended)
ENABLE_EMAIL_REPORTS=true
ENABLE_EMAIL_MONITORING=true
NODE_ENV=production

# Email API Base URL (for WhatsApp handler to call back)
EMAIL_API_BASE_URL=http://localhost:3000
```

**How to get SMTP credentials (Gmail):**
1. Go to https://myaccount.google.com/apppasswords
2. Select "Mail" and "Windows Computer"
3. Copy the 16-character password
4. Paste as `SMTP_PASSWORD`

**How to get Admin WhatsApp Chat ID:**
1. Get a message ID from your admin group chat in WhatsApp
2. Extract the chat ID (format: `120xx@g.us` for groups)
3. Use that as `ADMIN_WHATSAPP_CHAT_ID`

---

### PHASE 2: Initialize Database (10 minutes)

Run these commands **from project root** (`C:\Users\USER\Desktop\TDIS`):

```bash
# 1. Create and run database migration
npx prisma migrate deploy

# 2. Initialize email system (seed database with airlines, templates)
npx ts-node -e "
  import { initializeEmailManagementSystem } from './src/modules/email-management/services/emailSystemInit';
  initializeEmailManagementSystem().then(r => console.log('Success:', r));
"

# 3. Verify setup
npx ts-node -e "
  import { verifyEmailSystemSetup } from './src/modules/email-management/services/emailSystemInit';
  verifyEmailSystemSetup().then(r => console.log('Verification:', r));
"
```

**Expected output:**
```
✓ Airlines table: 10 active
✓ Templates table: 6 active
✓ Recipients table: 15+ active
```

---

### PHASE 3: Update App Layout (5 minutes)

Open `src/app/layout.tsx` and add email system initialization:

```typescript
import { initializeEmailSystem } from '@/modules/email-management/app-init';

// In your root layout component (RootLayout):
export default async function RootLayout({ 
  children 
}: { 
  children: React.ReactNode 
}) {
  // Initialize email system on app startup
  try {
    await initializeEmailSystem();
  } catch (error) {
    console.error("Failed to initialize email system:", error);
    // App will still work, but email features may be limited
  }

  return (
    <html lang="en">
      <body>
        {/* ... rest of your layout */}
        {children}
      </body>
    </html>
  );
}
```

---

### PHASE 4: Integrate WhatsApp Handler (10 minutes)

**File:** `whatsapp-service/src/messageHandler.ts`

Add this to your incoming message handler:

```typescript
import { 
  handleEmailManagementMessage,
  handleDraftPreviewButton,
  formatCaseForWhatsApp 
} from '@/modules/email-management/integrations/whatsappMessageHandler';

// In your message handler function:
export async function handleIncomingMessage(message: Message) {
  
  // Check if this is an email-related command or image
  if (message.type === 'image' || isEmailCommand(message.text)) {
    
    // Try to handle as email management
    const emailResult = await handleEmailManagementMessage(
      {
        type: message.type,
        text: message.text,
        imageData: message.imageData, // base64 data URL
        imageCaption: message.caption,
        chatId: message.chat.id,
        messageId: message.id,
        timestamp: message.timestamp,
      },
      process.env.EMAIL_API_BASE_URL
    );

    if (emailResult.handled) {
      // Email system handled this message
      if (emailResult.success) {
        // Show success response to user
        await message.reply(emailResult.message || "✓ Email processed");
      } else {
        // Show error to user
        await message.reply(`❌ ${emailResult.error}`);
      }
      return; // Don't process further
    }
  }

  // If not email-related, handle as normal WhatsApp command
  // ... rest of your handler
}

// Helper to identify email commands
function isEmailCommand(text: string): boolean {
  if (!text) return false;
  const cmd = text.toLowerCase();
  return cmd.includes('refund') || 
         cmd.includes('void') || 
         cmd.includes('reschedule') ||
         cmd.includes('send ') ||
         cmd.includes('cancel ') ||
         cmd.includes('status ') ||
         cmd.includes('email update');
}
```

**Handle Button Responses:**

```typescript
// Also in messageHandler.ts - handle interactive button clicks:
export async function handleButtonClick(
  buttonId: string,
  messageData: { caseId: string },
  chatId: string
) {
  const result = await handleDraftPreviewButton(
    buttonId,
    messageData.caseId,
    chatId,
    process.env.EMAIL_API_BASE_URL
  );

  if (result.handled) {
    return result;
  }
}
```

---

### PHASE 5: Test the System (15 minutes)

#### Test 1: API Endpoints Are Ready
```bash
# Check if endpoint is accessible
curl http://localhost:3000/api/email/upload-ticket

# Expected response:
# { "message": "Email ticket upload endpoint is ready", "method": "POST" }
```

#### Test 2: Manual System Initialization
```bash
# Call the admin init endpoint
curl -X POST http://localhost:3000/api/email/admin/init

# Expected response:
# { "success": true, "airlines": 10, "templates": 6, "recipients": 15 }
```

#### Test 3: Full Ticket Processing Flow
```bash
# Create a test image (or use an existing one)
# Convert to base64 and send to endpoint

curl -X POST http://localhost:3000/api/email/upload-ticket \
  -H "Content-Type: application/json" \
  -d '{
    "imageData": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
    "command": "Refund",
    "chatId": "120xx@g.us",
    "messageId": "msg-12345"
  }'

# Expected response:
# { "success": true, "caseId": "case-id-xxx", "draft": {...} }
```

#### Test 4: Send Email
```bash
# Get a caseId from test 3, then:
curl -X POST http://localhost:3000/api/email/send \
  -H "Content-Type: application/json" \
  -d '{ "caseId": "case-id-xxx" }'

# Expected response:
# { "success": true, "messageId": "msg-xxx", "sentAt": "2026-08-18..." }
```

---

### PHASE 6: Configure WhatsApp Commands (10 minutes)

Update your WhatsApp bot command list to handle:

```
/refund - Request refund
/void - Void ticket  
/reschedule - Reschedule flight
/send - Send pending email
/cancel - Cancel case
/status - Check email status
/email-update - Get status update now
```

**User Flow Example:**

1. User sends ticket screenshot with caption "Refund"
   ```
   WhatsApp → messageHandler → handleEmailManagementMessage 
   → POST /api/email/upload-ticket 
   → Create draft → Send preview
   ```

2. User clicks "Send" button on preview
   ```
   Button click → handleDraftPreviewButton 
   → POST /api/email/send 
   → Email sent to airline
   ```

3. Airline replies within 24 hours
   ```
   Reply monitor (every 5 min) → Detects reply 
   → Updates status → Notifies user
   ```

4. 6 PM & 11 PM
   ```
   Scheduled tasks → generateSummaryReport 
   → sendWhatsAppMessage 
   → Send to admin chat
   ```

---

## 🚀 Deployment Steps (For Railway)

### Step 1: Push Code
```bash
git add .
git commit -m "Add email management API routes and WhatsApp integration"
git push origin main
```

### Step 2: Add Environment Variables in Railway

Go to Railway → Your Project → Email Service (main app):

1. Click "Variables"
2. Add all the SMTP and WhatsApp variables from PHASE 1
3. Click "Deploy"

### Step 3: Verify Deployment
```bash
# Check logs in Railway dashboard
# Look for: "[Email System Init] Email management system initialized successfully ✓"

# Test the endpoint
curl https://your-railway-url.up.railway.app/api/email/upload-ticket
```

---

## 📋 Testing Checklist Before Production

- [ ] Environment variables set in Railway
- [ ] Database migrations ran successfully
- [ ] Email system initialized (airlines, templates, recipients)
- [ ] SMTP credentials tested (can send test email)
- [ ] WhatsApp service URL configured
- [ ] Admin WhatsApp chat ID configured
- [ ] API endpoint returns 200 OK
- [ ] Ticket upload creates draft successfully
- [ ] Draft preview sent to WhatsApp
- [ ] Email sends to airline email address
- [ ] Reply monitoring starts (check logs every 5 min)
- [ ] Scheduled reports generate at 6 PM & 11 PM
- [ ] WhatsApp messages format correctly

---

## 🔍 Troubleshooting

### Problem: "SMTP connection failed"
**Solution:**
1. Verify SMTP credentials in environment
2. Check Gmail: Allow less secure apps / App passwords
3. Test with: `npx ts-node -e "import { testSmtpConnection } from './src/modules/email-management/services/emailSendingService'; testSmtpConnection();"`

### Problem: "Email system initialization failed"
**Solution:**
1. Check database is running: `npx prisma db push`
2. Run migrations: `npx prisma migrate deploy`
3. Check logs for specific error

### Problem: "WhatsApp messages not sending"
**Solution:**
1. Verify `WHATSAPP_SERVICE_URL` is correct
2. Check WhatsApp service is running
3. Verify chat ID format ends with `@g.us` (groups) or `@s.whatsapp.net` (direct)

### Problem: "Ticket not being parsed"
**Solution:**
1. Ensure image is clear and contains ticket details
2. Check OCR service is configured (Google Cloud Vision or Tesseract)
3. Review `rawText` in error response to see what was extracted

---

## 📚 File Reference

| File | Purpose | What You Do |
|------|---------|-------------|
| `/api/email/upload-ticket/route.ts` | Process tickets | Nothing - ready to use |
| `/api/email/send/route.ts` | Send emails | Nothing - ready to use |
| `/api/email/edit/route.ts` | Edit drafts | Nothing - ready to use |
| `/api/email/cancel/route.ts` | Cancel cases | Nothing - ready to use |
| `/api/email/cases/[caseId]/route.ts` | Get status | Nothing - ready to use |
| `/api/email/reports/now/route.ts` | Get reports | Nothing - ready to use |
| `whatsappMessageHandler.ts` | WhatsApp routing | Reference to integrate |
| `app-init.ts` | Initialize system | Call from layout.tsx |
| `.env.local` | Configuration | Add all variables |
| `whatsapp-service/messageHandler.ts` | Message processing | Update to call handler |

---

## ✨ After Integration Complete

Once you complete all manual steps:

1. **Users can send ticket screenshots via WhatsApp**
2. **System auto-extracts PNR and passenger names**
3. **Email draft generated with correct template**
4. **User approves with one button tap**
5. **Email sent to correct airline address**
6. **System monitors for replies automatically**
7. **User notified when airline responds**
8. **Daily reports sent at 6 PM and 11 PM**

---

## 🆘 Need Help?

**API Routes Not Working?**
- Check environment variables are set
- Verify database migrations ran
- Check logs: `npx ts-node ... 2>&1 | grep "Email API"`

**WhatsApp Integration Issues?**
- Verify `WHATSAPP_SERVICE_URL` is reachable
- Check message handler is calling `handleEmailManagementMessage`
- Review WhatsApp error responses

**Email Not Sending?**
- Test SMTP: `SMTP_HOST=... SMTP_USER=... npx ts-node -e ...`
- Verify recipient emails are valid
- Check Gmail account allows less secure apps

---

**Status:** ✅ Ready for Manual Integration  
**Estimated Time:** 1-2 hours total  
**Complexity:** Medium (mostly copy-paste + environment setup)  

**Next Step:** Start with PHASE 1 (add environment variables)

---

Created: August 18, 2026  
All API routes complete and tested at code level
