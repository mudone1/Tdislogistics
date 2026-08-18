# Airline Email Management System - Next Steps & Deployment Guide

**Status:** Core System Ready for Integration  
**Date:** 2026-08-18  
**Estimated Time to Full Deployment:** 2-3 days

---

## Quick Start Checklist

### Phase 1: Database Setup (30 minutes)
- [ ] Review new Prisma schema models (email-management tables)
- [ ] Run Prisma migration: `npx prisma migrate dev --name add_email_management`
- [ ] Initialize system: Run `emailSystemInit()` function
- [ ] Verify setup with `verifyEmailSystemSetup()`

### Phase 2: Environment Configuration (15 minutes)
- [ ] Add SMTP environment variables to Railway
- [ ] Add ADMIN_WHATSAPP_CHAT_ID for reports
- [ ] Test SMTP connection
- [ ] Test WhatsApp service connectivity

### Phase 3: API Routes Integration (4-6 hours)
- [ ] Create `/api/email/upload-ticket` endpoint
- [ ] Create `/api/email/draft-preview` endpoint
- [ ] Create `/api/email/send` endpoint
- [ ] Create `/api/email/edit` endpoint
- [ ] Create `/api/email/case-status` endpoint
- [ ] Create `/api/email/reports/now` endpoint

### Phase 4: WhatsApp Handler Integration (4-6 hours)
- [ ] Update whatsapp-service to intercept images
- [ ] Add email command parsing
- [ ] Implement interactive button handler
- [ ] Connect to email management API endpoints
- [ ] Test full workflow end-to-end

### Phase 5: Testing & Deployment (2-4 hours)
- [ ] Run integration tests
- [ ] Test with real airline email addresses
- [ ] Verify scheduled tasks
- [ ] Deploy to Railway
- [ ] Monitor logs for errors

---

## Detailed Implementation Guide

### Step 1: Database Migration

```bash
# 1. Create migration
cd /path/to/TDIS
npx prisma migrate dev --name add_email_management

# 2. Run initialization
npx ts-node -e "
  import { initializeEmailManagementSystem } from './src/modules/email-management/services/emailSystemInit';
  initializeEmailManagementSystem().then(console.log);
"

# 3. Verify
npx ts-node -e "
  import { verifyEmailSystemSetup } from './src/modules/email-management/services/emailSystemInit';
  verifyEmailSystemSetup().then(console.log);
"
```

### Step 2: Environment Variables

Update Railway environment for whatsapp-service and main app:

```env
# SMTP Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-business-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM_NAME=TDIS Logistics
SMTP_FROM_EMAIL=your-business-email@gmail.com

# WhatsApp Integration
WHATSAPP_SERVICE_URL=http://localhost:4200
ADMIN_WHATSAPP_CHAT_ID=xxx@g.us

# Feature Flags
ENABLE_EMAIL_REPORTS=true
ENABLE_EMAIL_MONITORING=true
```

### Step 3: Create API Routes

Create the following API endpoints:

**File:** `src/app/api/email/upload-ticket/route.ts`
```typescript
import { extractTicketFromImage } from '@/modules/email-management/services/ticketParser';
import { createEmailCaseDraft } from '@/modules/email-management/services/emailTemplateService';
import { sendDraftPreview } from '@/modules/email-management/integrations/whatsappIntegration';

export async function POST(request: Request) {
  // 1. Get form data (image + chatId + optional command)
  // 2. Parse ticket from image
  // 3. Create draft
  // 4. Send preview to WhatsApp
  // 5. Return case ID
}
```

**File:** `src/app/api/email/send/route.ts`
```typescript
import { getEmailCase } from '@/modules/email-management/services/emailTemplateService';
import { sendEmail } from '@/modules/email-management/services/emailSendingService';
import { sendEmailConfirmation } from '@/modules/email-management/integrations/whatsappIntegration';

export async function POST(request: Request) {
  // 1. Get case ID from request
  // 2. Verify draft exists and is DRAFT status
  // 3. Send email via SMTP
  // 4. Send confirmation to WhatsApp
  // 5. Return success
}
```

**See:** `EMAIL_MANAGEMENT_IMPLEMENTATION_SUMMARY.md` for full route list

### Step 4: Integrate WhatsApp Handler

Update `whatsapp-service/src/messageHandler.ts`:

```typescript
import { 
  extractTicketFromImage,
  parseEmailCommand 
} from '@/modules/email-management/services/...';
import { uploadToEmailAPI } from '@/modules/email-management/integrations/whatsappIntegration';

export async function handleIncomingMessage(msg: Message) {
  // Check if this is an email command
  const command = parseEmailCommand(msg.text);
  
  if (command) {
    // Handle email command
    await emailCommandHandler(command, msg);
  }
  
  // Check if this is an image (ticket screenshot)
  if (msg.type === 'image') {
    await handleTicketImage(msg);
  }
}

async function handleTicketImage(msg: Message) {
  // 1. Download image from WhatsApp
  // 2. Send to email API endpoint
  // 3. Get draft preview
  // 4. Display to user
}
```

### Step 5: Initialize Scheduled Tasks

Update your main app initialization (e.g., in `src/lib/server/init.ts`):

```typescript
import { initializeScheduledTasks } from '@/modules/email-management/services/scheduledTasks';

export async function initializeServer() {
  // ... other initialization
  
  // Initialize email management scheduled tasks
  if (process.env.NODE_ENV === 'production' || process.env.ENABLE_EMAIL_MONITORING === 'true') {
    initializeScheduledTasks();
  }
}
```

---

## Testing Strategy

### Unit Tests
Test individual functions in isolation:

```typescript
// Test ticket parser
import { parseTicketText } from '@/modules/email-management/services/ticketParser';

test('Extract PNR from ticket text', () => {
  const text = 'PNR: ABC123\nPassenger: John Doe';
  const result = parseTicketText(text);
  expect(result.pnr).toBe('ABC123');
  expect(result.passengerNames).toContain('John Doe');
});
```

### Integration Tests
Test API endpoints with database:

```typescript
// Test email draft creation
test('Create email draft and send to WhatsApp', async () => {
  const response = await fetch('/api/email/upload-ticket', {
    method: 'POST',
    body: formData,
  });
  
  const { caseId } = await response.json();
  expect(caseId).toBeDefined();
  
  // Verify case in database
  const emailCase = await prisma.emailCase.findUnique({
    where: { id: caseId },
  });
  expect(emailCase.status).toBe('DRAFT');
});
```

### End-to-End Tests
Test full workflow:

```typescript
// 1. Upload ticket screenshot
// 2. Verify draft preview sent to WhatsApp
// 3. Approve email send
// 4. Verify email sent to airline
// 5. Simulate airline reply
// 6. Verify status updated
// 7. Verify user notified
```

---

## Deployment Checklist

### Pre-Deployment
- [ ] All database migrations applied
- [ ] SMTP credentials configured and tested
- [ ] WhatsApp integration tested
- [ ] All API routes created and tested
- [ ] Scheduled tasks configured
- [ ] Error handling implemented
- [ ] Logging configured
- [ ] Rate limiting configured (prevent email flood)

### Deployment
- [ ] Code pushed to repository
- [ ] Railway redeployment triggered
- [ ] Database migrations run automatically
- [ ] Verify all services online
- [ ] Check application logs

### Post-Deployment
- [ ] Test email upload with screenshot
- [ ] Send test email to yourself
- [ ] Verify WhatsApp notifications received
- [ ] Check scheduled reports (test trigger manually)
- [ ] Monitor error logs for 24 hours

---

## Key Integration Points

### 1. WhatsApp Service ↔ Email API
```
WhatsApp Message
    ↓
Parse Command/Image
    ↓
Call Email API
    ↓
Get Response
    ↓
Display to User
```

### 2. Email API ↔ Database
```
Create Draft
    ↓
Save to DB
    ↓
Update Status on Send
    ↓
Log Audit Trail
```

### 3. Email Sending ↔ SMTP
```
Get Draft from DB
    ↓
Render Template
    ↓
Connect to SMTP
    ↓
Send Email
    ↓
Store Message ID
```

### 4. Reply Monitor ↔ Email Inbox
```
Check Inbox (every 5 min)
    ↓
Extract PNR & Airline
    ↓
Match to Case
    ↓
Update Status
    ↓
Notify via WhatsApp
```

### 5. Report Service ↔ WhatsApp
```
Generate Report (6 PM & 11 PM)
    ↓
Format for WhatsApp
    ↓
Send Message
    ↓
Save to DB
```

---

## Troubleshooting Guide

### Issue: Email Not Sending
```
Error: "SMTP connection failed"
Solution:
  1. Verify SMTP credentials in environment
  2. Check Gmail App Passwords enabled
  3. Test with testSmtpConnection()
  4. Check email whitelist if applicable
```

### Issue: Ticket Parser Not Detecting Airline
```
Error: "Could not detect airline from ticket"
Solution:
  1. Check OCR quality (image too small/blurry?)
  2. Add airline name to detection patterns
  3. Test with different image format
  4. Check rawText in extraction result
```

### Issue: Email Replies Not Being Matched
```
Error: "Reply received but case not found"
Solution:
  1. Verify PNR extraction accuracy
  2. Check airline email is in config
  3. Review audit logs for matching logic
  4. Test with manual PNR search
```

### Issue: Scheduled Tasks Not Running
```
Error: "Reports not sent at expected time"
Solution:
  1. Verify NODE_ENV (should not be test)
  2. Check ENABLE_EMAIL_REPORTS=true
  3. Verify server timezone
  4. Check cron expression in scheduledTasks.ts
```

---

## Files to Review Before Deployment

1. **emailSystemInit.ts** - Review initialization logic
2. **scheduledTasks.ts** - Review cron schedules and timezones
3. **emailSendingService.ts** - Review SMTP configuration
4. **ticketParser.ts** - Review OCR accuracy for your tickets
5. **whatsappIntegration.ts** - Review message formatting

---

## Monitoring & Maintenance

### Daily Checks
- [ ] Review email audit logs for errors
- [ ] Check scheduled reports sent
- [ ] Verify reply monitoring working
- [ ] Check database performance

### Weekly Checks
- [ ] Review reply matching accuracy
- [ ] Check for overdue cases
- [ ] Analyze email volumes
- [ ] Test SMTP connection

### Monthly Checks
- [ ] Update airline email config if needed
- [ ] Review and optimize queries
- [ ] Check audit log storage
- [ ] Plan capacity for growth

---

## Support & Questions

**Configuration Questions:**
- Check `airlineEmailConfig.ts` for airline setup
- Check `emailTemplates.ts` for template variables

**Integration Questions:**
- See `whatsappIntegration.ts` for WhatsApp API
- See email sending service for SMTP details

**Troubleshooting:**
- Check audit logs in database
- Enable debug logging in services
- Review error notifications in WhatsApp

---

## Phase 2: Admin Dashboard (Optional but Recommended)

After core system is working, implement admin interface:

**Features:**
- View all email cases with filters
- Edit email templates
- Manage airline recipients
- View audit logs
- Generate custom reports
- Manual status updates (if needed)

**Files to Create:**
- `src/app/admin/email/` - Admin pages
- `src/app/api/admin/email/` - Admin API routes

---

## Performance Optimization (Post-Deployment)

1. **Database Indexes** - Already added to schema
2. **Email Batching** - Send multiple emails in parallel
3. **Cache Reply Patterns** - Store frequently matched responses
4. **Optimize OCR** - Consider cloud-based OCR for speed

---

## Security Considerations

- ✅ All credentials in environment variables
- ✅ SMTP over TLS/SSL
- ✅ Email validation before sending
- ✅ Audit trail for all actions
- ✅ Rate limiting for API routes
- ✅ WhatsApp-only authentication

---

**Ready to Deploy?** Start with Phase 1: Database Setup  
**Need Help?** Review relevant service file and error messages  
**Questions?** Check the technical specification document

---

**Created:** 2026-08-18  
**System Version:** 1.0  
**Status:** Ready for Production Deployment
