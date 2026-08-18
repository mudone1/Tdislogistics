# Airline Email Management System - Technical Specification

**Date:** 2026-08-18  
**Status:** IMPLEMENTATION PHASE  
**Version:** 1.0

---

## 1. System Overview

The Airline Email Management System automates the entire workflow of preparing, approving, sending, tracking, and reporting airline-related emails (refunds, voids, reschedules). The system integrates with:

- **WhatsApp Service**: Receives ticket screenshots and commands from users
- **Next.js Web Application**: Admin interface for configuration and reporting
- **Prisma ORM**: Database for tracking emails, airlines, templates
- **Email Service**: Sends emails via SMTP (configured business account)

---

## 2. Architecture

### 2.1 System Components

```
┌─────────────────────────────────────────────────────────┐
│           WhatsApp Service (Listener)                   │
│  - Receives ticket screenshots                          │
│  - Parses natural language commands                     │
│  - Extracts ticket information                          │
└────────────┬────────────────────────────────────────────┘
             │
             ├─→ Ticket Parser Module (OCR)
             │   - Extract: Airline, PNR, Passenger Names
             │   - Detect: Request Type (Refund/Void/Reschedule)
             │   - Parse: Travel details
             │
             └─→ Email Service Module
                 - Generate email draft from template
                 - Determine airline recipients
                 - Send to WhatsApp for approval
                 │
                 ├─→ Email Tracking System (Prisma)
                 │   - Store: Draft, Sent, Awaiting Response
                 │   - Update: Status on airline replies
                 │
                 ├─→ Email Reply Monitor
                 │   - Listen for airline responses
                 │   - Match replies to PNR
                 │   - Notify user via WhatsApp
                 │
                 └─→ Scheduled Reports
                     - 6:00 PM: Daily summary
                     - 11:00 PM: End-of-day detailed
                     - On-demand: "Email Update Now"
```

### 2.2 Key Workflows

#### Workflow 1: Screenshot → Draft Email
```
User sends ticket screenshot + command
    ↓
Ticket Parser extracts: Airline, PNR, Passengers, Route, Date, Time
    ↓
Natural Language Parser identifies: Request Type (Refund/Void/Reschedule)
    ↓
Email Template Generator creates draft
    ↓
Airline Recipient Resolver determines: To, CC
    ↓
Email Tracking creates "Draft" status record
    ↓
WhatsApp displays: Preview with [1] Send, [2] Edit, [3] Cancel, [4] Save Draft
```

#### Workflow 2: Approval & Sending
```
User replies: "1" (Send Email)
    ↓
Verify recipients from airline directory
    ↓
Send via SMTP using business email account
    ↓
Email Tracking updates: Status = "Sent", Date Sent = now
    ↓
WhatsApp notification: "Email sent successfully" with details
```

#### Workflow 3: Reply Monitoring
```
Email Reply Monitor checks business email inbox (polling/webhook)
    ↓
Extract PNR and airline from email
    ↓
Match to Email Tracking record
    ↓
Auto-update status: "Refund Approved" / "Additional Info Required" / etc.
    ↓
WhatsApp notification: "[Airline] has responded: [Brief Summary]"
```

---

## 3. Database Schema (Prisma)

### 3.1 Core Tables

```prisma
// Airline Master Data
model Airline {
  id              String    @id @default(cuid())
  code            String    @unique  // IBOM AIR, AIR PEACE, etc
  name            String
  isActive        Boolean   @default(true)
  notes           String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  
  recipients      AirlineRecipient[]
  emailCases      EmailCase[]
}

// Airline Recipients (To, CC)
model AirlineRecipient {
  id              String    @id @default(cuid())
  airlineId       String
  airline         Airline   @relation(fields: [airlineId], references: [id])
  email           String
  recipientType   String    // "TO", "CC"
  isPrimary       Boolean   @default(false)
  isActive        Boolean   @default(true)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  
  @@unique([airlineId, email])
}

// Email Templates
model EmailTemplate {
  id              String    @id @default(cuid())
  name            String    @unique  // "REFUND", "VOID", "RESCHEDULE", etc
  subject         String
  bodyTemplate    String    // Template with {VARIABLE} placeholders
  requestType     String    // REFUND, VOID, RESCHEDULE, OPEN, RESCHEDULE_DISRUPTION, REFUND_DISRUPTION
  isActive        Boolean   @default(true)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  
  emailCases      EmailCase[]
}

// Email Cases (Main tracking record)
model EmailCase {
  id              String    @id @default(cuid())
  caseNumber      String    @unique  // AUTO-GENERATED: CASE-2026-08-18-001
  
  // Ticket Information
  airline         Airline   @relation(fields: [airlineId], references: [id])
  airlineId       String
  pnr             String
  passengerNames  String[]  // Array of names
  requestType     String    // REFUND, VOID, RESCHEDULE, OPEN
  
  // Travel Details (for reschedule)
  route           String?   // LOS-ABV
  newTravelDate   DateTime?
  departureTime   String?   // HH:MM format
  
  // Email Details
  template        EmailTemplate @relation(fields: [templateId], references: [id])
  templateId      String
  subject         String
  emailBody       String    // Final rendered body
  toRecipient     String
  ccRecipients    String[]  // Array of CC emails
  
  // Status Tracking
  status          String    @default("DRAFT")  
  // DRAFT → AWAITING_APPROVAL → SENT → AWAITING_AIRLINE_RESPONSE → COMPLETED/REJECTED
  
  // Timestamps
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  dateApproved    DateTime?
  dateSent        DateTime?
  dateLastResponse DateTime?
  
  // WhatsApp Context
  whatsappChatId  String?   // For responding to user
  whatsappMessageId String?
  
  // Audit
  createdByUser   String?   // User ID
  approvedByUser  String?
  
  // Relations
  replies         EmailReply[]
  auditTrail      AuditLog[]
}

// Email Replies (Airline responses)
model EmailReply {
  id              String    @id @default(cuid())
  emailCase       EmailCase @relation(fields: [emailCaseId], references: [id])
  emailCaseId     String
  
  fromEmail       String    // Airline sender
  subject         String
  body            String
  replyDate       DateTime
  statusUpdate    String?   // "REFUND_APPROVED", "MORE_INFO_NEEDED", etc
  
  createdAt       DateTime  @default(now())
  
  @@index([emailCaseId])
}

// Audit Trail
model AuditLog {
  id              String    @id @default(cuid())
  emailCase       EmailCase @relation(fields: [emailCaseId], references: [id])
  emailCaseId     String
  
  action          String    // "DRAFT_CREATED", "APPROVED", "SENT", "REPLY_RECEIVED"
  details         String?   // JSON with details
  userId          String?
  timestamp       DateTime  @default(now())
  
  @@index([emailCaseId])
}

// Daily Reports
model DailyReport {
  id              String    @id @default(cuid())
  reportDate      DateTime  // Date of report
  reportType      String    // "MORNING" (6 PM) or "EOD" (11 PM)
  
  emailsSent      Int
  repliesReceived Int
  pendingCases    Int
  approvedRefunds Int
  completedVoids  Int
  completedReschedules Int
  needsMoreInfo   Int
  
  casesSummary    String    // JSON array of case summaries
  
  createdAt       DateTime  @default(now())
}
```

---

## 4. Module Structure

### 4.1 Directory Layout

```
src/modules/
├── email-management/
│   ├── services/
│   │   ├── ticketParser.ts          // OCR & ticket extraction
│   │   ├── emailTemplateService.ts  // Template rendering
│   │   ├── emailSendingService.ts   // SMTP integration
│   │   ├── emailTrackingService.ts  // Case management
│   │   ├── replyMonitorService.ts   // Email reply listener
│   │   └── reportService.ts         // Daily report generation
│   ├── utils/
│   │   ├── airlineResolver.ts       // Determine airline from text/image
│   │   ├── nlpParser.ts             // Natural language parsing
│   │   ├── emailValidator.ts        // Validate email addresses
│   │   └── caseNumberGenerator.ts   // Generate CASE-XXXX numbers
│   ├── types/
│   │   └── email.types.ts           // TypeScript interfaces
│   └── api/
│       ├── tickets/route.ts         // Upload & process screenshot
│       ├── drafts/route.ts          // Get draft preview
│       ├── send/route.ts            // Approve & send email
│       ├── cases/route.ts           // Get case status
│       └── reports/route.ts         // Generate reports
│
├── email-admin/
│   ├── components/
│   │   ├── AirlineConfig/
│   │   ├── TemplateEditor/
│   │   ├── CaseTracker/
│   │   └── ReportViewer/
│   └── api/
│       ├── airlines/route.ts
│       ├── templates/route.ts
│       ├── audit/route.ts
│       └── settings/route.ts
```

---

## 5. Request Types & Email Templates

### 5.1 Request Types

| Type | Subject | Greeting |
|------|---------|----------|
| OPEN | URGENT REQUEST TO OPEN A TICKET | Dear Trade Partners |
| REFUND | URGENT REQUEST TO REFUND A TICKET | Dear Trade Partners |
| VOID | URGENT REQUEST TO VOID A TICKET | Dear Valued Partner |
| RESCHEDULE | URGENT REQUEST TO RESCHEDULE A TICKET | Dear Trade Partner |
| REFUND_DISRUPTION | URGENT REQUEST TO REFUND A TICKET DUE TO DISRUPTION | Dear Trade Partners |
| RESCHEDULE_DISRUPTION | URGENT REQUEST TO RESCHEDULE A TICKET DUE TO DISRUPTION | Dear Trade Partner |

### 5.2 Natural Language Patterns

```typescript
const patterns = {
  REFUND: /^(refund|refund this ticket)$/i,
  REFUND_DISRUPTION: /^refund.*due to disruption$/i,
  VOID: /^(void|void this ticket)$/i,
  RESCHEDULE: /^(reschedule|reschedule this ticket)$/i,
  RESCHEDULE_DISRUPTION: /^reschedule.*due to disruption$/i,
  OPEN: /^(open|open this ticket)$/i,
};

const reschedulePattern = /reschedule.*to\s+(\d{1,2}\/\d{1,2}\/\d{4})?.*?(\w{3})[\s\-]?(\w{3})?.*?(\d{1,2}:\d{2}\s*[AP]M)?/i;
// Captures: date, from, to, time
```

---

## 6. External Integrations

### 6.1 Email Service (SMTP)

```typescript
// env.local
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=business@example.com
SMTP_PASSWORD=xxxxxxxxxxxxx
SMTP_FROM_NAME="TDIS Logistics"
SMTP_FROM_EMAIL=business@example.com
```

### 6.2 WhatsApp Service

```typescript
// Communication between email service and WhatsApp service
POST /whatsapp-service/send-message
{
  chatId: "xxx@s.whatsapp.net",
  messageType: "text" | "image" | "document",
  content: string,
  interactive: {
    buttons: [
      { id: "1", title: "Send Email" },
      { id: "2", title: "Edit" },
      { id: "3", title: "Cancel" },
      { id: "4", title: "Save Draft" }
    ]
  }
}
```

---

## 7. Status Lifecycle

```
DRAFT
  ↓
[User reviews, can EDIT or CANCEL]
  ↓
APPROVED (when user clicks "Send")
  ↓
SENT (successfully sent to airline)
  ↓
AWAITING_AIRLINE_RESPONSE
  ↓
[Reply received, status auto-updates]
  ↓
REFUND_APPROVED / VOID_COMPLETED / RESCHEDULE_COMPLETED / ADDITIONAL_INFO_REQUESTED / REJECTED / CLOSED
```

---

## 8. Key Features Breakdown

### 8.1 Phase 1: Core Email Workflow
- [x] Database schema
- [ ] Ticket screenshot parser
- [ ] Email template system
- [ ] Airline recipient directory
- [ ] Draft generation & preview
- [ ] Email sending via SMTP
- [ ] Email case tracking

### 8.2 Phase 2: Monitoring & Notifications
- [ ] Email reply monitoring
- [ ] WhatsApp notifications on airline response
- [ ] Status auto-update
- [ ] Case status queries

### 8.3 Phase 3: Reporting
- [ ] Daily 6 PM report (summary)
- [ ] Daily 11 PM report (detailed)
- [ ] On-demand "Email Update Now" command
- [ ] Report history

### 8.4 Phase 4: Administration
- [ ] Airline configuration UI
- [ ] Template editor
- [ ] Audit trail viewer
- [ ] Email settings management

---

## 9. Security & Compliance

- **Email Approval**: Never send without explicit user approval
- **Audit Trail**: Every action logged with timestamp and user
- **Credentials**: Use environment variables for SMTP
- **PII Protection**: Sensitive data encrypted in transit and at rest
- **Rate Limiting**: Prevent email flood attacks
- **Access Control**: Admin-only access to configuration

---

## 10. Testing Strategy

- Unit tests for parsers and template rendering
- Integration tests for email sending workflow
- End-to-end tests for complete screenshot → email flow
- WhatsApp command parsing tests
- Email reply matching tests

---

## 11. Deployment

- Deploy updated Prisma schema to production database
- Configure SMTP credentials in Railway environment variables
- Set up email monitoring (cron job or webhook)
- Configure scheduled reports (node-cron)
- Deploy to Railway and verify WhatsApp integration

---

**Next Steps:**
1. ✅ Technical Specification (THIS DOCUMENT)
2. Create Prisma schema and run migrations
3. Build Ticket Parser module
4. Build Email Template Service
5. Build Email Sending Service
6. Integrate with WhatsApp service
7. Build Admin Dashboard
8. Deploy and test
