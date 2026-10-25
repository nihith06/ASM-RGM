# RGMCET AIML Academic Schedule Management System (ASMS)
## Architecture Transformation & Student Removal Report

**Target Environment:** On-Premise College Linux Server (Ubuntu 22.04 / 24.04 LTS), Intranet / Campus LAN  
**Branch:** `feature/remove-students`  
**Date:** October 2026  
**Status:** Completed, Migrated, Tested (100% Pass), Production-Ready  

---

## 1. Executive Summary

This document details the complete architectural transformation of the RGMCET AIML Academic Schedule Management System (ASMS) from a 3-role authentication system (`student`, `faculty`, `admin`) to a streamlined **2-role system (`faculty`, `admin`) with Anonymous Read-Only Public Visitor Access**.

### Core Architecture After Transformation:
1. **Zero Student Authentication / Storage:**
   - Students no longer register, log in, manage passwords, or maintain accounts.
   - All student records, sessions, and dependent data were safely purged from the SQLite database.
   - The database schema constraint was updated to `CHECK(role IN ('faculty', 'admin'))`, and the `users.year` column was dropped.
2. **Open Public Schedule & Availability Access:**
   - Students and campus visitors can open the website without an account and immediately view:
     - 6-day academic weekly timetables across all 4 cohorts (Years 1–4, Sections A–D).
     - Interactive schedule date picker cross-referencing real-time faculty leaves.
     - Faculty Availability Matrix displaying live free/busy schedules.
     - Current-day academic intimations and leave notices.
     - Official A4 Landscape PDF downloads.
3. **Strict Privacy by Design:**
   - Faculty phone numbers and internal employee IDs are strictly excluded from all public API responses and public PDF downloads.
   - Genuine contact details are restricted exclusively to authenticated staff (Faculty and Admin).
4. **Self-Contained & Production-Ready:**
   - 100% self-contained on-premise operation with zero cloud dependencies.
   - Real-time Server-Sent Events (SSE) push streaming with per-IP rate limiting and connection pool safeguards.
   - Clean client production build with zero errors.

---

## 2. Phase-by-Phase Implementation Details

### Phase 1: Inspection & Plan
- **Artifact:** [`docs/STUDENT_REMOVAL_PLAN.md`](./STUDENT_REMOVAL_PLAN.md)
- Complete audit of every student-related file, route, database column, component, and test case.
- Documented file locations, line numbers, planned actions (delete, modify, retire), and risk mitigations.

---

### Phase 2: Database Migration & Schema Update
- **Implementation:** Added idempotent migration `001_remove_students` in `server/db.js`.
- **Automatic Safety Snapshot:** On first execution, automatically creates a timestamped copy of the database (`*.bak`).
- **Transactional Purge:**
  - Deletes all rows where `role = 'student'` from `users`.
  - Cascades deletions to `active_sessions`, `password_resets`, and student-targeted records in `security_audit_logs`.
- **Table Rebuild (SQLite Table Recreation Pattern):**
  - Recreated `users` table with updated constraint: `CHECK(role IN ('faculty', 'admin'))`.
  - Dropped obsolete `users.year` column.
  - Preserved all indexes and validated foreign keys with `PRAGMA foreign_key_check`.
- **Tracking:** Created `schema_migrations` table to guarantee the migration runs exactly once.
- **Seeding:** Removed all student seed data from `seedDatabase()`.
- **Integrity Verification:**
  - Baseline before migration: 24 users (2 students, 19 faculty, 3 admin).
  - Baseline after migration: 22 users (0 students, 19 faculty, 3 admin).
  - Surviving faculty and admin password hashes match `backup-pre-student-removal.db` 100%.

---

### Phase 3: Backend API Changes

#### 1. Authentication & Token Management (`server/auth.js`, `server/routes/authRoutes.js`)
- Universal 12-hour JWT token expiration for all active sessions.
- Removed `year` claim from JWT signing and verification queries.
- Added `optionalAuthenticateToken` middleware to support optional authentication on public endpoints.
- `POST /api/auth/register`:
  - Rejects `role: 'student'` with `400 Bad Request: Student accounts do not exist. Timetables are publicly accessible without an account.`
- `POST /api/auth/login`:
  - Rejects `expected_role: 'student'` with `400 Bad Request`.
  - Removed student role branches from authentication handlers.
- `POST /api/auth/forgot-password/request-otp`:
  - Rejects `role: 'student'` with `400 Bad Request`.

#### 2. Retired Student Endpoints (`server/routes/directoryRoutes.js`)
- `GET /api/directory/students`: Retired, returns `404 Not Found: Student directory has been removed.`
- `POST /api/directory/students/:id/reset-password`: Retired, returns `404 Not Found: Student password reset endpoint has been removed.`
- `GET /api/directory/stats`: Removed `students` count and `year_distribution` from metrics.
- `PUT /api/directory/users/:id`: Removed `year` column update support.

#### 3. Public Read-Only Timetable & Real-Time APIs (`server/routes/timetableRoutes.js`, `server/services/realtimeService.js`)
- `GET /api/timetables`:
  - Removed mandatory `authenticateToken` requirement; guarded with `publicGetLimiter` and `optionalAuthenticateToken`.
  - **Data Privacy**: Anonymous callers receive safe whitelisted fields (`subject`, `faculty_name`, `room`). Phone numbers are omitted. Authenticated faculty and admins receive genuine contact numbers for official administration.
- `GET /api/timetables/sections`: Made public with `publicGetLimiter`.
- `GET /api/timetables/version`: Made public with `publicGetLimiter`.
- `GET /api/timetables/events`:
  - Public Server-Sent Events (SSE) live push stream.
  - Enforced per-IP rate limit (10 connection attempts/minute).
  - Enforced global server pool limit (max 500 concurrent connections) and per-IP pool limit (max 10 concurrent connections).
  - Periodic keep-alive ping every 20 seconds.
  - Clean disconnect memory management.
  - Rejects query-string tokens (`?token=`) with `401 Unauthorized` to prevent token leakage in proxy logs.

#### 4. Public Faculty Availability & Leave APIs (`server/routes/facultyRoutes.js`)
- `GET /api/faculty/availability`:
  - Public read-only access.
  - Anonymous callers receive safe fields (`name`, `department`, `designation`, `status`, `schedule`). Internal database `id`, employee `register_id`, and `phone` are strictly stripped.
  - Authenticated staff callers receive full metadata including `register_id`.
- `GET /api/faculty/leaves`:
  - Public read-only access.
  - Anonymous callers receive safe fields (`date`, `faculty_name`, `status`, `reason`). Internal IDs and phone numbers are stripped.

#### 5. Public Notification API (`server/routes/notificationRoutes.js`)
- `GET /api/notifications`:
  - Public read-only access.
  - Anonymous visitors receive active current-day intimations only (`leave_date = CURRENT_DATE`).
  - Authenticated staff callers receive 1-month persistence for historical tracking.

---

### Phase 4: Frontend Architectural Changes

#### 1. Page Removal
- Deleted `client/src/pages/StudentDashboard.jsx` from repository.

#### 2. Public Academic Schedule Portal (`client/src/pages/LandingPage.jsx`)
- Replaced 3-card role selection with the comprehensive public academic schedule portal:
  - Official RGMCET AIML branding banner featuring Head of Department Dr. G. Kishor Kumar.
  - Quick action portal buttons: "Faculty Portal" and "Admin Portal".
  - Main public tabs:
    - **Academic Timetables (Years 1–4)**: Full interactive grid with Year switchers (1st–4th Year), Section switchers (Sections A–D), date picker for cross-referenced leaves, and high-DPI A4 Landscape PDF export.
    - **Faculty Availability Matrix**: Live period-by-period faculty availability view.

#### 3. Client Session & API Client (`client/src/api.js`)
- Unified session storage to pure `sessionStorage` (cleared on tab close).
- Eliminated `localStorage` student session split.
- Removed retired methods: `getStudents()` and `resetStudentPassword()`.
- Public SSE event subscription without token requirement, falling back to version polling.

#### 4. Header Bar (`client/src/components/Header.jsx`)
- Removed student registration link, student role badge, and year indicator.
- Unauthenticated navigation surfaces:
  - Public academic notification bell.
  - "Faculty Portal" button.
  - "Admin Portal" button.
- Authenticated navigation preserves staff badge, password change modal, and session logout.

#### 5. Faculty Directory View (`client/src/components/DirectoryView.jsx`)
- Refactored into a focused **Faculty Directory**.
- Completely removed the "Students" tab, student search filter, year dropdown, and student password reset modal.
- Retained faculty profiles, designations, contact numbers (for logged-in staff), and administrative profile editor.

#### 6. Admin Control Center (`client/src/pages/AdminDashboard.jsx`)
- Removed "Total Students" stat card (retained 3 cards: Faculty Members, Active Sections, Timetable Slots).
- Removed "Manage Students" tab and student table.
- Removed student password reset modal and override handlers.
- Updated account registration modal to offer only "Faculty" and "Admin" options.

#### 7. Official PDF Export (`client/src/components/OfficialPdfDocument.jsx`)
- Replaced `isStudent` check with `isStaff = user && (user.role === 'faculty' || user.role === 'admin')`.
- When exporting PDFs as a public visitor, phone numbers are masked as `'—'` and tagged as `(Protected)`. Genuine phone numbers appear only for authenticated administrative staff.

#### 8. Timetable Grid Component (`client/src/components/TimetableGrid.jsx`)
- Removed student conditional restrictions.
- Schedule Date filter and real-time leave status indicators (`⚠️ Faculty on Leave`) are universally displayed for all visitors.

#### 9. Notification Popover (`client/src/components/NotificationBox.jsx`)
- Cleaned up student-specific state.
- Gracefully renders for anonymous public visitors displaying active daily intimations.

#### 10. Application Root (`client/src/App.jsx`)
- Removed `StudentDashboard` import and render route.
- Default authentication modal role initialized to `'faculty'`.
- Root routing:
  - `!user` -> Public `LandingPage` (timetables, availability, notifications).
  - `user.role === 'faculty'` -> `FacultyDashboard`.
  - `user.role === 'admin'` -> `AdminDashboard` or `DirectoryView`.

---

### Phase 5: Test Suite Updates & Documentation

#### 1. Automated Test Suite Updates
- **`server/test-api.js`**:
  - Replaced student registration/login tests with assertions verifying that `role: 'student'` is rejected with `400 Bad Request`.
  - Added assertions verifying `GET /api/directory/students` and `POST /api/directory/students/:id/reset-password` return `404 Not Found`.
  - Added assertions verifying unauthenticated public GETs succeed without token for `/api/timetables`, `/api/timetables/sections`, `/api/timetables/version`, `/api/faculty/availability`, `/api/faculty/leaves`, and `/api/notifications`.
  - Added assertions verifying public responses strictly strip internal IDs and phone numbers.
  - Added assertions verifying authenticated admin calls receive genuine contact numbers for PDF export.
  - Result: **183 / 183 tests passed**.
- **`server/test-solver.js`**:
  - Verified constraint solver against isolated test database.
  - Result: **11 / 11 tests passed**.
- **`server/test-realtime.js`**:
  - Verified single-use SSE ticket system, rejection of query tokens (`?token=`), and live push dispatch.
  - Result: **15 / 15 tests passed**.
- **`server/test-verify-phase5.js`**:
  - Added checks verifying student login rejection, student registration rejection (400), retired directory endpoints (404), and unauthenticated access guards.
  - Verified public PDF phone exclusion vs admin PDF phone inclusion.
  - Result: **26 / 26 tests passed**.
- **Full Test Runner (`npm test`)**:
  - **235 tests executed across 4 test suites: 235 passed, 0 failed (100% pass rate)**.

#### 2. Documentation Updates
- **`README.md`**: Completely revised to document the 2-role system with anonymous visitor access, updated credentials table, and updated API route list.
- **`docs/STUDENT_REMOVAL_PLAN.md`**: Completed and tracked.
- **Repository Grep**: Verified with `git grep -i "student"` that no unretired student functional code remains.

---

### Phase 6: Final Verification

#### 1. Client Production Build
```bash
npm run build
```
- Transformed 2,050 modules.
- Generated compiled production bundle (`dist/index.html`, `dist/assets/*`) in 1.27s with zero errors.

#### 2. Complete Test Suite
```bash
npm test
```
- Total test suites: 4
- Total tests: 235
- Passed: 235
- Failed: 0
- Execution time: ~20s

---

## 3. Files Modified & Deleted Inventory

### Deleted Files
- `client/src/pages/StudentDashboard.jsx`

### Modified Backend Files
- `server/auth.js`
- `server/db.js`
- `server/routes/authRoutes.js`
- `server/routes/directoryRoutes.js`
- `server/routes/facultyRoutes.js`
- `server/routes/notificationRoutes.js`
- `server/routes/timetableRoutes.js`
- `server/services/realtimeService.js`

### Modified Frontend Files
- `client/src/App.jsx`
- `client/src/api.js`
- `client/src/components/AuthModal.jsx`
- `client/src/components/DirectoryView.jsx`
- `client/src/components/FacultyAvailabilityView.jsx`
- `client/src/components/Header.jsx`
- `client/src/components/NotificationBox.jsx`
- `client/src/components/OfficialPdfDocument.jsx`
- `client/src/components/TimetableGrid.jsx`
- `client/src/pages/AdminDashboard.jsx`
- `client/src/pages/FacultyDashboard.jsx`
- `client/src/pages/LandingPage.jsx`

### Modified Test & Documentation Files
- `server/test-api.js`
- `server/test-solver.js`
- `server/test-realtime.js`
- `server/test-verify-phase5.js`
- `README.md`
- `docs/STUDENT_REMOVAL_PLAN.md`
- `docs/CHANGES.md`

---

## 4. Summary of Verification Checkpoints

| Verification Checkpoint | Expected Behavior | Observed Result | Status |
|---|---|---|---|
| Student Registration | `POST /api/auth/register` with `role: 'student'` | HTTP 400 Bad Request | ✅ PASS |
| Student Login | `POST /api/auth/login` with student ID | HTTP 400 / 401 | ✅ PASS |
| Student Directory | `GET /api/directory/students` | HTTP 404 Not Found | ✅ PASS |
| Student Password Reset | `POST /api/directory/students/:id/reset-password` | HTTP 404 Not Found | ✅ PASS |
| Public Timetable Access | `GET /api/timetables?year=3` without token | HTTP 200 OK with full grid | ✅ PASS |
| Public Timetable Phone Privacy | `GET /api/timetables` without token | Phones undefined / `'—'` | ✅ PASS |
| Admin Timetable Phone Access | `GET /api/timetables` with admin token | Genuine phone numbers | ✅ PASS |
| Public Sections Access | `GET /api/timetables/sections` without token | HTTP 200 OK | ✅ PASS |
| Public Version Access | `GET /api/timetables/version` without token | HTTP 200 OK (timestamp > 0) | ✅ PASS |
| Public SSE Stream | `GET /api/timetables/events` without token | HTTP 200 text/event-stream | ✅ PASS |
| Query String Token Protection | `GET /api/timetables/events?token=...` | HTTP 401 Unauthorized | ✅ PASS |
| Public Availability Matrix | `GET /api/faculty/availability` without token | HTTP 200 (IDs/phones stripped) | ✅ PASS |
| Public Leaves API | `GET /api/faculty/leaves` without token | HTTP 200 (IDs/phones stripped) | ✅ PASS |
| Public Notifications Filter | `GET /api/notifications` without token | Current day notifications only | ✅ PASS |
| Client Production Build | `npm run build` | Zero syntax/build errors | ✅ PASS |
| Database Schema Check | `users` table constraint | `role IN ('faculty', 'admin')` | ✅ PASS |
| Database User Counts | Surviving rows in `academic.db` | 22 users (19 faculty, 3 admin) | ✅ PASS |

---

*Report prepared by Senior Full-Stack & Security Engineering Team for RGMCET AIML Department.*
