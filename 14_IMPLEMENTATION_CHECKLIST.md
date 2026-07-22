# TDIS Booking Bot Implementation Checklist

## 📋 Pre-Implementation

- [ ] Review `INVESTIGATION_REPORT_REVISED.md` 
- [ ] Understand all phases (0-7)
- [ ] Confirm all clarifications are incorporated
- [ ] Set up `CREDENTIAL_ENCRYPTION_KEY` in `.env`

---

## Phase 0: Fix Authentication Step (CRITICAL)

**Status**: 🔴 MUST DO FIRST

### Files to Copy/Update

1. **Replace** `src/modules/travel-assistant/booking/enugu/EnuguBookOnHold.ts`
   - File: `02_EnuguBookOnHold.ts`
   - **Key change**: Added password confirmation step after "Book Now, Pay Later"
   - **Why**: This was the missing step causing invalid PNRs

### Testing Phase 0

```bash
# Test with your staging Enugu Air account
curl -X POST http://localhost:4100/internal/travel-assistant/book-hold \
  -H "x-internal-api-key: your-key" \
  -H "Content-Type: application/json" \
  -d '{
    "jobId": "test-job-id",
    "airline": "ENUGU",
    "origin": "LOS",
    "destination": "ABV",
    "departureDate": "2026-08-15",
    "passenger": {
      "title": "Mr",
      "firstName": "Test",
      "lastName": "User",
      "email": "test@example.com",
      "mobileNumber": "08012345678"
    }
  }'
```

### Phase 0 Git Commit

```bash
cd your-tdis-repo

# Copy the file
cp ../02_EnuguBookOnHold.ts src/modules/travel-assistant/booking/enugu/EnuguBookOnHold.ts

# Commit
git add src/modules/travel-assistant/booking/enugu/EnuguBookOnHold.ts
git commit -m "Phase 0: Fix authentication step - add password confirmation in Book on Hold workflow

- Added wait for password confirmation prompt after 'Book Now, Pay Later'
- Fixes issue where PNRs were invalid (not registered in airline system)
- Ensures booking is confirmed by airline before marking success
- This was the root cause of earlier invalid PNRs"

git push origin main
```

---

## Phase 1: Database Schema & Credentials Service

**Status**: 🔴 HIGH PRIORITY

### Files to Create/Update

1. **Update** `prisma/schema.prisma`
   - File: `01_schema.prisma`
   - **Changes**: Added 3 new tables (UserAirlineCredential, UserBooking, PnrVerification)

2. **Create** `src/modules/airline-connectors/services/UserCredentialService.ts`
   - File: `03_UserCredentialService.ts`
   - **Purpose**: Encrypt/decrypt user credentials

### Installation Steps

```bash
cd your-tdis-repo

# 1. Backup current schema
cp prisma/schema.prisma prisma/schema.prisma.backup

# 2. Copy new schema
cp ../01_schema.prisma prisma/schema.prisma

# 3. Copy credential service
mkdir -p src/modules/airline-connectors/services
cp ../03_UserCredentialService.ts src/modules/airline-connectors/services/

# 4. Generate Prisma client
npm run prisma generate

# 5. Create migration (choose name when prompted)
npm run db:migrate
# When prompted: "add_user_credentials_and_booking_history"

# 6. Verify in Prisma Studio
npm run db:studio
# Check for: user_airline_credentials, user_bookings, pnr_verifications tables
```

### Phase 1 Git Commit

```bash
git add prisma/schema.prisma
git add src/modules/airline-connectors/services/UserCredentialService.ts
git add prisma/migrations/

git commit -m "Phase 1: Add user credential storage and booking history

- Added UserAirlineCredential table for per-user encrypted credentials
- Added UserBooking table for tracking user's booking history
- Added PnrVerification table for audit trail
- Added UserCredentialService for secure encryption/decryption
- All credentials encrypted with AES-256-GCM
- Credentials never logged or exposed in responses"

git push origin main
```

---

## Phase 2: PNR Verification Service

**Status**: 🔴 HIGH PRIORITY

### Files to Create

1. **Create** `src/modules/travel-assistant/verification/VerifyPnr.ts`
   - File: `04_VerifyPnr.ts`
   - **Purpose**: Verify PNRs exist in Enugu Air system before reporting success

### Installation Steps

```bash
cd your-tdis-repo

# Create directory
mkdir -p src/modules/travel-assistant/verification

# Copy file
cp ../04_VerifyPnr.ts src/modules/travel-assistant/verification/
```

### Phase 2 Git Commit

```bash
git add src/modules/travel-assistant/verification/VerifyPnr.ts

git commit -m "Phase 2: Add PNR verification against airline system

- Verifies PNR exists in Enugu Air's Manage My Booking
- Prevents fake/incomplete bookings from being reported as successful
- Checks passenger name match
- Logs verification attempts for audit trail
- Run before marking booking as SUCCESS"

git push origin main
```

---

## Phase 3: Issue Ticket Automation

**Status**: 🔴 HIGH PRIORITY

### Files to Create

1. **Create** `src/modules/travel-assistant/booking/enugu/EnuguIssueTicket.ts`
   - File: `05_EnuguIssueTicket.ts`
   - **Purpose**: Complete payment for saved booking

### Installation Steps

```bash
cd your-tdis-repo

mkdir -p src/modules/travel-assistant/booking/enugu
cp ../05_EnuguIssueTicket.ts src/modules/travel-assistant/booking/enugu/
```

### Phase 3 Git Commit

```bash
git add src/modules/travel-assistant/booking/enugu/EnuguIssueTicket.ts

git commit -m "Phase 3: Implement ticket issuance with payment

- Separates booking from payment/issuance
- Login with user's credentials to find saved PNR
- Verify booking still exists and hasn't expired
- Click Pay Now and complete payment
- Return genuine payment confirmation screenshot
- Handles expired bookings gracefully (no auto-rebook)"

git push origin main
```

---

## Phase 4: API Routes - Save & Issue

**Status**: 🟡 MEDIUM PRIORITY

### Files to Create

1. **Create** `src/app/api/assistant/book-hold/[id]/save/route.ts`
   - File: `06_api_book_hold_save.ts`

2. **Create** `src/app/api/assistant/book-hold/[id]/issue/route.ts`
   - File: `07_api_book_hold_issue.ts`

### Installation Steps

```bash
cd your-tdis-repo

mkdir -p src/app/api/assistant/book-hold/\[id\]/save
mkdir -p src/app/api/assistant/book-hold/\[id\]/issue

cp ../06_api_book_hold_save.ts src/app/api/assistant/book-hold/\[id\]/save/route.ts
cp ../07_api_book_hold_issue.ts src/app/api/assistant/book-hold/\[id\]/issue/route.ts
```

### Phase 4 Git Commit

```bash
git add src/app/api/assistant/book-hold/

git commit -m "Phase 4: Add Save PNR and Issue Now button workflows

- POST /api/assistant/book-hold/{id}/save - Save booking for later
- POST /api/assistant/book-hold/{id}/issue - Start payment process
- Save: Stores booking without payment, no automation
- Issue: Retrieves user credentials, sends to connector-service
- Both return job ID for polling"

git push origin main
```

---

## Phase 5: Rebooking Automation

**Status**: 🟡 MEDIUM PRIORITY

### Files to Create

1. **Create** `src/modules/travel-assistant/booking/enugu/EnuguRebook.ts`
   - File: `08_EnuguRebook.ts`

### Installation Steps

```bash
cd your-tdis-repo

cp ../08_EnuguRebook.ts src/modules/travel-assistant/booking/enugu/
```

### Phase 5 Git Commit

```bash
git add src/modules/travel-assistant/booking/enugu/EnuguRebook.ts

git commit -m "Phase 5: Implement rebooking with smart class fallback

- Reuse saved booking details (passenger, contact, itinerary)
- Allow user to change dates/route
- Try original fare class first
- Fall back to immediate next class ONLY (no class-skipping)
- Fail gracefully if no seats available
- Return new PNR after successful rebook"

git push origin main
```

---

## Phase 6: Void Ticket Automation

**Status**: 🟡 MEDIUM PRIORITY

### Files to Create

1. **Create** `src/modules/travel-assistant/booking/enugu/EnuguVoidTicket.ts`
   - File: `09_EnuguVoidTicket.ts`

### Installation Steps

```bash
cd your-tdis-repo

cp ../09_EnuguVoidTicket.ts src/modules/travel-assistant/booking/enugu/
```

### Phase 6 Git Commit

```bash
git add src/modules/travel-assistant/booking/enugu/EnuguVoidTicket.ts

git commit -m "Phase 6: Implement ticket voiding

- Check if Void button exists (never force void)
- If button exists: click void, confirm, capture confirmation
- If button doesn't exist: return helpful message (don't fake)
- Update UserBooking status to VOIDED
- Capture genuine airline confirmation screenshot"

git push origin main
```

---

## Phase 7: Booking History & Universal PNR Operations

**Status**: 🟡 MEDIUM PRIORITY

### Files to Create

1. **Create** `src/app/api/assistant/bookings/route.ts`
   - File: `10_api_bookings_list.ts`

2. **Create** `src/app/api/assistant/bookings/[pnr]/operations/route.ts`
   - File: `11_api_bookings_pnr_operations.ts`

### Installation Steps

```bash
cd your-tdis-repo

mkdir -p src/app/api/assistant/bookings
mkdir -p src/app/api/assistant/bookings/\[pnr\]/operations

cp ../10_api_bookings_list.ts src/app/api/assistant/bookings/route.ts
cp ../11_api_bookings_pnr_operations.ts src/app/api/assistant/bookings/\[pnr\]/operations/route.ts
```

### Phase 7 Git Commit

```bash
git add src/app/api/assistant/bookings/

git commit -m "Phase 7: Add booking history and universal PNR operations

- GET /api/assistant/bookings - List user's saved bookings
- GET /api/assistant/bookings?search=ABC123 - Search by PNR
- POST /api/assistant/bookings/{pnr}/operations - Rebook/void/check-status
- Users can now perform operations with just a PNR
- No need to re-enter passenger details"

git push origin main
```

---

## Phase 8: Connector-Service Endpoints

**Status**: 🔴 HIGH PRIORITY (for automation)

### Files to Update

1. **Update** `connector-service/src/server.ts`
   - File: `12_connector_service_new_endpoints.ts`
   - **Changes**: Add 3 new POST endpoints

### Installation Steps

```bash
cd your-tdis-repo

# View the file and add these endpoints to your server.ts:
# - POST /internal/travel-assistant/issue-ticket
# - POST /internal/travel-assistant/rebook
# - POST /internal/travel-assistant/void-ticket

# The file shows exactly what to add. Copy the code and insert
# after the existing /internal/travel-assistant/book-hold endpoint
```

### Phase 8 Git Commit

```bash
git add connector-service/src/server.ts

git commit -m "Phase 8: Add connector-service endpoints for issue/rebook/void

- POST /internal/travel-assistant/issue-ticket
- POST /internal/travel-assistant/rebook
- POST /internal/travel-assistant/void-ticket
- Each creates BookingJob, runs automation, updates database
- Returns 202 Accepted, caller polls for result"

git push origin main
```

---

## 🧪 Testing Checklist

After completing all phases:

- [ ] Phase 0: Test Book on Hold with password confirmation
- [ ] Phase 1: Verify UserAirlineCredential table created
- [ ] Phase 1: Test saving user credentials
- [ ] Phase 2: Test PNR verification
- [ ] Phase 3: Test ticket issuance workflow
- [ ] Phase 4: Test Save PNR button
- [ ] Phase 4: Test Issue Now button
- [ ] Phase 5: Test rebooking with different dates
- [ ] Phase 6: Test void ticket (if available)
- [ ] Phase 7: Test booking history retrieval
- [ ] Phase 7: Test PNR-based operations

---

## 🚀 Deployment Steps

```bash
# Final commit
git log --oneline | head -8
# Should show all 8 phase commits

# Push to GitHub
git push origin main

# Deploy to Railway (or your host)
# Verify all environment variables:
DATABASE_URL=...
DIRECT_URL=...
CONNECTOR_SERVICE_URL=...
CONNECTOR_SERVICE_API_KEY=...
CREDENTIAL_ENCRYPTION_KEY=...

# Run migrations
npm run db:migrate

# Start services
npm run dev
```

---

## 📞 Support

If you encounter issues during implementation:

1. Check the investigation report for clarifications
2. Review error messages in database logs
3. Verify environment variables are set correctly
4. Test connectivity to Enugu Air's website
5. Check connector-service is running and accessible

---

## ✅ Success Criteria

After implementation, users should be able to:

✅ Book flights and get valid, verifiable PNRs  
✅ Save bookings for later  
✅ Issue tickets with "Issue Now" button  
✅ Rebook expired bookings with one click  
✅ Void tickets if allowed  
✅ Use just a PNR to retrieve and manage bookings  
✅ See genuine airline confirmation screenshots  
✅ Have full control over when payment is made  

All with proper authentication and error handling.
