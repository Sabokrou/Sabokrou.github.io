# Student connection approval

The student confirms an email with Supabase Auth, requests a connection using a six-digit student ID, and waits for an instructor or active TA to verify their identity and approve. The ID is an identifier, not a password. Staff must verify identity through a trusted channel; possession of an email inbox does not establish ownership of an ID.

`student-connections.sql` is the one-time migration applied after the existing gradebook schema. It adds a private request history and authenticated RPC wrappers. Only staff can list and review requests. Unknown IDs receive the same pending response as known IDs, and repeated pending submissions are idempotent. Rejected students can submit a corrected ID. Each account is limited to five new requests per day. Approval locks the account and target record; existing account links cannot be reassigned by this flow. The old invitation-claim and invitation-issuance RPCs are revoked.

Students keep using email sign-in after approval. Existing approved links are preserved. Changing a connected account requires teaching-team assistance. Staff roles remain privately managed; this migration does not grant any person a staff role.

## Verification

Run `node backend/test-frontend.cjs` from the grade-tracker directory. Run `test-student-connections.sql` through an authorized SQL editor; it tests synthetic users and records in a transaction and rolls back every fixture. The test fails on conflicting reserved fixture IDs instead of modifying existing records.

The private request table intentionally has RLS enabled with no policies and no direct client grants. Access is through checked functions, so the [RLS-without-policy informational notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) is expected. Supabase also reports [leaked-password protection disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection); this portal uses email OTP and does not collect passwords.
