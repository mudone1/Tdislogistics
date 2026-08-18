# 🚀 Quick Integration Checklist

**All API routes and infrastructure are complete.**  
**This is your step-by-step checklist for integration.**

---

## ✅ PHASE 1: Environment Variables (5 minutes)

**File:** `.env.local` or Railway Dashboard Variables

```bash
# Required - Get from Gmail App Passwords
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=16-char-app-password
SMTP_FROM_NAME=TDIS Logistics
SMTP_FROM_EMAIL=your-email@gmail.com

# Required - WhatsApp Integration
WHATSAPP_SERVICE_URL=http://whatsapp-service:4200
ADMIN_WHATSAPP_CHAT_ID=120xx@g.us

# Optional but Recommended
ENABLE_EMAIL_REPORTS=true
ENABLE_EMAIL_MONITORING=true
EMAIL_API_BASE_URL=http://localhost:3000
```

**Checklist:**
- [ ] Created Gmail App Password (myaccount.google.com/apppasswords)
- [ ] Copied 16-char password to SMTP_PASSWORD
- [ ] Set WHATSAPP_SERVICE_URL to correct server
- [ ] Found ADMIN_WHATSAPP_CHAT_ID from admin group
- [ ] Added all vars to .env.local (local dev)
- [ ] Added all vars to Railway dashboard (production)

**Time to complete:** ~5 min

---

## ✅ PHASE 2: Database Initialization (10 minutes)

**Location:** `C:\Users\USER\Desktop\TDIS` (project root)

```bash
# Step 1: Run migrations
npx prisma migrate deploy

# Step 2: Initialize system
npx ts-node -e "
  import { initializeEmailManagementSystem } from './src/modules/email-management/services/emailSystemInit';
  initializeEmailManagementSystem().then(r => console.log('Success:', r));
"

# Step 3: Verify
npx ts-node -e "
  import { verifyEmailSystemSetup } from './src/modules/email-management/services/emailSystemInit';
  verifyEmailSystemSetup().then(r => console.log('Result:', r));
"
```

**Expected Success Output:**
```
✓ Airlines: 10
✓ Templates: 6  
✓ Recipients: 15+
```

**Checklist:**
- [ ] Ran prisma migrate deploy
- [ ] System initialized successfully
- [ ] Verification showed no errors
- [ ] 10 airlines loaded
- [ ] 6 templates loaded

**Time to complete:** ~10 min

---

## ✅ PHASE 3: App Layout Update (5 minutes)

**File:** `src/app/layout.tsx`

**Add these imports at top:**
```typescript
import { initializeEmailSystem } from '@/modules/email-management/app-init';
```

**Add this to RootLayout function (before return):**
```typescript
// Initialize email system on app startup
try {
  await initializeEmailSystem();
} catch (error) {
  console.error("Failed to initialize email system:", error);
}
```

**Checklist:**
- [ ] Opened src/app/layout.tsx
- [ ] Added import statement
- [ ] Added initialization call in RootLayout
- [ ] File saved

**Time to complete:** ~5 min

---

## ✅ PHASE 4: WhatsApp Handler Integration (15 minutes)

**File:** `whatsapp-service/src/messageHandler.ts`

**Add these imports at top:**
```typescript
import { 
  handleEmailManagementMessage,
  handleDraftPreviewButton,
  formatCaseForWhatsApp 
} from '@/modules/email-management/integrations/whatsappMessageHandler';
```

**Add this function (helper):**
```typescript
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

**Update your handleIncomingMessage function:**
```typescript
export async function handleIncomingMessage(message: Message) {
  
  // NEW: Handle email management messages
  if (message.type === 'image' || isEmailCommand(message.text)) {
    const emailResult = await handleEmailManagementMessage(
      {
        type: message.type,
        text: message.text,
        imageData: message.imageData,
        imageCaption: message.caption,
        chatId: message.chat.id,
        messageId: message.id,
        timestamp: message.timestamp,
      },
      process.env.EMAIL_API_BASE_URL
    );

    if (emailResult.handled) {
      if (emailResult.success) {
        await message.reply(emailResult.message || "✓ Email processed");
      } else {
        await message.reply(`❌ ${emailResult.error}`);
      }
      return;
    }
  }

  // Continue with existing message handling...
  // ... rest of your handler code ...
}
```

**Update your button click handler:**
```typescript
export async function handleButtonClick(buttonId: string, messageData: any, chatId: string) {
  const result = await handleDraftPreviewButton(
    buttonId,
    messageData.caseId,
    chatId,
    process.env.EMAIL_API_BASE_URL
  );
  
  if (result.handled) {
    return result;
  }
  
  // ... rest of your handler ...
}
```

**Checklist:**
- [ ] Opened whatsapp-service/src/messageHandler.ts
- [ ] Added imports
- [ ] Added isEmailCommand helper
- [ ] Updated handleIncomingMessage
- [ ] Updated button click handler
- [ ] File saved

**Time to complete:** ~15 min

---

## ✅ PHASE 5: Test & Deploy (30 minutes)

### Local Testing

```bash
# 1. Start your app
npm run dev

# 2. Test upload-ticket endpoint
curl http://localhost:3000/api/email/upload-ticket

# Expected: { "message": "Email ticket upload endpoint is ready", "method": "POST" }

# 3. Test admin init
curl -X POST http://localhost:3000/api/email/admin/init

# Expected: { "success": true, "airlines": 10, "templates": 6, "recipients": 15 }
```

### Deploy to Railway

```bash
# 1. Commit changes
git add .
git commit -m "Add email management API routes and WhatsApp integration"
git push origin main

# 2. Railway auto-deploys
# (Watch logs in Railway dashboard)

# 3. Verify in Railway
# Look for: "[Email System Init] Email management system initialized successfully ✓"
```

**Checklist:**
- [ ] Local testing passed
- [ ] All endpoints return success
- [ ] Code pushed to GitHub
- [ ] Railway deployment triggered
- [ ] Deployment logs show success
- [ ] Production endpoints working

**Time to complete:** ~30 min

---

## ✅ PHASE 6: Smoke Testing (15 minutes)

**Test 1: Upload Ticket**
- [ ] Send ticket screenshot via WhatsApp with "Refund"
- [ ] Draft appears
- [ ] Shows correct PNR and passengers
- [ ] Draft preview sent to WhatsApp

**Test 2: Send Email**
- [ ] Click "Send" button on draft
- [ ] Email sent to airline
- [ ] Confirmation received in WhatsApp
- [ ] Check airline inbox (test email visible)

**Test 3: Case Status**
- [ ] Send "Status CASE-ID" command
- [ ] Get case details back
- [ ] Shows correct status

**Test 4: Reports**
- [ ] Send "Email Update Now" command
- [ ] Get current status report
- [ ] Shows metrics and cases

**Test 5: Scheduled Reports**
- [ ] Wait until 6 PM (or manually trigger)
- [ ] Summary report sent to admin chat
- [ ] Wait until 11 PM
- [ ] Detailed EOD report sent

**Checklist:**
- [ ] Ticket uploaded successfully
- [ ] Draft generated correctly
- [ ] Email sent to airline
- [ ] Status queries working
- [ ] Manual reports working
- [ ] Scheduled reports running

**Time to complete:** ~15-30 min (depends on testing depth)

---

## 📊 Total Time Estimate

| Phase | Task | Time |
|-------|------|------|
| 1 | Environment variables | 5 min |
| 2 | Database init | 10 min |
| 3 | App layout update | 5 min |
| 4 | WhatsApp handler | 15 min |
| 5 | Test & deploy | 30 min |
| 6 | Smoke testing | 15-30 min |
| **TOTAL** | **All integration** | **1.5-2 hours** |

---

## 🚨 If Something Breaks

### "SMTP connection failed"
```bash
# Verify credentials
echo "SMTP_HOST=$SMTP_HOST"
echo "SMTP_USER=$SMTP_USER"
echo "SMTP_PASSWORD=${SMTP_PASSWORD:0:4}***"

# Check Gmail allows app passwords
# Go to: https://myaccount.google.com/apppasswords
```

### "Database error"
```bash
# Run migrations again
npx prisma migrate deploy

# Reset database (dev only!)
npx prisma db push --force-reset
```

### "WhatsApp messages not sending"
```bash
# Check service URL is correct
echo "WHATSAPP_SERVICE_URL=$WHATSAPP_SERVICE_URL"

# Verify service is running
curl $WHATSAPP_SERVICE_URL/health
```

### "Email not being parsed"
```bash
# Verify OCR is working
# Check image is clear and readable
# Review error message in API response
```

---

## 📞 When You Get Stuck

1. **Check logs:**
   ```bash
   # Local: npm run dev (watch console)
   # Railway: Dashboard → Logs tab
   ```

2. **Check configuration:**
   ```bash
   # Local: cat .env.local | grep EMAIL
   # Railway: Variables tab
   ```

3. **Test endpoints directly:**
   ```bash
   curl -X GET http://localhost:3000/api/email/upload-ticket
   curl -X GET http://localhost:3000/api/email/admin/init
   ```

4. **Reference documentation:**
   - API Spec: [EMAIL_MANAGEMENT_SYSTEM_SPEC.md](EMAIL_MANAGEMENT_SYSTEM_SPEC.md)
   - Implementation: [EMAIL_MANAGEMENT_IMPLEMENTATION_SUMMARY.md](EMAIL_MANAGEMENT_IMPLEMENTATION_SUMMARY.md)
   - Full Guide: [INTEGRATION_GUIDE_MANUAL_STEPS.md](INTEGRATION_GUIDE_MANUAL_STEPS.md)

---

## ✨ You're Done When...

- ✅ All environment variables set
- ✅ Database migrations complete
- ✅ App initializes without errors
- ✅ WhatsApp handler updated
- ✅ API endpoints responding
- ✅ Ticket uploads working
- ✅ Emails sending to airlines
- ✅ Reports generating
- ✅ System deployed to Railway

---

**Status:** Ready for Integration  
**Complexity:** Medium (mostly configuration)  
**Support:** See documentation files above

**Start now with PHASE 1 →**
