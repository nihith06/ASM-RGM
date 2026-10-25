# RGMCET AIML Academic Schedule Management System (ASMS)
## Codebase Inspection & Vulnerability Assessment Report

**Inspection Date**: 2026-10-25  
**Reviewer**: Senior Full-Stack Engineer & Security Reviewer  
**Target Git Branch**: `hardening/college-deploy`  
**Execution Environment**: Node.js v26.7.0 / Express 5.2.1 / SQLite via `node:sqlite`  

---

## 1. Executive Summary

A comprehensive, line-by-line inspection of the RGMCET AIML Academic Schedule Management System (ASMS) was conducted across both the Node.js/Express backend (`server/`) and the React 19/Vite/Tailwind frontend (`client/`).

Every item on the initial suspected-issue checklist (Items 1–18) has been **CONFIRMED** against the codebase. Additionally, several critical design bugs were identified, most notably:
1. **Destructive Reboot Behavior**: `seedDatabase()` runs unconditionally on every server launch, executing `DELETE FROM timetables` and deleting custom sections, completely wiping admin timetable modifications on reboot.
2. **Critical Privilege Escalation**: Unverified `Authorization` headers in `POST /api/auth/register` allow public creation of Administrator accounts.
3. **Severe Privacy Bypass**: Public self-registration of Faculty accounts allows an attacker to access student contact directories (phone numbers) and arbitrarily reset student passwords.
4. **Hardcoded Secrets & OTP Leaks**: `debug_otp` returned in HTTP responses, Math.random() used for OTP generation, plaintext OTP storage, and a hardcoded fallback `JWT_SECRET`.
5. **No Room Collision Checks**: Timetable cell updates, bulk updates, CSV imports, and validation do not check for room conflicts across sections, and the solver falls back to hardcoded rooms on conflict.
6. **Timezone Inconsistencies**: Server-side date resolution relies on UTC or host OS time rather than `Asia/Kolkata`.

---

## 2. File Structure

```
.
├── .gitattributes
├── .gitignore                      [MISSING - academic.db and WAL files tracked by git]
├── package.json                    [Dependencies: express 5, cors, bcryptjs, jsonwebtoken, multer, csv-parser]
├── package-lock.json
├── README.md                       [Contains discrepancies with actual implementation]
├── client/
│   ├── index.html
│   ├── package.json                [React 19, Vite 8, Tailwind 3, jsPDF, html2canvas, lucide-react]
│   ├── vite.config.js              [Proxy /api to http://localhost:5000]
│   ├── public/
│   │   ├── rgmcet_logo.png
│   │   └── ...
│   └── src/
│       ├── main.jsx
│       ├── App.jsx                 [Root view router, tab management, session heartbeat]
│       ├── App.css
│       ├── index.css
│       ├── api.js                  [Centralized frontend API client & SSE subscriber]
│       ├── sectionUtils.js         [Section naming helpers]
│       ├── timetableParser.js      [Pasted text / grid parser]
│       ├── components/
│       │   ├── AuthModal.jsx       [Login, register, forgot password modal]
│       │   ├── DirectoryView.jsx   [Student and faculty directory, student password reset]
│       │   ├── FacultyAvailabilityView.jsx [Public/authenticated faculty availability grid]
│       │   ├── Header.jsx          [Nav bar, branding, notification trigger]
│       │   ├── NotificationBox.jsx [Popup drawer for department notifications]
│       │   ├── OfficialPdfDocument.jsx [Pixel-accurate A4 landscape layout for jsPDF export]
│       │   └── TimetableGrid.jsx   [6-day x 7-period timetable grid, cell editor, CSV uploader]
│       └── pages/
│           ├── AdminDashboard.jsx  [Admin portal: stats, sections, timetable editor, user manager, audit logs]
│           ├── FacultyDashboard.jsx [Faculty personal schedule, overrides, directory, department timetables]
│           ├── LandingPage.jsx     [Hero section, role selection cards, self-registration links]
│           └── StudentDashboard.jsx [Student enrolled timetable, department timetables, faculty availability]
├── server/
│   ├── index.js                    [Express app setup, CORS, body parsers, routes, static client hosting]
│   ├── auth.js                     [JWT helpers, authenticateToken, requireFacultyOrAdmin, requireAdmin]
│   ├── db.js                       [SQLite database initialization, schema, migrations, seedDatabase()]
│   ├── timeUtils.js                [Time slots, period labels, clock-time conflict checker, date formatters]
│   ├── test-api.js                 [API integration test suite (writes to active DB)]
│   ├── test-realtime.js            [SSE real-time synchronization test suite]
│   ├── test-solver.js              [Constraint satisfaction scheduler test (writes to active DB)]
│   ├── data/
│   │   ├── academic.db             [Primary SQLite database]
│   │   └── backup-pre-hardening.db [Pre-hardening backup copy]
│   ├── routes/
│   │   ├── authRoutes.js           [Register, login, OTP forgot password, session heartbeat/unload]
│   │   ├── directoryRoutes.js      [Student/faculty directory, user CRUD, audit logs]
│   │   ├── facultyRoutes.js        [Availability computation, personal schedule, overrides, leaves]
│   │   ├── notificationRoutes.js   [Global notifications, automatic monthly purge, student daily filter]
│   │   └── timetableRoutes.js      [Timetables, sections, cell edit, bulk-grid, CSV import, solver, SSE]
│   └── services/
│       ├── realtimeService.js      [SSE client management and broadcasts]
│       └── scheduleGenerator.js    [CSP timetable generator engine]
└── scratch/                        [Ad-hoc scratch test scripts]
```

---

## 3. Features Actually Implemented

### 3.1 Authentication & Authorization
- **Role-Based Access Control (RBAC)**: Three distinct roles: `student`, `faculty`, `admin`.
- **Session Management**: Single active session enforcement for `faculty` and `admin` using SQLite `active_sessions` table and heartbeat pings (`/api/auth/session/heartbeat` every 10s).
- **Forgot Password via OTP**: Multi-step SMS OTP reset for `faculty` and `admin` with attempt rate limits (max 3 requests / 15 min, 5 verify attempts). Students are blocked from self-service OTP reset.
- **Admin Management**: Dedicated `/api/auth/register-admin` requiring an existing admin token.

### 3.2 Timetable Management
- **Curriculum & Schedule**: 6 working days (Monday – Saturday), 7 periods/day.
- **Differentiated Timings**: Separate time slots for Year 1 (classes up to 04:50 PM) vs Senior Years 2–4 (classes up to 04:20 PM or 05:00 PM).
- **Section Management**: Dynamic addition and deletion of sections per academic year.
- **Editing Tools**:
  - Manual single-cell or multi-period block editor.
  - Bulk grid replacement (`/bulk-grid`).
  - CSV string importer (`/import-csv`).
  - Pre-upload validation (`/validate-upload`) followed by atomic replacement (`/replace-section-timetable`).
- **Conflict Prevention**: Clock-time faculty conflict checking based on period overlap.
- **Constraint Satisfaction Solver**: Multi-constraint generator allocating theory, labs (3-hour continuous blocks), rotating daily emergency standby floaters (2 faculty unassigned per day), workload cap (16 hrs/week), morning slot limits, and HOD exclusion. *(Note: Backend implemented, but UI trigger missing from AdminDashboard)*.
- **Real-Time Push**: SSE (`/api/timetables/events`) notifying clients of timetable updates.
- **Exporting**: High-resolution client-side PDF export via `html2canvas` + `jsPDF` (`OfficialPdfDocument.jsx`) and browser print CSS.

### 3.3 Faculty Availability & Leave Management
- **Dynamic Availability Engine**: Real-time aggregation of teaching schedules across all sections + manual faculty overrides + approved daily leaves.
- **Manual Overrides**: Faculty can mark individual non-teaching periods as `busy` or `leave`.
- **Daily Leaves**: Faculty or Admin can record whole-day status (`leave`, `busy`, `active`). Leaves generate global notifications.
- **HOD Protection Rule**: Strict programmatic exclusion of HOD (Dr. G. Kishor Kumar) from teaching slot allocation.

### 3.4 Directory & Privacy Enforcement
- **Protected Directory**: `/api/directory/students` and `/api/directory/faculty` reject student requests with `403 Forbidden`. Student phone numbers and peer lists are hidden from students.
- **Student Password Reset by Mentors**: Faculty and Admins can reset any student's password with audit logging (`/api/directory/students/:id/reset-password`).
- **Audit Logging**: Logs creation of users, profile updates, student password resets, timetable replacements, and schedule generation.

---

## 4. API Endpoints & Auth/Role Guards

| Method | Endpoint | Auth Guard | Role Guard | Description / Security Notes |
|---|---|---|---|---|
| `GET` | `/api/health` | None | None | Basic health check. Does not check DB. |
| `POST` | `/api/auth/register` | None* | None* | **CRITICAL FLAW**: Unverified `Authorization` header creates admin. Public self-registration creates active faculty. |
| `POST` | `/api/auth/register-admin` | `authenticateToken` | `requireAdmin` | Admin-only creation of administrator accounts. |
| `POST` | `/api/auth/login` | None | None | **FLAW**: No rate limiting; vulnerable to credential brute-forcing. |
| `POST` | `/api/auth/logout` | Optional | None | Invalidate active session. |
| `POST` | `/api/auth/session/heartbeat` | `authenticateToken` | None | Updates session timestamp. |
| `POST` | `/api/auth/session/unload` | None | None | Marks session unloading when tab closes. |
| `POST` | `/api/auth/forgot-password/request-otp` | None | Faculty/Admin only (input check) | **CRITICAL FLAW**: Leaks `debug_otp` in JSON response. Insecure PRNG. |
| `POST` | `/api/auth/forgot-password/verify-otp` | None | None | Validates OTP code, issues reset token. |
| `POST` | `/api/auth/forgot-password/reset-password` | None | None | Resets password using reset token. |
| `GET` | `/api/auth/me` | `authenticateToken` | None | Returns authenticated user profile. |
| `GET` | `/api/timetables/events` | `authenticateToken` | None | **FLAW**: SSE stream accepts token in query string `?token=`. |
| `GET` | `/api/timetables/version` | `authenticateToken` | None | Returns version timestamp for polling fallback. |
| `GET` | `/api/timetables/sections` | `authenticateToken` | None | List sections for year. |
| `POST` | `/api/timetables/sections` | `authenticateToken` | `requireAdmin` | Create section. |
| `DELETE` | `/api/timetables/sections/:id` | `authenticateToken` | `requireAdmin` | Delete section and associated timetable slots. |
| `GET` | `/api/timetables` | `authenticateToken` | None | Fetch timetable grid and faculty contact details (students see masked phone). |
| `POST` | `/api/timetables/cell` | `authenticateToken` | `requireAdmin` | Update single cell or period block. **FLAW**: No room clash check. |
| `POST` | `/api/timetables/bulk-grid` | `authenticateToken` | `requireAdmin` | Bulk update cells. **FLAW**: No room clash check. |
| `POST` | `/api/timetables/import-csv` | `authenticateToken` | `requireAdmin` | Import CSV text. **FLAW**: No room clash check. |
| `POST` | `/api/timetables/generate` | `authenticateToken` | `requireAdmin` | CSP schedule generator. **FLAW**: Solver room fallback causes collisions. |
| `POST` | `/api/timetables/validate-upload` | `authenticateToken` | `requireAdmin` | Validate timetable cells. **FLAW**: No room clash check. |
| `POST` | `/api/timetables/replace-section-timetable` | `authenticateToken` | `requireAdmin` | Atomic replacement of section schedule. |
| `GET` | `/api/faculty/availability` | `authenticateToken` | None | Availability grid for day/faculty. |
| `GET` | `/api/faculty/my-schedule` | `authenticateToken` | None | Personal timetable & overrides for logged-in faculty. |
| `POST` | `/api/faculty/overrides` | `authenticateToken` | None | Set slot availability (busy/leave). |
| `DELETE` | `/api/faculty/overrides/:day/:period` | `authenticateToken` | None | Clear slot override. |
| `GET` | `/api/faculty/leaves` | `authenticateToken` | None | Query faculty leaves. |
| `POST` | `/api/faculty/leaves` | `authenticateToken` | Faculty/Admin | Mark date leave or busy. |
| `DELETE` | `/api/faculty/leaves/:id` | `authenticateToken` | Owner/Admin | Cancel leave record. |
| `GET` | `/api/notifications` | `authenticateToken` | None | Global announcements. Purges > 1 mo; students see only current day. |
| `POST` | `/api/notifications/clear` | `authenticateToken` | None | Always returns 403 Forbidden. |
| `DELETE` | `/api/notifications/:id` | `authenticateToken` | `requireAdmin` | Delete individual notification. |
| `GET` | `/api/directory/students` | `authenticateToken` | `requireFacultyOrAdmin` | Student list with phone numbers. |
| `GET` | `/api/directory/faculty` | `authenticateToken` | `requireFacultyOrAdmin` | Faculty list with status and leave details. |
| `GET` | `/api/directory/stats` | `authenticateToken` | None | Department metrics summary. |
| `PUT` | `/api/directory/users/:id` | `authenticateToken` | `requireAdmin` | Update user profile. |
| `DELETE` | `/api/directory/users/:id` | `authenticateToken` | `requireAdmin` | Delete user account. |
| `POST` | `/api/directory/students/:id/reset-password` | `authenticateToken` | `requireFacultyOrAdmin` | Mentor password reset for student. |
| `GET` | `/api/directory/audit-logs` | `authenticateToken` | `requireAdmin` | Retrieve last 100 audit entries. |
| `DELETE` | `/api/directory/audit-logs` | `authenticateToken` | `requireAdmin` | **CRITICAL FLAW**: Clears entire security audit trail. |

---

## 5. Database Schema & Persistence

Native SQLite is utilized via Node's built-in `node:sqlite.DatabaseSync`.
- **Foreign Keys**: `PRAGMA foreign_keys = ON;`
- **Concurrency**: `PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;`

### Tables
1. `users`: Credentials, personal info, role, year, status (`active`, `pending`, `suspended`), designation, qualification.
2. `sections`: Sections by academic year, name, semester, academic year string, batch, effective date. `UNIQUE(year, name)`.
3. `timetables`: Grid slots with year, section_id, day, period (1-7), subject, faculty_name, room. `UNIQUE(year, section_id, day, period)`.
4. `faculty_overrides`: Faculty slot overrides (`busy`, `leave`). `UNIQUE(faculty_id, day, period)`.
5. `audit_logs`: Audit trail for actions, performing user, target user, timestamp.
6. `password_resets`: OTP records, phone, user_id, attempts, verified, reset_token, expiry.
7. `faculty_leaves`: Daily whole-day leaves. `UNIQUE(faculty_id, leave_date)`.
8. `global_notifications`: Broadcast announcements, leave intimations, timetable update logs.
9. `rooms`: Room inventory (`theory`, `lab`), capacity.
10. `faculty_workload_config`: Faculty competencies (assigned subjects/labs in JSON), workload cap.
11. `active_sessions`: Single active session tracker with heartbeat timestamps.

---

## 6. Environment Variables

| Variable | Currently Recognized? | Description & Status |
|---|---|---|
| `PORT` | Yes (`server/index.js:18`) | Port number (default 5000). |
| `JWT_SECRET` | Yes (`server/auth.js:4`) | Insecure: Falls back to hardcoded string if undefined. |
| `DB_PATH` | **No** (`server/db.js:17`) | Hardcoded to `server/data/academic.db`. Must be configurable. |
| `NODE_ENV` | **No** | Missing. Errors and stack traces not gated on production mode. |
| `ALLOWED_ORIGINS`| **No** | Missing. CORS is wildcard `*`. |
| `TRUST_PROXY` | **No** | Missing. Express `trust proxy` is disabled. |
| `SMS_PROVIDER` | **No** | Missing. No gateway abstraction for OTP delivery. |
| `ADMIN_INITIAL_PASSWORD` | **No** | Missing. Admin default password is hardcoded in source. |
| `HOST` | **No** | Missing. Server binds to 0.0.0.0 by default instead of 127.0.0.1. |
| `TZ` | **No** | Missing. Timezone depends on host OS instead of Asia/Kolkata. |

---

## 7. Discrepancies with README

1. **Academic Period Timings**:
   - README Section 4 lists:
     - Period 4: 11:40 AM – 12:30 PM
     - Lunch Break: 12:30 PM – 01:20 PM
     - Period 5: 01:20 PM – 02:10 PM
     - Period 7: 03:00 PM – 03:50 PM
   - Actual code (`server/timeUtils.js`):
     - Senior Years: Period 4 is 11:50 AM – 12:40 PM; Lunch is 12:40 PM – 01:50 PM; Period 5 is 01:50 PM – 02:40 PM; Period 7 is 03:30 PM – 04:20 PM (or 05:00 PM).
     - Year 1 has an entirely different schedule (Classes end at 04:50 PM).
2. **Admin Self-Registration Claim**:
   - README claims "Admin Accounts: Seeded and managed separately (not self-registered)".
   - Code reality: `POST /api/auth/register` creates admins whenever any dummy `Authorization` header is passed.
3. **Automated Test Count**:
   - README mentions "Runs 20 automated tests".
   - `server/test-api.js` actually contains 28 assertions and performs write operations directly against the live database.
4. **Missing Documentation for Major Features**:
   - The README fails to document the SMS OTP forgot-password subsystem, single-login active session management, daily faculty leaves, global notifications, and the constraint satisfaction schedule generator.

---

## 8. Confirmation & Refutation of Suspected Issues (Items 1–18)

### Item 1: `POST /api/auth/forgot-password/request-otp` returns `debug_otp` in the response.
- **Status**: **CONFIRMED**
- **Severity**: Critical
- **Location**: `server/routes/authRoutes.js:349`
- **Evidence**: `return res.json({ ...genericResponse, debug_otp: otpCode });`
- **Impact**: Any unauthenticated user who knows a faculty member's phone number receives the active OTP in the HTTP response, allowing complete account takeover.
- **Proposed Fix**: Remove `debug_otp` from all responses. Plumb OTP output through an `SMS_PROVIDER` interface (`console` in dev, real gateway in prod; if none configured in prod, return error).

### Item 2: `POST /api/auth/register` lets anyone create an admin by sending any Authorization header.
- **Status**: **CONFIRMED**
- **Severity**: Critical
- **Location**: `server/routes/authRoutes.js:31-35`
- **Evidence**:
  ```javascript
  if (cleanRole === 'admin') {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
      return res.status(403).json({ error: 'Self-registration is not permitted...' });
    }
  }
  ```
  The header is checked for existence only; it is never verified with `jwt.verify` or matched to an existing admin.
- **Impact**: Unauthenticated users can register administrator accounts by sending `Authorization: Bearer fake`.
- **Proposed Fix**: Remove the `cleanRole === 'admin'` branch completely from `POST /api/auth/register`. Admins must strictly be created via `POST /api/auth/register-admin` with `authenticateToken` and `requireAdmin`.

### Item 3: `JWT_SECRET` falls back to a hardcoded default in `server/auth.js`.
- **Status**: **CONFIRMED**
- **Severity**: High
- **Location**: `server/auth.js:4`
- **Evidence**: `const JWT_SECRET = process.env.JWT_SECRET || 'rgmcet_aiml_academic_schedule_secret_key_2026';`
- **Impact**: If `JWT_SECRET` is omitted, tokens can be forged offline by anyone with access to the source code.
- **Proposed Fix**: Require `JWT_SECRET` at server boot. In production, exit immediately with a clear error if missing or shorter than 32 characters.

### Item 4: CORS is origin `'*'`.
- **Status**: **CONFIRMED**
- **Severity**: Medium
- **Location**: `server/index.js:21-25`
- **Evidence**: `app.use(cors({ origin: '*', ... }));`
- **Impact**: Allows cross-origin requests from any arbitrary domain, bypassing intranet origin controls.
- **Proposed Fix**: Restrict CORS origins via `ALLOWED_ORIGINS` env var (defaulting to same-origin / localhost in development).

### Item 5: No rate limiting on `/api/auth/login`.
- **Status**: **CONFIRMED**
- **Severity**: High
- **Location**: `server/index.js` and `server/routes/authRoutes.js:133`
- **Evidence**: Neither `express-rate-limit` nor custom rate limiting middleware is applied to `/api/auth/login`.
- **Impact**: Attacker can execute automated high-speed brute force credential stuffing against user accounts.
- **Proposed Fix**: Add `express-rate-limit` configured for 5 failed attempts per 15-minute window per IP + `register_id`.

### Item 6: SSE endpoint accepts the JWT in the query string (`?token=`).
- **Status**: **CONFIRMED**
- **Severity**: Medium
- **Location**: `server/routes/timetableRoutes.js:47-49`, `server/auth.js:25`, `client/src/api.js:229`
- **Evidence**: `const token = (authHeader && authHeader.split(' ')[1]) || req.query?.token;`
- **Impact**: Long-lived JWT tokens are exposed in server access logs, reverse proxy logs, browser histories, and referrer headers.
- **Proposed Fix**: Implement short-lived, single-use ticket pattern: `POST /api/timetables/events/ticket` (auth via Bearer header) returns a 30-second ticket, then `GET /api/timetables/events?ticket=...` consumes and immediately revokes it.

### Item 7: Public self-registration allows creating FACULTY accounts and hijacking student accounts.
- **Status**: **CONFIRMED END-TO-END**
- **Severity**: Critical
- **Location**: `server/routes/authRoutes.js:36-38`, `server/routes/directoryRoutes.js:10,270`
- **Evidence**:
  1. `POST /api/auth/register` accepts `role: 'faculty'` and creates an active user without verification.
  2. The attacker logs in as faculty.
  3. `GET /api/directory/students` allows faculty to view all student phone numbers.
  4. `POST /api/directory/students/:id/reset-password` allows faculty to overwrite any student's password.
- **Impact**: Complete compromise of student PII and takeover of any student account by an untrusted external user.
- **Proposed Fix**: Faculty accounts cannot be self-registered freely. They must either be created by an Admin, or registered with `status = 'pending'` requiring Admin approval before permissions are granted.

### Item 8: Seeded default accounts and passwords in README, and `seedDatabase()` runs on every boot.
- **Status**: **CONFIRMED**
- **Severity**: Critical
- **Location**: `server/index.js:30`, `server/db.js:284,333,360,429,602`
- **Evidence**:
  - `seedDatabase()` runs on every boot.
  - `populateTimetablesData()` runs `DELETE FROM timetables` on every boot.
  - `syncSectionsAndFaculty()` deletes non-official sections, custom timetables, and users with `status = 'pending'`.
  - Passwords `1352468` (admin), `12345678` (faculty), and `student123` (students) are hardcoded in source.
- **Impact**: All admin timetable customizations and section configurations are permanently lost upon server restart! Default credentials remain active unless changed.
- **Proposed Fix**: Run seeding only if `users` table is completely empty. Read admin initial password from `ADMIN_INITIAL_PASSWORD` env var. Never drop existing timetables or sections during boot. Enforce password change on first login for seeded accounts.

### Item 9: OTPs stored in plaintext in `password_resets`; generated with `Math.random`.
- **Status**: **CONFIRMED**
- **Severity**: High
- **Location**: `server/routes/authRoutes.js:327,334`
- **Evidence**:
  - `Math.floor(100000 + Math.random() * 900000).toString()` uses a predictable PRNG.
  - Plaintext `otp_code` column in `password_resets`.
- **Impact**: PRNG sequence can be predicted; database dump immediately reveals valid OTPs.
- **Proposed Fix**: Use `crypto.randomInt(100000, 1000000)` and store only an HMAC or bcrypt hash of the OTP code.

### Item 10: No change-password endpoint for logged-in users.
- **Status**: **CONFIRMED**
- **Severity**: Medium
- **Location**: `server/routes/authRoutes.js`
- **Evidence**: The only password modification endpoints are `/forgot-password/...` and mentor reset for students. A logged-in user cannot update their password.
- **Impact**: Users cannot periodically rotate passwords or change default passwords while logged in.
- **Proposed Fix**: Add `POST /api/auth/change-password` requiring `current_password`, `new_password`, enforcing complexity rules, invalidating sessions, and logging to `audit_logs`.

### Item 11: Admins can DELETE all audit logs.
- **Status**: **CONFIRMED**
- **Severity**: High
- **Location**: `server/routes/directoryRoutes.js:338-345`
- **Evidence**: `router.delete('/audit-logs', ... db.prepare('DELETE FROM audit_logs').run() ...)`
- **Impact**: A rogue or compromised admin can erase all evidence of unauthorized actions, destroying non-repudiation.
- **Proposed Fix**: Remove the `DELETE /api/directory/audit-logs` endpoint entirely (or restrict to immutable archiving/exporting).

### Item 12: 7-day JWTs not validated against DB on each request; deleted/disabled users not rejected.
- **Status**: **CONFIRMED**
- **Severity**: High
- **Location**: `server/auth.js:19,31-47`
- **Evidence**:
  - Token validity is 7 days for all users.
  - `authenticateToken` does not verify if the user exists in `users` or if `status === 'active'`.
  - For students, `active_sessions` is never checked.
  - For faculty/admin registered via `/register`, `session_id` is null, bypassing session checks.
- **Impact**: Deleted or suspended users retain API access for up to 7 days.
- **Proposed Fix**: Query user status (`SELECT id, status FROM users WHERE id = ?`) on every request. Shorten token lifetimes (e.g. 12h for staff/admin, 7d for students).

### Item 13: Express 5 behind reverse proxy: `trust proxy` not set.
- **Status**: **CONFIRMED**
- **Severity**: Medium
- **Location**: `server/index.js`
- **Evidence**: `app.set('trust proxy', ...)` is never invoked.
- **Impact**: Behind Nginx, `req.ip` resolves to `127.0.0.1` for all requests, distorting audit logs and causing IP rate limits to affect all users globally.
- **Proposed Fix**: Add `app.set('trust proxy', process.env.TRUST_PROXY ? parseInt(process.env.TRUST_PROXY, 10) : 1);`.

### Item 14: Room double-booking across sections is NOT checked.
- **Status**: **CONFIRMED**
- **Severity**: High
- **Location**: `server/routes/timetableRoutes.js:299,374,484,656`, `server/services/scheduleGenerator.js:345`
- **Evidence**:
  - `POST /cell`, `POST /bulk-grid`, `POST /import-csv`, and `POST /validate-upload` execute `checkFacultyConflict()` but never check if the specified `room` is already booked by another section at that time.
  - In `scheduleGenerator.js`, if rooms are exhausted, it silently falls back to returning `'AIML-LH1'` or `'AIML-LAB1'`, causing double-bookings.
- **Impact**: Two different sections can be scheduled in the same physical classroom simultaneously.
- **Proposed Fix**: Implement `checkRoomConflict(db, room, day, year, period, excludeCell)` and reject conflicts with `409 Conflict`. Update solver to fail cleanly if room capacity is exceeded.

### Item 15: Date/time handling depends on server timezone instead of `Asia/Kolkata`.
- **Status**: **CONFIRMED**
- **Severity**: Medium
- **Location**: `server/routes/notificationRoutes.js:36,44`, `server/routes/directoryRoutes.js:41`, `server/routes/facultyRoutes.js:364`, `server/timeUtils.js:35`
- **Evidence**:
  - Direct calls to `new Date()` and `date('now', 'localtime')`.
  - On a UTC server, between 12:00 AM and 05:30 AM IST, dates resolve to the previous day.
- **Impact**: Daily leaves, attendance, and student notification resets trigger at 05:30 AM IST instead of midnight IST.
- **Proposed Fix**: Set `TZ=Asia/Kolkata` in server runtime and export a centralized `getKolkataDate()` / `getKolkataDateString()` utility in `server/timeUtils.js`.

### Item 16: Input validation gaps (10mb body, lengths, formats).
- **Status**: **CONFIRMED**
- **Severity**: Medium
- **Location**: `server/index.js:26-27`, `server/routes/authRoutes.js:21`, `server/routes/timetableRoutes.js:446`
- **Evidence**:
  - Global `express.json({ limit: '10mb' })` on all routes.
  - No length or regex bounds on names, phone numbers, register IDs, subject names, or room numbers.
- **Impact**: Memory exhaustion DoS; database pollution with invalid character sets or oversized fields.
- **Proposed Fix**: Lower global JSON limit to 100kb (allow 2mb specifically for timetable upload routes). Enforce regex patterns and length limits on all user input.

### Item 17: Unused dependencies (`multer`, `csv-parser`); README lunch-time mismatch; tests writing to real DB.
- **Status**: **CONFIRMED**
- **Severity**: Medium
- **Location**: `package.json:20,23`, `README.md:36`, `server/test-api.js:50`, `server/test-solver.js:5,21`
- **Evidence**:
  - `multer` and `csv-parser` are never imported in the codebase.
  - README lunch hours (12:30–01:20 PM) contradict `timeUtils.js` (12:40–01:50 PM).
  - Test suites import `db.js` directly and modify `server/data/academic.db`.
- **Impact**: Unnecessary bundle size, confusion for faculty/students, test runs destroy live data.
- **Proposed Fix**: Remove unused dependencies, update README to match `timeUtils.js`, and support `DB_PATH` so tests run on isolated temp databases.

### Item 18: Error handling gaps, unhandled rejections, leaked stack traces.
- **Status**: **CONFIRMED**
- **Severity**: Medium
- **Location**: `server/index.js`, all `catch` blocks in `server/routes/*.js`
- **Evidence**:
  - `res.status(500).json({ error: error.message })` is returned everywhere, exposing database schema and constraint names.
  - No global error-handling middleware `(err, req, res, next)`.
  - No `unhandledRejection` or `uncaughtException` process listeners.
- **Impact**: Internal server diagnostics leaked to untrusted clients.
- **Proposed Fix**: Add global error middleware returning generic errors in production, and add process safety event listeners.

---

## 9. Additional Bugs & Missing Features Discovered

1. **Missing Schedule Generator UI Button**: The CSP solver is fully implemented in `scheduleGenerator.js` and accessible via `POST /api/timetables/generate`, but `AdminDashboard.jsx` has no button, modal, or preview for it.
2. **Missing Root `.gitignore`**: Git tracks `academic.db` and attempts to track SQLite lock files (`.db-shm`, `.db-wal`).
3. **Session Heartbeat Fragility**: In `auth.js`, active session timeout is set to 35 seconds. If a faculty member switches tabs or experiences a 36-second network lag, they are logged out.
4. **Hardcoded Faculty Exclusions in SQL**: Name string matching (e.g. `LOWER(name) NOT LIKE '%kishor kumar%'`) is hardcoded across multiple queries in `directoryRoutes.js` and `facultyRoutes.js` rather than relying on role/permission flags.

---

## 10. Summary Table of Proposed Fixes by Phase

| Category | Finding / Bug | Severity | Proposed Action in Hardening Plan |
|---|---|---|---|
| **Phase 2** | `debug_otp` leaked in response | Critical | Remove from response; add `SMS_PROVIDER` interface with console simulator |
| **Phase 2** | Unverified admin registration | Critical | Disallow admin role in `/register`; require `/register-admin` with RBAC |
| **Phase 2** | Faculty self-registration exploit | Critical | Require admin approval (`status = 'pending'`) or pre-seeded account claiming |
| **Phase 2** | Insecure OTP generation & storage | High | Use `crypto.randomInt`; store HMAC/hash in DB |
| **Phase 2** | Insecure fallback `JWT_SECRET` | High | Enforce mandatory min 32-char secret in production; fail boot if missing |
| **Phase 2** | Wildcard CORS origin | Medium | Restrict via `ALLOWED_ORIGINS` env var |
| **Phase 2** | No login rate limiting | High | Add `express-rate-limit` on login (5 fails / 15 min / IP + user) and OTP routes |
| **Phase 2** | SSE token in query string | Medium | Replace with single-use ticket pattern (`POST /events/ticket`) |
| **Phase 2** | Reboots wipe timetables | Critical | Seeding only when `users` table empty; preserve user-created sections |
| **Phase 2** | Seeded passwords in source | High | Read `ADMIN_INITIAL_PASSWORD` from env; force change on first login |
| **Phase 2** | Admins can clear audit logs | High | Remove `DELETE /api/directory/audit-logs` |
| **Phase 2** | 7-day token without DB revocation | High | Verify user exists and `status === 'active'` on every request; shorten token life |
| **Phase 2** | No password change endpoint | Medium | Implement `POST /api/auth/change-password` |
| **Phase 2** | Missing Helmet & Trust Proxy | Medium | Add `helmet` (with Vite/PDF CSP) and configure `trust proxy` |
| **Phase 2** | Body size & input validation | Medium | Lower body limit to 100kb (2mb for uploads); sanitize & validate inputs |
| **Phase 2** | Information disclosure in errors | Medium | Add global error handler hiding internal stack traces in production |
| **Phase 3** | Room double-booking not checked | High | Implement cross-section room collision detection in all timetable endpoints and solver |
| **Phase 3** | Timezone inconsistencies | Medium | Set `TZ=Asia/Kolkata` and use centralized date helper |
| **Phase 3** | Unused dependencies & test scripts | Low | Remove `multer` & `csv-parser`; fix README times; isolate tests via `DB_PATH` |
| **Phase 3** | Schedule generator missing from UI | Medium | Add schedule generator button with dry-run preview modal in `AdminDashboard.jsx` |
| **Phase 4** | College on-premise deployment files | Ops | Deliver PM2 single-instance config, systemd unit, Nginx conf, backup/restore scripts |
