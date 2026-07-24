# TDIS Airline Booking Bot - Investigation Report (REVISED)
**Date**: July 22, 2026  
**Status**: Analysis Complete with Critical Clarifications ✅  
**Action**: Ready for Implementation with Corrected Workflow

---

## 🔴 CRITICAL FINDING: Missing Authentication Step

### Root Cause Identified

The earlier implementation likely **bypassed the password confirmation step** required by Enugu Air's Book on Hold workflow.

**Actual Enugu Air Flow:**
```
1. Search flights → Select flight
2. Enter passenger details
3. Review booking
4. Click "Book Now, Pay Later" button
5. ⚠️ MISSING: Airline prompts for password confirmation
6. ⚠️ MISSING: User enters their airline account password
7. ⚠️ MISSING: System confirms the booking
8. THEN: Genuine Book on Hold created with valid PNR
```

**Why This Matters:**
- Without password confirmation, booking may not be written to airline database
- PNR might be generated locally but not registered in airline system
- Screenshots incomplete because authentication flow wasn't completed
- This explains why earlier PNRs couldn't be verified in the airline system

### Implementation Priority: 🔴 CRITICAL (Phase 0)

**MUST FIX BEFORE ANYTHING ELSE:**
- Detect the password prompt after "Book Now, Pay Later"
- Enter user's airline account password
- Confirm the booking
- Only then capture screenshot and return PNR

---

## 📋 Corrected Workflow (Phases 1-9)

### Phase 1: Book on Hold (Corrected)
```
INPUT: Passenger details + route/dates + user's airline credentials

FLOW:
1. Navigate airline → search/select flight
2. Enter passenger details
3. Click "Book Now, Pay Later"
4. ✅ WAIT FOR: Password confirmation prompt
5. ✅ ENTER: User's airline account password
6. ✅ CONFIRM: Booking confirmation (airline side)
7. ✅ CAPTURE: Genuine confirmation screenshot (includes PNR)
8. RETURN: 
   - Valid PNR
   - Genuine airline screenshot
   - Booking details
   - [Save PNR] [Issue Now] buttons

CRITICAL: Do NOT proceed until password is entered and booking confirmed by airline
```

### Phase 2: Save PNR (User Action)
```
User clicks: [Save PNR]

FLOW:
1. Store booking in UserBooking table
2. Store PNR for later retrieval
3. Confirm: "Booking saved. You can issue the ticket anytime by saying 'Issue ABC123'"
4. STOP - NO PAYMENT

DATABASE UPDATE:
- UserBooking.status = BOOKED
- UserBooking.bookedAt = now()
```

### Phase 3: Issue Now (User Action)
```
User clicks: [Issue Now]

FLOW:
1. Log into airline using user's SAVED credentials (from UserAirlineCredential)
2. Search for PNR using Manage My Booking
3. Verify PNR still exists and is valid
4. Confirm "Pay Now" button is available
5. Click "Pay Now"
6. Complete payment workflow
7. Capture final screenshot (must show payment summary + ticket details)
8. Return:
   - Payment confirmation screenshot
   - Ticket number (if generated)
   - Payment summary
   - [Void Ticket] button (if supported)

DATABASE UPDATE:
- UserBooking.status = ISSUED
- UserBooking.issuedAt = now()
```

### Phase 4: Universal PNR Operations

User can now perform actions with just a PNR:

```
User: "Issue ABC123"       → Triggers Phase 3 workflow
User: "Rebook ABC123"      → Triggers Phase 5 workflow
User: "Void ABC123"        → Triggers Phase 6 workflow
User: "Check ABC123"       → Show booking status
User: "Cancel ABC123"      → Show cancellation options
```

Bot automatically:
- Retrieves saved UserBooking by PNR
- Uses saved credentials
- Does NOT ask for passenger details again

---

### Phase 5: Expired Booking Handling

```
User clicks: [Issue Now]
Bot retrieves booking...
Bot navigates to airline...
Bot searches for PNR...

IF PNR NOT FOUND or "Pay Now" button not available:
  RETURN:
    ⚠️ "This Book on Hold has expired"
    [Rebook] [Ignore]

IF User clicks [Rebook]:
  → Go to Phase 6 (Rebooking)

IF User clicks [Ignore]:
  STOP - booking remains saved for manual handling
```

---

### Phase 6: Rebooking Workflow

```
TRIGGER: User says "Rebook ABC123" or clicks [Rebook] on expired booking

FLOW:
1. Retrieve stored booking (passenger info, contact, itinerary)
2. Reuse all saved details UNLESS user specifies changes:
   - "Rebook to Abuja instead" → change destination
   - "Rebook for 15 July" → change departure date
   - "Rebook with return" → add/remove return leg
   
3. Attempt to book with ORIGINAL class (e.g., "Economy Promo")
4. IF unavailable → Try NEXT HIGHER class only (e.g., "Economy Saver")
5. IF that unavailable → Try ONE MORE class
6. IF all unavailable → "No seats available for this route"

⚠️ DO NOT skip classes. Only move to immediate next class.
⚠️ DO NOT try Comfort/Business if Economy classes full.
⚠️ DO NOT loop through all available classes.

7. Complete authentication step (password confirmation)
8. Return new PNR + confirmation screenshot
9. Display: [Save PNR] [Issue Now] buttons
```

---

### Phase 7: Void Ticket Workflow

```
DISPLAY: After successful ticket issuance

Bot displays:
  ✅ Ticket issued: ABC123
  Ticket number: [if available]
  
  [Void Ticket] [Print] [Download]

IF User clicks [Void Ticket]:
  1. Log in using user's credentials
  2. Retrieve issued ticket by PNR
  3. Check if "Void" button is visible on airline page
  
  IF "Void" button exists:
    - Click "Void"
    - Confirm void action
    - Capture confirmation screenshot
    - Return: "✅ Ticket successfully voided"
    - DATABASE: UserBooking.status = VOIDED, UserBooking.voidedAt = now()
  
  ELSE:
    - Return message: "This ticket can no longer be voided. Please log in 
      to your Enugu Air account using the PNR to manage the booking yourself, 
      or contact Enugu Air Support for assistance."
    - DO NOT attempt workarounds
    - DO NOT fake the void
```

---

## 🛠️ Implementation Priority (Corrected)

### Phase 0: Fix Authentication Step 🔴 CRITICAL
**MUST DO FIRST - explains invalid PNRs**

Files to Create:
- `src/modules/travel-assistant/booking/enugu/EnuguBookOnHoldWithAuth.ts`

Changes:
- Detect password prompt after "Book Now, Pay Later"
- Enter user's airline password
- Confirm booking with airline
- Verify authentication completed before marking success

**Why This First:**
- Answers why original PNRs were invalid
- Prevents fake/incomplete bookings
- All other phases depend on valid PNRs

**Estimated Time:** 3 hours
**Risk Level:** Critical but well-defined

---

### Phase 1: Implement Save/Issue Button Workflow 🔴 HIGH
Files to Create:
- `src/app/api/assistant/book-hold/[id]/save/route.ts`
- `src/app/api/assistant/book-hold/[id]/issue/route.ts`
- `src/modules/travel-assistant/booking/enugu/EnuguIssueTicket.ts`

**Estimated Time:** 6 hours

---

### Phase 2: User Credential Storage 🔴 HIGH
Files to Create:
- `src/modules/airline-connectors/services/UserCredentialService.ts`
- `src/app/api/users/credentials/route.ts`

**Estimated Time:** 4 hours

---

### Phase 3: Booking History & Retrieval 🟡 MEDIUM
Files to Create:
- `src/app/api/assistant/bookings/route.ts`
- `src/app/api/assistant/bookings/[pnr]/route.ts`

**Estimated Time:** 3 hours

---

### Phase 4: PNR Verification 🔴 HIGH
Files to Create:
- `src/modules/travel-assistant/verification/VerifyPnr.ts`

**Estimated Time:** 4 hours

---

### Phase 5: Expired Booking Handling 🟡 MEDIUM
Files to Create:
- `src/modules/travel-assistant/booking/CheckBookingStatus.ts`

**Estimated Time:** 2 hours

---

### Phase 6: Rebooking Workflow 🟡 MEDIUM
Files to Create:
- `src/modules/travel-assistant/booking/enugu/EnuguRebook.ts`
- `src/app/api/assistant/bookings/[pnr]/rebook/route.ts`

**Estimated Time:** 5 hours

---

### Phase 7: Void Ticket Workflow 🟡 MEDIUM
Files to Create:
- `src/modules/travel-assistant/booking/enugu/EnuguVoidTicket.ts`
- `src/app/api/assistant/bookings/[pnr]/void/route.ts`

**Estimated Time:** 3 hours

---

## ✅ Key Corrections Incorporated

| Item | Original Finding | User Clarification | Implementation Change |
|------|------------------|-------------------|----------------------|
| Auth Step | Assumed missing | CONFIRMED missing | Phase 0: Critical fix before anything else |
| Payment | Auto-issue | Separate operation | Two buttons: Save vs Issue |
| PNR Operations | Not mentioned | Universal support | Accept PNR as primary identifier |
| Expired Bookings | Auto-rebook | Ask user first | Check status → Show dialog → Wait for choice |
| Rebooking | Not specified | Reuse details, smart class fallback | Load saved data, try next class only |
| Void Tickets | Not specified | Check if allowed | Only void if button exists, else show message |
| Screenshots | Incomplete | Must show full details | Capture genuine airline page, all sections |

---

## 📊 Database Schema (Final)

All models remain from schema.prisma with these additions:

```prisma
// UserAirlineCredential - Per-user encrypted credentials
// UserBooking - User's booking history with PNR tracking
// PnrVerification - Audit trail of verification attempts
// BookingJob - Linking jobs to users for history
```

---

## 🚀 Next Steps

1. **Confirm these clarifications are correct** ✅
2. **Generate Phase 0 code** (Fix authentication step)
3. **Generate Phases 1-7** in order
4. **You review each file**
5. **You commit to GitHub**
6. **You test in staging**

---

## ⚠️ Critical Success Factors

1. **Authentication Step MUST Complete**
   - User's airline password entered
   - Airline confirms booking
   - Only then capture screenshot
   - Only then mark SUCCESS

2. **Separate Book vs Issue**
   - Booking = hold only (user saves)
   - Issuing = payment (user clicks "Issue Now")
   - No auto-payment

3. **PNR as Primary Key**
   - User provides PNR
   - Bot retrieves everything
   - No re-entry of passenger details

4. **Genuine Screenshots**
   - Always capture actual airline page
   - Never generate custom confirmations
   - Include all details (PNR, payment, amounts, etc.)

5. **Smart Rebooking**
   - Reuse saved data
   - Try next class only (no class-skipping)
   - Fail gracefully if no seats available

---

## ✨ Result After Implementation

Users will be able to:

✅ Create real bookings in Enugu Air system  
✅ Get valid, verifiable PNRs  
✅ Save bookings for later  
✅ Issue tickets when ready  
✅ Rebook expired bookings  
✅ Void issued tickets  
✅ Check booking status anytime  
✅ Use just the PNR for any operation  
✅ See genuine airline confirmations  

All with proper authentication and user control at every step.
