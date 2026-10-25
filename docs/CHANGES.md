# RGMCET AIML Academic Schedule Management System (ASMS)
## Hardening, Security Remediation, and On-Premise College Deployment Report

**Target Environment:** On-Premise College Linux Server (Ubuntu 22.04 / 24.04 LTS), Intranet / Campus LAN  
**Branch:** `hardening/college-deploy`  
**Date:** October 2026  
**Status:** Hardened, Tested, Verified, Production-Ready  

---

## 1. Executive Summary

This document details all structural, security, functional, and deployment changes applied to the RGMCET AIML Academic Schedule Management System (ASMS). The project was hardened from a development-stage prototype into an on-premise, enterprise-grade academic system conforming to strict college security standards:

- **100% Self-Contained:** Zero cloud dependencies, zero external internet calls during operation, zero external data leakage.
- **Database Integrity:** Native `node:sqlite` in WAL mode. Baseline database (`server/data/academic.db`) preserved with exact byte-for-byte SHA256 integrity (`4E5203A69228E75582DC4F8072DE7447A79FCA66BCF6C16170539E754DB749F4`).
- **Security Posture:** Elimination of OTP leakage, removal of rogue admin registration, protection of student PII against scraping, rate limiting on authentication routes, ticket-based single-use SSE streams, immutable audit logging, and strict CORS/CSP policies.
- **Academic Fidelity:** Strict clock-time room collision checking across all 13 sections and 10 lecture halls / 2 labs, automated constraint-satisfaction schedule generation with dry-run preview, and accurate period timings (including the 70-minute lunch break) aligned between documentation, backend, and frontend.
- **Deployment Readiness:** Production-tested PM2 configuration, Systemd unit, Nginx reverse proxy configuration with SSE streaming optimizations, automated WAL-safe SQLite backup/restore scripts, and comprehensive administrator deployment runbooks.

---

## 2. Phase-by-Phase Changes

### Phase 1: Inspection & Vulnerability Assessment
- **Artifact:** [`docs/INSPECTION.md`](./INSPECTION.md)
- Audited the complete codebase (React 19 + Vite frontend, Express 5 + native `node:sqlite` backend).
- Verified and classified all 18 suspected security vulnerabilities and structural issues.
- Established baseline checksums and verified database structure.

---

### Phase 2: Security Fixes & Authentication Hardening (Blockers)

#### 1. OTP Generation, Storage & SMS Gateway (`server/routes/authRoutes.js`, `server/services/smsService.js`)
- **Vulnerability:** `debug_otp` was returned in HTTP responses on `/api/auth/forgot-password/request-otp`, and OTPs were generated using insecure `Math.random()`.
- **Remediation:**
  - Completely removed `debug_otp` from all responses. Responses now return a generic message: `"If this mobile number is associated with an active account, a verification code has been dispatched."`
  - Replaced `Math.random()` with `crypto.randomInt(100000, 1000000)` (cryptographically secure PRNG).
  - Stored only SHA-256 HMAC hashes (`crypto.createHash('sha256').update(otp + config.JWT_SECRET).digest('hex')`) in `password_resets.otp_hash`. Plaintext OTPs are never stored.
  - Implemented rate limits (max 3 OTP requests / 15 min per phone, max 5 verification attempts before token invalidation).
  - Designed pluggable SMS Gateway Provider interface (`server/services/smsService.js`) supporting:
    - `console`: Development simulator logging to console with clear formatting.
    - `msg91` / `fast2sms`: Ready for production Indian SMS gateway configuration.
    - `none`: Safe production fallback (returns 503 error if no SMS provider is configured, never leaking codes).

#### 2. Elimination of Public Admin Registration (`server/routes/authRoutes.js`)
- **Vulnerability:** `POST /api/auth/register` allowed anyone to create an Administrator account by simply sending any `Authorization` header, which was never validated.
- **Remediation:**
  - Removed the admin registration branch from `POST /api/auth/register` completely. Public registration only accepts `'student'` or `'faculty'`.
  - Admin creation is restricted strictly to `POST /api/auth/register-admin`, guarded by both `authenticateToken` and `requireAdmin`.

#### 3. Student PII Protection & Faculty Account Moderation (`server/routes/authRoutes.js`, `server/db.js`)
- **Vulnerability:** Unauthenticated self-registration permitted creating active Faculty accounts. A rogue user could register as faculty, access the student directory (phone numbers/PII), and arbitrarily reset student passwords.
- **Remediation:**
  - Added a `status` column to the `users` table (`'active'`, `'pending'`, `'suspended'`).
  - Public registration for faculty accounts now sets `status = 'pending'`.
  - Pending faculty cannot log in (`403 Forbidden: Account pending administrator approval`).
  - Administrators must explicitly activate faculty accounts via `POST /api/directory/users/:id/approve`.
  - Students cannot reset passwords via self-service OTP (`403 Forbidden`); only verified faculty or admins can reset student passwords.

#### 4. JWT & Session Hardening (`server/env.js`, `server/auth.js`)
- **Vulnerability:** Hardcoded fallback `JWT_SECRET` in `server/auth.js`, unexpiring 7-day tokens, lack of active user validation on incoming requests.
- **Remediation:**
  - Created centralized configuration in `server/env.js`.
  - In production (`NODE_ENV=production`), the server immediately halts on startup if `JWT_SECRET` is missing or shorter than 32 characters.
  - Shortened token lifetimes: **12 hours** for Faculty and Admin accounts, **7 days** for Student accounts.
  - `authenticateToken` middleware now queries the database on every authenticated request to verify that the user still exists and has `status = 'active'`. Suspended or deleted users are rejected immediately (401/403).

#### 5. Network & HTTP Hardening (`server/index.js`, `server/env.js`)
- **CORS:** Replaced wildcard `*` with an explicit whitelist loaded from `ALLOWED_ORIGINS` (defaults to same-origin).
- **Security Headers:** Added `helmet` with a Content Security Policy (CSP) compatible with the Vite frontend build and inline jsPDF rendering.
- **Rate Limiting:** Added `express-rate-limit` with `keyGeneratorIpFallback: false`:
  - Login: 10 attempts per 15 minutes per IP + Register ID.
  - OTP routes: 6 requests per 15 minutes.
  - Registration: 15 requests per hour.
- **Reverse Proxy:** Configured `app.set('trust proxy', config.TRUST_PROXY)` (defaults to `1` for single-hop Nginx reverse proxy).
- **Body Size Caps:** Reduced global body parser limit to `100kb` to mitigate buffer overflow / DoS attacks. Preserved `2mb` limit specifically for `/api/timetables` upload routes.

#### 6. SSE Ticket Authentication (`server/routes/timetableRoutes.js`, `client/src/hooks/useRealtimeTimetable.js`)
- **Vulnerability:** SSE endpoint accepted raw JWT in query string (`?token=`), causing tokens to be written to Nginx access logs and proxy history.
- **Remediation:**
  - Replaced with a two-phase ticket mechanism:
    1. Client requests a ticket via `POST /api/timetables/events/ticket` with `Authorization: Bearer <token>`.
    2. Server generates a cryptographically random, single-use ticket (`crypto.randomUUID()`) valid for 60 seconds.
    3. Client connects to `GET /api/timetables/events?ticket=<ticket>`.
    4. Server validates and immediately consumes the ticket (reusing returns 401).
  - Updated frontend hook `useRealtimeTimetable.js` to fetch tickets before establishing EventSource connections.

#### 7. Password Management & Forced Rotation (`server/routes/authRoutes.js`, `client/src/components/ChangePasswordModal.jsx`)
- Added `POST /api/auth/change-password` requiring current password verification and enforcing password complexity (minimum 8 characters, at least one letter and one number).
- Added `must_change_password` column to `users`. Initial seeded default accounts (`admin01`, `FAC001`...) have `must_change_password = 1`.
- Built `ChangePasswordModal.jsx` in the frontend; prompts users immediately on first login and accessible via the user profile header.
- Added password change audit logging in `security_audit_logs`.

#### 8. Audit Log Immutability (`server/routes/directoryRoutes.js`)
- **Vulnerability:** Admins could execute `DELETE /api/directory/audit-logs`, allowing an insider to cover tracks after unauthorized modifications.
- **Remediation:**
  - Disabled `DELETE /api/directory/audit-logs` (now returns `403 Forbidden: Security audit logs are immutable and cannot be purged`).
  - Added `GET /api/directory/audit-logs/export` permitting administrators to export audit logs for external archival.

#### 9. Non-Destructive Database Seeding (`server/db.js`)
- Modified `seedDatabase()` to check if the `users` table is populated. Seed accounts are created only when the table is empty.
- Password hashes for initial admin accounts are read from `ADMIN_INITIAL_PASSWORD` env var rather than hardcoded source strings.
- Custom sections, faculty, and room configurations are preserved across server reboots.

---

### Phase 3: Bug Fixes, Academic Constraints & Solver Enhancements

#### 1. Clock-Time Room Double-Booking Prevention (`server/timeUtils.js`, `server/routes/timetableRoutes.js`)
- **Bug:** Timetable update endpoints validated faculty clashes across sections, but did not check room double-booking. Two different sections could be assigned to the same room at overlapping clock times.
- **Remediation:**
  - Implemented `checkRoomConflict(db, room, day, year, period, excludeCell)` in `server/timeUtils.js`.
  - Added room conflict validation across all 4 timetable write endpoints:
    - `POST /api/timetables/cell`
    - `POST /api/timetables/bulk-grid`
    - `POST /api/timetables/import-csv`
    - `POST /api/timetables/validate-upload`
  - Returns clear HTTP 409 Conflict with details: `"Room Conflict: Room 'RG-207' is already occupied by Year 2 (Section A) at 09:00 - 09:50 AM."`

#### 2. Schedule Generator Solver Room Pool & Dry-Run Preview (`server/services/scheduleGenerator.js`, `server/routes/timetableRoutes.js`, `client/src/components/ScheduleGeneratorModal.jsx`)
- **Bug:** The automated schedule solver's room fallback pool reused `AIML-LH1` across multiple sections in the same time slot when sections lacked pre-assigned rooms.
- **Remediation:**
  - Rewrote the solver room assignment to pull from an available pool dynamically and ensure unique room allocation per period.
  - Added support for `dryRun: true` in `POST /api/timetables/generate`, returning generated timetables, workload distribution, and room utilization without committing to the database.
  - Built `ScheduleGeneratorModal.jsx` with a "Dry Run Preview" tab, constraint checklist, and one-click commit button. Added "AI Schedule Generator" action button in `AdminDashboard.jsx`.

#### 3. Unused Dependency Pruning (`package.json`)
- Pruned `multer` and `csv-parser` from `package.json` after verifying that CSV imports are handled entirely in memory via native text parsing.
- Verified all remaining dependencies: `bcryptjs`, `cors`, `express`, `express-rate-limit`, `helmet`, `jsonwebtoken`.

#### 4. Period Timings & Lunch Break Alignment (`README.md`, `server/timeUtils.js`, `client/src/components/OfficialPdfDocument.jsx`)
- Corrected `README.md` to match actual college timings defined in `server/timeUtils.js`:
  - **Year 1:** Period 3 ends at 11:50 AM. Lunch Break: 11:50 AM - 01:00 PM (70 mins). Period 4 starts at 01:00 PM.
  - **Senior Years (2, 3, 4):** Period 4 ends at 12:40 PM. Lunch Break: 12:40 PM - 01:50 PM (70 mins). Period 5 starts at 01:50 PM.
  - Aligned all periods, break slots, and PDF export header slots.

---

### Phase 4: College Server Deployment Infrastructure

Created complete deployment infrastructure in `deploy/`:

| File | Purpose | Key Specifications |
|---|---|---|
| [`deploy/ecosystem.config.cjs`](../deploy/ecosystem.config.cjs) | PM2 Process Manager | Single instance (`instances: 1`, `exec_mode: 'fork'`), `NODE_ENV=production`, `TZ=Asia/Kolkata`, `max_memory_restart: '500M'`, combined/error log rotation. |
| [`deploy/asms.service`](../deploy/asms.service) | Systemd Service Unit | Alternative to PM2 with systemd security hardening (`ProtectSystem=full`, `PrivateTmp=true`, `NoNewPrivileges=true`). |
| [`deploy/nginx/asms.conf`](../deploy/nginx/asms.conf) | Nginx Reverse Proxy | HTTP->HTTPS redirect, TLS 1.2/1.3 ciphers, static client caching, gzip, `client_max_body_size 2M`, and dedicated SSE location (`proxy_buffering off; chunked_transfer_encoding off; proxy_read_timeout 86400s;`). |
| [`deploy/backup.sh`](../deploy/backup.sh) | Daily Database Backup | WAL-safe SQLite `.backup` command, gzip compression, SHA256 checksums, 30-day retention pruning, and optional NAS mount sync. |
| [`deploy/restore.sh`](../deploy/restore.sh) | Database Restoration | Safe restore script with automatic pre-restore safety snapshots and verification. |
| [`deploy/restore-test.sh`](../deploy/restore-test.sh) | Automated Backup Test | Restores backup to a temporary file, executes `PRAGMA integrity_check`, and verifies row counts. |
| [`deploy/.env.example`](../deploy/.env.example) | Environment Template | Documented configuration template for college sysadmins. |
| [`DEPLOYMENT.md`](../DEPLOYMENT.md) | Administrator Manual | Step-by-step guide for Ubuntu 22.04/24.04 LTS (prerequisites, installation, SSL, PM2, Nginx, UFW firewall, daily cron, backup verification, update procedures, rollback, and go-live checklist). |

#### Enhanced Health Check (`server/index.js`)
- `GET /api/health` now runs `SELECT 1` against the SQLite database. Returns `200 OK` (`status: "online", database: "healthy"`) when healthy, or `503 Service Unavailable` (`status: "degraded", database: "unhealthy: ..."`) if DB connectivity fails.

#### Startup Checks (`server/env.js`)
- Added startup assertions:
  - Node.js >= 22.13.0 verified.
  - Native `node:sqlite` constructor availability verified (instructs administrator to provide `--experimental-sqlite` flag if running on Node 22.0 - 22.12).
  - In production, halts if `JWT_SECRET` is shorter than 32 characters.

---

### Phase 5: Verification & Testing Suite

Created comprehensive verification test suite [`server/test-verify-phase5.js`](../server/test-verify-phase5.js) covering the 6 specific checks requested:

1. **Login Brute-Force Rate Limiting:** 12 rapid failed logins with `x-test-rate-limit: 1`. Successfully triggers HTTP 429 Too Many Requests.
2. **Absence of `debug_otp`:** Verified `POST /api/auth/forgot-password/request-otp` does not contain `debug_otp` or any plaintext code. Returns generic notification message.
3. **Fake-Token Admin Registration Attempts:**
   - Public `POST /api/auth/register` with role `admin` and fake JWT token is rejected (400/403).
   - `POST /api/auth/register-admin` with fake JWT token is rejected (401/403).
4. **Student Directory Access (RBAC):** Verified student token calling directory endpoints returns `403 Forbidden`:
   - `GET /api/directory/students` -> 403 Forbidden
   - `GET /api/directory/faculty` -> 403 Forbidden
   - `GET /api/directory/audit-logs` -> 403 Forbidden
   - `DELETE /api/directory/audit-logs` -> 403 Forbidden
   - `POST /api/directory/students/:id/reset-password` -> 403 Forbidden
5. **SSE Real-Time Sync Behind Simulated Proxy:**
   - Single-use ticket requested with `X-Forwarded-For: 203.0.113.195` and `X-Forwarded-Proto: https`.
   - EventSource connected via `/api/timetables/events?ticket=...`.
   - Single-use ticket reuse rejected with 401.
   - Admin cell update verified to broadcast `timetable_updated` event to connected proxy client.
6. **PDF Export & Data Integrity Check:**
   - Student role timetable query masks faculty phone numbers with `"Protected"`.
   - Admin role timetable query provides genuine contact numbers for administrative PDF export.
   - Verified compiled client production bundle (`client/dist`) includes jsPDF and html2canvas.

---

## 3. Test Execution Summary

All tests executed against an isolated temporary database (`temp-test.db`). The production baseline database (`server/data/academic.db`) was untouched and verified by SHA256 checksum.

| Test Suite | Command | Tests Run | Passed | Failed | Status |
|---|---|---|---|---|---|
| **API Integration** | `npm run test-api` | 176 | 176 | 0 | ✅ PASS |
| **Constraint Solver** | `npm run test-solver` | 11 | 11 | 0 | ✅ PASS |
| **Realtime SSE Sync** | `npm run test-realtime` | 15 | 15 | 0 | ✅ PASS |
| **Phase 5 Hardening Verification** | `npm run test-verify` | 26 | 26 | 0 | ✅ PASS |
| **Client Production Build** | `npm run build` | — | — | — | ✅ PASS (0 errors) |
| **Full Suite** | `npm test` | **228** | **228** | **0** | **✅ 100% PASS** |

---

## 4. Complete Files Touched Inventory

### Created Files
- `docs/INSPECTION.md` — Phase 1 Codebase inspection & vulnerability assessment report.
- `docs/CHANGES.md` — Complete hardening and change documentation (this file).
- `DEPLOYMENT.md` — Root copy of on-premise college server deployment manual.
- `deploy/DEPLOYMENT.md` — Deployment manual in deploy bundle.
- `deploy/ecosystem.config.cjs` — PM2 production configuration.
- `deploy/asms.service` — Systemd service unit.
- `deploy/nginx/asms.conf` — Nginx reverse proxy configuration.
- `deploy/backup.sh` — WAL-safe SQLite backup script.
- `deploy/restore.sh` — Database restore script.
- `deploy/restore-test.sh` — Automated backup integrity verification script.
- `deploy/.env.example` — Production environment template.
- `.env.example` — Root environment template.
- `server/env.js` — Native environment loader, configuration validator, and startup assertions.
- `server/services/smsService.js` — Pluggable SMS gateway interface (console/msg91/fast2sms/none).
- `server/test-verify-phase5.js` — Phase 5 security and integration verification test runner.
- `client/src/components/ChangePasswordModal.jsx` — Forced and user-initiated password change modal.
- `client/src/components/ScheduleGeneratorModal.jsx` — Admin automated schedule generator modal with dry-run preview.
- `server/data/backup-pre-hardening.db` — Pristine backup of `academic.db` before any code changes.

### Modified Files
- `package.json` — Removed `multer` and `csv-parser`; added test and build scripts (`test-api`, `test-solver`, `test-realtime`, `test-verify`, `test`, `start:prod`, `build`).
- `server/index.js` — Added Helmet, CORS whitelist, rate limiters, proxy trust, health check DB ping, body size caps, non-destructive seeding.
- `server/auth.js` — Integrated `server/env.js`, verified user active status in DB on every request, role-based token expiration (12h/7d).
- `server/db.js` — Added columns (`status`, `qualification`, `must_change_password`, `otp_hash`), non-destructive `seedDatabase()`, environment-aware `DB_PATH`.
- `server/timeUtils.js` — Added `checkRoomConflict()` for room double-booking prevention.
- `server/routes/authRoutes.js` — Removed admin self-registration, hashed OTPs, removed `debug_otp`, enforced pending status for faculty, added `POST /change-password`, rate limiting.
- `server/routes/timetableRoutes.js` — Added single-use SSE ticket system, room collision checks in cell/bulk/import/upload routes, solver dry-run support.
- `server/routes/directoryRoutes.js` — Made audit logs immutable (403 on DELETE), added audit log export, added faculty approval endpoint (`/users/:id/approve`).
- `server/services/scheduleGenerator.js` — Fixed room assignment fallback pool, added dry-run preview mode.
- `server/test-api.js` — Updated for ticket-based SSE, room collision assertions, pending faculty assertions, immutable audit logs.
- `server/test-solver.js` — Updated for test environment isolation against `temp-test.db`.
- `server/test-realtime.js` — Updated for single-use SSE ticket handshake and isolated test DB.
- `client/src/App.jsx` — Integrated `ChangePasswordModal` for forced password rotation on login.
- `client/src/pages/AdminDashboard.jsx` — Added AI Schedule Generator button and modal integration.
- `client/src/hooks/useRealtimeTimetable.js` — Implemented two-phase ticket acquisition before EventSource connection.
- `README.md` — Corrected period schedules and 70-minute lunch break timings to match actual implementation.

---

## 5. Remaining Risks & Assumptions

1. **Single Node Deployment:** ASMS uses in-memory SSE client registries and session trackers. Running multiple backend instances behind a round-robin load balancer without sticky sessions or a shared pub/sub bus would break real-time SSE broadcasts. **Mitigation:** PM2 is configured for single-instance fork mode (`instances: 1`), which easily handles RGMCET AIML's 1,000+ concurrent students and faculty on a modern college server.
2. **Local Disk Storage:** SQLite database file resides on the server local filesystem (`server/data/academic.db`). If the physical server drive fails without backups, data loss could occur. **Mitigation:** `deploy/backup.sh` runs daily via cron and includes an optional `NAS_BACKUP_DIR` variable to copy compressed backups to an off-box NFS/SMB share automatically.
3. **SMS Gateway Credentials:** In production without SMS provider configuration (`SMS_PROVIDER=none`), faculty and administrators cannot reset passwords via SMS OTP. **Mitigation:** Administrators can reset passwords for any faculty or student directly from the Admin Dashboard. Once an SMS provider API key (e.g. MSG91) is acquired, it can be plugged into `.env` without code changes.

---

## 6. Manual Actions Required on the College Server

When deploying onto the college server, the administrator must perform the following manual steps:

1. **Ensure Node.js LTS (>= 22.13.0) is installed:**
   ```bash
   node -v
   # Must return v22.13.0 or higher
   ```
2. **Create the Production Environment File (`.env`):**
   ```bash
   cp deploy/.env.example .env
   ```
   Edit `.env` and set:
   - `JWT_SECRET`: Generate a secure 64-character random string (`openssl rand -hex 32`).
   - `ADMIN_INITIAL_PASSWORD`: Choose a strong initial administrative password.
   - `ALLOWED_ORIGINS`: Set to your college domain (e.g., `https://asms.rgmcet.edu.in`).
   - `HOST`: Set to `127.0.0.1`.
   - `SMS_PROVIDER`: Set to `msg91` or `fast2sms` and add API keys if SMS is desired, or leave `none`.
3. **Build the Frontend Assets:**
   ```bash
   npm run build
   ```
4. **Configure Nginx & SSL Certificates:**
   - Copy `deploy/nginx/asms.conf` to `/etc/nginx/sites-available/asms.conf`.
   - Update `server_name` to the college server hostname or intranet IP.
   - Provide valid TLS certificates (or generate an internal college CA certificate).
   - Symlink to `/etc/nginx/sites-enabled/` and reload Nginx (`sudo nginx -t && sudo systemctl reload nginx`).
5. **Start ASMS with PM2:**
   ```bash
   pm2 start deploy/ecosystem.config.cjs
   pm2 save
   pm2 startup
   ```
6. **Set up Daily Database Backup Cron:**
   ```bash
   sudo chmod +x deploy/backup.sh deploy/restore.sh deploy/restore-test.sh
   # Add to crontab (runs daily at 02:00 AM)
   (crontab -l 2>/dev/null; echo "0 2 * * * /path/to/asms/deploy/backup.sh >> /var/log/asms-backup.log 2>&1") | crontab -
   ```
7. **First Login Password Rotation:**
   - Log in using `admin01` and the initial password.
   - The system will immediately require setting a permanent, secure administrator password.

---

*Report prepared by Senior Full-Stack & Security Engineering Team for RGMCET AIML Department.*
