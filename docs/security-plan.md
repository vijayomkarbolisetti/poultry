# Security Plan — Poultry Vaccine Tracker

## Threat model (v1)

- Cross-tenant data access (Owner A ↔ Owner B)
- Farmer accessing unassigned sheds
- Privilege escalation via request body role/owner_id
- Token theft from device storage
- Media cross-owner access
- Injection / mass assignment
- Secrets leakage via logs or git

## Controls

### AuthN
- bcrypt password hashes (cost ≥ 12 in production)
- Short-lived JWT access tokens
- Refresh rotation + revocation on logout
- SecureStore on mobile
- HTTPS only in deployed environments

### AuthZ
- Membership + permission DB tables
- Never trust client role/owner_id
- Org Admin has **explicit grants only** (D6) — no implicit near-owner access
- Platform Super Admin has **no** automatic farm data access (D10)
- Central `require_permission` dependencies
- PostgreSQL RLS with non-bypass app role
- Negative tests for Owner A vs B and farmer isolation

### Data
- FK + CHECK constraints
- Soft archive for historical farm records
- Audit log for corrections and privilege changes
- Safe API errors (no tenant leakage)

### Media (Cloudinary)
- Credentials server-side only
- Signed uploads; private delivery
- Authz before sign/destroy/list versions
- File type + size validation
- Soft-delete metadata; destroy asset when authorized

### Ops
- Secrets only in env / platform secret stores
- Separate local / test / production configs
- CORS allowlist
- Rate limit auth endpoints where platform supports it
- Dependency vulnerability checks before release

## Security checklist (pre-production)

- [ ] No secrets in git
- [ ] `DEBUG=false` in production
- [ ] Strong `JWT_SECRET` / refresh pepper rotated
- [ ] App DB role cannot `BYPASSRLS`
- [ ] Migrations role credentials not on mobile/API runtime if separable
- [ ] Cloudinary folder prefix per owner; destroy tested
- [ ] Backup encryption + restore drill documented
- [ ] Auth brute-force throttling configured
- [ ] Logging redacts tokens, passwords, signed URLs

## Logging policy

Never log: passwords, JWT/refresh tokens, Cloudinary signatures, full signed URLs with secrets.
