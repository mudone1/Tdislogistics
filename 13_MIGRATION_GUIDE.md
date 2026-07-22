# Database Migration Guide

## Step 1: Update Prisma Schema

Replace your `prisma/schema.prisma` with the updated version (file `01_schema.prisma`).

The new schema adds these tables:
- `UserAirlineCredential` - Per-user encrypted airline credentials
- `UserBooking` - User's booking history with PNR tracking
- `PnrVerification` - Audit trail of PNR verification attempts

## Step 2: Generate Prisma Client

```bash
npm run prisma generate
```

This generates the TypeScript types for the new tables.

## Step 3: Create Migration File

Create the migration:

```bash
npm run db:migrate
```

When prompted, give it a name like:

```
? Enter a name for this migration: add_user_credentials_booking_history
```

This will:
1. Create the SQL migration files
2. Apply the migration to your database
3. Update `prisma/migrations/` directory

## Step 4: Verify Migration

Check that all tables were created:

```bash
npm run db:studio
```

This opens Prisma Studio. Verify these tables exist:
- `user_airline_credentials`
- `user_bookings`
- `pnr_verifications`

All should have 0 rows initially.

## Migration Rollback (If Needed)

To rollback to previous state:

```bash
npx prisma migrate resolve --rolled-back "timestamp_name"
```

Then manually drop the tables:

```bash
DROP TABLE user_bookings;
DROP TABLE user_airline_credentials;
DROP TABLE pnr_verifications;
```

## Environment Variables

Ensure these are set before running migrations:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/tdis
DIRECT_URL=postgresql://user:password@localhost:5432/tdis  # Non-pooled connection
CREDENTIAL_ENCRYPTION_KEY=<64-hex-character-string>
```

### Generate Encryption Key

If you don't have `CREDENTIAL_ENCRYPTION_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

This outputs a 64-character hex string. Add to `.env`:

```env
CREDENTIAL_ENCRYPTION_KEY=abc123def456...
```

⚠️ **Critical**: Keep this key safe. If lost, all stored credentials become unrecoverable.

## Migration SQL (For Reference)

The migration creates:

```sql
-- User airline credentials (encrypted)
CREATE TABLE user_airline_credentials (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  airline TEXT NOT NULL,
  encryptedUsername TEXT NOT NULL,
  encryptedPassword TEXT NOT NULL,
  connectionStatus TEXT DEFAULT 'CONFIGURED',
  lastTestedAt TIMESTAMP,
  lastTestError TEXT,
  updatedAt TIMESTAMP,
  createdAt TIMESTAMP DEFAULT NOW(),
  UNIQUE(userId, airline)
);

-- User booking history
CREATE TABLE user_bookings (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  jobId TEXT NOT NULL UNIQUE,
  pnr TEXT NOT NULL,
  airline TEXT NOT NULL,
  status TEXT DEFAULT 'BOOKED', -- BOOKED | ISSUED | VOIDED | EXPIRED
  bookedAt TIMESTAMP DEFAULT NOW(),
  issuedAt TIMESTAMP,
  voidedAt TIMESTAMP,
  expiresAt TIMESTAMP,
  issueJobId TEXT,
  voidJobId TEXT
);

-- PNR verification audit trail
CREATE TABLE pnr_verifications (
  id TEXT PRIMARY KEY,
  pnr TEXT NOT NULL,
  airline TEXT NOT NULL,
  passengerName TEXT,
  verified BOOLEAN,
  verifiedAt TIMESTAMP DEFAULT NOW(),
  errorMessage TEXT,
  verificationMs INTEGER
);

CREATE INDEX user_bookings_userId_createdAt ON user_bookings(userId, bookedAt);
CREATE INDEX user_bookings_userId_pnr ON user_bookings(userId, pnr);
CREATE INDEX pnr_verifications_pnr_airline ON pnr_verifications(pnr, airline);
```

## Testing Migration

After migration completes:

1. Test credential encryption:

```bash
node -e "
const { encrypt, decrypt } = require('./modules/airline-connectors/services/UserCredentialService');
const secret = 'test-password-123';
const encrypted = encrypt(secret);
const decrypted = decrypt(encrypted);
console.log('Encryption test:', secret === decrypted ? 'PASS' : 'FAIL');
"
```

2. Test saving a credential:

```bash
# Use Prisma Studio to manually insert test data
npm run db:studio
```

3. Test retrieving via API (after deploying):

```bash
curl -X GET http://localhost:3000/api/users/credentials \
  -H "Authorization: Bearer <user-token>"
```

## Production Checklist

Before running migration on production:

- [ ] Backup production database
- [ ] Test migration on staging first
- [ ] Verify all indices are created
- [ ] Check query performance on new tables
- [ ] Ensure `CREDENTIAL_ENCRYPTION_KEY` is securely stored
- [ ] Monitor database size increase
- [ ] Verify Prisma client generated correctly

## Troubleshooting

### "Direct connection failed"

Your DATABASE_URL might be using a connection pooler (PgBouncer). Prisma migrations need a direct connection:

```env
# ❌ Wrong (pooled)
DATABASE_URL=postgresql://user:pass@pool.db.supabase.com:6543/tdis

# ✅ Correct (direct)
DIRECT_URL=postgresql://user:pass@db.supabase.com:5432/tdis
```

See your database provider's docs for the direct connection string.

### "Encryption key not found"

```
Error: CREDENTIAL_ENCRYPTION_KEY must be set and be 64 hex characters
```

Generate and add to `.env`:

```bash
node -e "console.log(process.env.NODE_ENV || 'development'); require('crypto').randomBytes(32).toString('hex')" > .creds-key
cat .creds-key
```

Then add to `.env`:

```env
CREDENTIAL_ENCRYPTION_KEY=<output-from-above>
```

### Tables not appearing in Prisma Studio

Rebuild Prisma client:

```bash
npm run prisma generate
npm run db:studio
```

## Next Steps After Migration

1. Deploy updated code with new models
2. Users can now save credentials via `/api/users/credentials`
3. Bookings are automatically saved to `UserBooking` table
4. Users can retrieve bookings by PNR

See implementation guide for API endpoints.
