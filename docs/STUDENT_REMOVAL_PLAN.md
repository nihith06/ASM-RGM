# Student Removal Plan: Transition to Anonymous Public Visitor Access

**Date:** 2026-10-25  
**Branch:** `feature/remove-students`  
**Target Architecture:**
- Exactly two user roles: `faculty` and `admin`.
- Students no longer register, log in, or maintain accounts.
- Students and general public access timetables, faculty availability, leave notices, and PDF export as anonymous, read-only visitors without authentication.
- Private faculty contact information (phone numbers, employee IDs) is strictly excluded from public responses.

---

## 1. Exhaustive Codebase Inventory

| File | Line(s) | What it does | Action | Risk |
| :--- | :--- | :--- | :--- | :--- |
| `server/db.js` | 33 | `users.role CHECK(role IN ('student', 'faculty', 'admin'))` | **Modify**: Change constraint to `CHECK(role IN ('faculty', 'admin'))` via table rebuild | Low (handled via migration) |
| `server/db.js` | 35 | `users.year INTEGER CHECK(year IS NULL OR year IN (1, 2, 3, 4))` | **Delete**: Remove `year` column from `users` table entirely | Low |
| `server/db.js` | 392–415 | Initial seed data inserting sample student accounts (`24091A3301`–`21091A3341`) | **Delete**: Remove sample student seeding block | Safe |
| `server/db.js` | 417–425 | Seed check ensuring demo student `22091A3324` exists | **Delete**: Remove demo student seeding | Safe |
| `server/auth.js` | 6 | Sets 7d JWT expiry for students vs 12h for faculty/admin | **Modify**: Set token expiry to `12h` universally | Safe |
| `server/auth.js` | 14 | Signs `year: user.year` into JWT claims | **Delete**: Remove `year` from JWT payload | Safe |
| `server/auth.js` | 39 | Queries `year` column in `authenticateToken` middleware | **Modify**: Remove `year` from `SELECT` query | Safe |
| `server/auth.js` | 57 | Session check checks `dbUser.role === 'faculty' \|\| dbUser.role === 'admin'` | **Modify**: Simplify to check `decodedUser.session_id` | Safe |
| `server/auth.js` | 74 | Docstring mentions student privacy rules | **Modify**: Update docstring | Safe |
| `server/routes/authRoutes.js` | 47 | Route comment: "Registration: Students & Faculty (Public)" | **Modify**: Change comment to Faculty self-registration | Safe |
| `server/routes/authRoutes.js` | 52, 91–97 | Extracts `year`, parses `studentYear`, validates 1–4 | **Delete**: Remove `year` parsing and validation | Safe |
| `server/routes/authRoutes.js` | 67–69 | Accepts `'student'` in allowed registration roles | **Modify**: Strictly reject `cleanRole === 'student'` with HTTP 400 | Safe |
| `server/routes/authRoutes.js` | 108, 113, 116, 120 | Handles designation, active status, and inserts `year` for student | **Modify**: Remove student branching and `year` column from insert | Safe |
| `server/routes/authRoutes.js` | 130 | Queries `year` from users table after registration | **Modify**: Remove `year` from `SELECT` query | Safe |
| `server/routes/authRoutes.js` | 140–146 | Returns active token immediately for student self-registration | **Delete**: Remove student token generation branch | Safe |
| `server/routes/authRoutes.js` | 209, 255–260 | Login endpoint comments and `expected_role` enforcement | **Modify**: Reject `expected_role === 'student'` or student login attempt | Safe |
| `server/routes/authRoutes.js` | 264 | Checks if role is `'faculty'` or `'admin'` before session tracking | **Modify**: Apply to all logged-in users | Safe |
| `server/routes/authRoutes.js` | 281 | Returns `year: user.year` in `userSafe` | **Delete**: Remove `year` property from login response | Safe |
| `server/routes/authRoutes.js` | 441–446 | OTP request rejects `'student'` with 403 | **Modify**: Reject role with 400 ("Only Faculty and Admin accounts exist") | Safe |
| `server/routes/authRoutes.js` | 657 | Queries `year` in `/me` endpoint | **Modify**: Remove `year` from `SELECT` query | Safe |
| `server/routes/directoryRoutes.js` | 9–39 | `GET /api/directory/students` returns list of all students | **Delete**: Remove entire endpoint (returns 404) | Safe |
| `server/routes/directoryRoutes.js` | 124, 137–145, 147, 151 | `/stats` queries `studentCount` and `year_distribution` | **Delete**: Remove `students` count and `year_distribution` | Safe |
| `server/routes/directoryRoutes.js` | 162, 188, 198, 207 | `PUT /users/:id` updates `year` column | **Modify**: Remove `year` handling and column update | Safe |
| `server/routes/directoryRoutes.js` | 268–316 | `POST /students/:id/reset-password` resets student passwords | **Delete**: Remove entire endpoint (returns 404) | Safe |
| `server/routes/notificationRoutes.js` | 27, 40–53 | Role check for `student` viewing current-day notifications only; requires token | **Modify**: Make route public; unauthenticated/guest requests receive current-day notifications | Safe |
| `server/routes/timetableRoutes.js` | 49–69 | `/events/ticket` and `/events` SSE stream require auth token / ticket | **Modify**: Make `/events` public; add connection limits (500 max, 10/IP) and 20s ping | Safe |
| `server/routes/timetableRoutes.js` | 72–74 | `GET /version` requires `authenticateToken` | **Modify**: Make public (no token needed for polling fallback) | Safe |
| `server/routes/timetableRoutes.js` | 77–101 | `GET /sections` requires `authenticateToken` | **Modify**: Make public (needed for public year/section picker) | Safe |
| `server/routes/timetableRoutes.js` | 164 | `GET /api/timetables` requires `authenticateToken` | **Modify**: Make public (no token required) | Safe |
| `server/routes/timetableRoutes.js` | 270–275 | Checks `isStudent` to mask faculty phone with `'Protected'` | **Modify**: Always mask/omit phone numbers for public/unauthenticated requests | Safe |
| `server/routes/facultyRoutes.js` | 13–213 | `GET /api/faculty/availability` requires `authenticateToken` | **Modify**: Make public; whitelist public fields (`name`, `department`, `designation`, `status`, schedule); strip `phone`, `id`, `register_id`, `qualification` | Safe |
| `server/routes/facultyRoutes.js` | 439–469 | `GET /api/faculty/leaves` requires `authenticateToken` | **Modify**: Make public so visitors see current/upcoming leave intimations | Safe |
| `server/services/realtimeService.js` | 23–45, 47–84 | `registerClient` tracks `userId` and `role`; ticket consumption | **Modify**: Allow anonymous connections without ticket; enforce 500 total & 10 per IP limit | Safe |
| `client/src/pages/StudentDashboard.jsx` | 1–112 | Entire student dashboard view component | **Delete**: Remove file entirely | Safe |
| `client/src/pages/LandingPage.jsx` | 50–76 | Student role card ("Student login", "1st-4th Year") | **Modify**: Replace landing page with public timetable & availability home view | Safe |
| `client/src/App.jsx` | 6, 149–156 | Imports `StudentDashboard`, renders it for student role | **Modify**: Remove import, replace with public home view when unauthenticated | Safe |
| `client/src/App.jsx` | 29, 105 | Default role state initialized to `'student'` | **Modify**: Default role state to `'faculty'` or `null` | Safe |
| `client/src/api.js` | 10–23, 38–51, 64–69 | `localStorage` fallback permitted only for student role | **Modify**: Eliminate `localStorage` split; use pure `sessionStorage` for faculty/admin | Safe |
| `client/src/api.js` | 79–88 | `apiRequest` injects `Authorization` header | **Modify**: If no token stored, proceed without `Authorization` header | Safe |
| `client/src/api.js` | 232–233 | `subscribeToTimetableEvents` aborts if no token | **Modify**: Connect directly without token for public updates | Safe |
| `client/src/api.js` | 346–353, 372–376 | `getStudents` and `resetStudentPassword` client calls | **Delete**: Remove obsolete student directory API helpers | Safe |
| `client/src/components/AuthModal.jsx` | 27, 181, 210, 308, 618, 631, 643, 653–680, 740–755 | Student tab, student year dropdown, student register ID label, student password assistance note | **Modify**: Remove Student tab (only Faculty & Admin), remove year selector, remove student notice | Safe |
| `client/src/components/DirectoryView.jsx` | 19, 22, 27–28, 102–103, 110–136, 139–165, 210–216, 277–340, 411–525 | Students tab, student list state, search, table, reset password modal | **Modify**: Remove Students tab, table, and password modal; retain pure Faculty Directory | Safe |
| `client/src/pages/AdminDashboard.jsx` | 27, 29, 36, 43, 52–55, 84–97, 150–170, 225, 291–295, 342–351, 416–505, 848–940, 988–1085 | "Total Students" stat, "Manage Students" tab, student table, student reset modal, student user creation | **Modify**: Remove Total Students stat, Students tab, student reset modal, student creation option | Safe |
| `client/src/components/Header.jsx` | 54–61, 72–73, 108, 117–119 | "Student registration" button, student icon badge, student year text | **Modify**: Remove student registration link, replace with "Faculty Login" and "Admin Login" buttons | Safe |
| `client/src/components/NotificationBox.jsx` | 21, 209, 219–221, 232 | `isStudent` flag for daily notification wipe | **Modify**: Change to `isPublicVisitor` (!user), showing daily intimations for visitors | Safe |
| `client/src/components/OfficialPdfDocument.jsx` | 169, 433, 450 | `isStudent` check for masking phone numbers | **Modify**: Unconditionally protect/mask phone numbers on public PDF exports | Safe |
| `server/test-api.js` | Multiple | Tests registering student, logging in, student accessing directory | **Modify**: Update to assert public access works without token; student login/register rejected | Safe |
| `server/test-verify-phase5.js` | Multiple | Tests student login and 403 checks | **Modify**: Update to reflect student removal and public endpoint access | Safe |
| `README.md` | Multiple | Documents student role, student demo logins (`22091A3324`), student registration | **Modify**: Update documentation to reflect 2-role system with anonymous public visitor access | Safe |

---

## 2. API Endpoints Becoming Public (No `authenticateToken` Required)

The following endpoints will have authentication removed so anonymous visitors (students, parents, guests) can view schedules without logging in:

| Endpoint | Method | Public Payload Specification | Security / Rate Limit Safeguards |
| :--- | :--- | :--- | :--- |
| `/api/timetables` | `GET` | Returns 6-day timetable grid for requested year (1–4) and section. `faculty_details` array contains only `subject`, `faculty_name`, and `room`. **Phone numbers and internal user IDs are omitted.** | Rate limited by IP. Query parameters sanitized. |
| `/api/timetables/sections` | `GET` | Returns list of available sections filtered by year (1–4). | Rate limited by IP. |
| `/api/timetables/version` | `GET` | Returns `{ version: <timestamp> }` for polling fallback. | Lightweight; cache headers. |
| `/api/timetables/events` | `GET` | Real-time Server-Sent Events stream for timetable and notification updates. | Max 500 concurrent connections globally, max 10 per IP, 20s keepalive ping, clean disconnect cleanup. |
| `/api/faculty/availability` | `GET` | Weekly availability matrix. Public fields whitelisted: `name`, `department`, `designation`, `status`, and period status (`free`/`teaching`). **Omits `phone`, `register_id`, `qualification`, `id`.** | Rate limited by IP. |
| `/api/faculty/leaves` | `GET` | Read-only list of approved faculty leaves for specified date. | Rate limited by IP. |
| `/api/notifications` | `GET` | For anonymous visitors: returns **current-day** leave notifications only (IST midnight reset). If a valid Faculty/Admin token is sent, returns full 1-month notification history. | Rate limited by IP. |
| `/api/health` | `GET` | System health check (already public). | Safe. |

---

## 3. Endpoints to be Deleted (Return HTTP 404)

1. `GET /api/directory/students`
2. `POST /api/directory/students/:id/reset-password`

---

## 4. Places Reading `user.role` or `user.year`

### `user.role` References:
- **`server/auth.js`**: Universal 12h token expiry; `requireFacultyOrAdmin` and `requireAdmin` guards.
- **`server/routes/authRoutes.js`**: Validates role on registration (`cleanRole !== 'faculty'` -> reject); checks role on login (`user.role === 'admin' \|\| user.role === 'faculty'`); single-active-session tracking.
- **`server/routes/directoryRoutes.js`**: `requireFacultyOrAdmin` guard for Faculty Directory; `requireAdmin` for editing/deleting faculty and admin accounts; audit log formatting.
- **`server/routes/facultyRoutes.js`**: `requireFacultyOrAdmin` / role checks for scheduling leaves and overrides.
- **`server/routes/notificationRoutes.js`**: Distinguishes public/guest vs logged-in faculty/admin for 1-day vs 1-month lifespan.
- **`client/src/App.jsx`**: Renders `FacultyDashboard` for faculty, `AdminDashboard` for admin, and public landing/schedule for unauthenticated visitors.
- **`client/src/components/Header.jsx`**: Shows role pill badge for faculty and admin; shows "Faculty Login" and "Admin Login" when unauthenticated.
- **`client/src/components/DirectoryView.jsx`**: Displays authorized personnel tag (`ADMIN` or `FACULTY`).
- **`client/src/pages/AdminDashboard.jsx`**: Distinguishes faculty vs admin in user management tables and modals.

### `user.year` References:
- **`server/db.js`**: `users.year` column is **dropped** via table rebuild migration. (Section `year` column is retained).
- **`server/auth.js`**: `year` removed from JWT claims and `authenticateToken` database select.
- **`server/routes/authRoutes.js`**: `year` parameter removed from registration, login, and `/me`.
- **`server/routes/directoryRoutes.js`**: `year` removed from user updates (`PUT /users/:id`) and directory queries.
- **`client/`**: Removed from `AuthModal.jsx`, `Header.jsx`, `AdminDashboard.jsx`, and `DirectoryView.jsx`.

---

## 5. Database Migration Plan (Phase 2 Preview)

1. **Backup Verification**:
   - SHA256 of `server/data/academic.db` matches `server/data/backup-pre-student-removal.db`.
2. **Schema Migration Implementation**:
   - Create `schema_migrations` table if not exists (`id`, `migration_name`, `applied_at`).
   - Check if migration `001_remove_students` has run. If so, exit early (idempotent).
   - In a single atomic transaction:
     - Delete student rows from `active_sessions`, `password_resets`, and student-targeted `audit_logs`.
     - Disable foreign key pragma (`PRAGMA foreign_keys = OFF;`).
     - Create `users_new` table without `year` column and with `CHECK(role IN ('faculty', 'admin'))`.
     - Copy existing faculty and admin rows from `users` to `users_new`.
     - Drop `users` table.
     - Rename `users_new` to `users`.
     - Recreate indexes on `users(register_id)`.
     - Re-enable foreign key pragma (`PRAGMA foreign_keys = ON;`).
     - Record migration in `schema_migrations`.
3. **Seed Clean-up**:
   - Remove sample student accounts list from `seedDatabase()`.
   - Remove demo student check for `22091A3324`.
4. **Data Verification**:
   - Confirm faculty, admin, sections, timetables, and room count remain completely identical before and after.

---

## 6. Frontend Architectural Plan (Phase 4 Preview)

1. **New Public Home Experience**:
   - Replaces old 3-role landing page and StudentDashboard.
   - When visitor opens site (`!user`):
     - Displays RGMCET AIML branding banner.
     - Action buttons: "Faculty Login" and "Admin Login" in Header and hero area.
     - Year selector (1st, 2nd, 3rd, 4th Year) and Section selector tabs (Sections A, B, C, D).
     - Full read-only `TimetableGrid` with current date leave indicators.
     - Tabs/views for:
       - **Class Timetable** (default)
       - **Faculty Availability & Free Periods**
       - **Leave Notifications & Academic Notices** (current day only)
     - Official PDF Export button with masked faculty phone numbers.
2. **Eliminate Student Auth & State**:
   - Delete `client/src/pages/StudentDashboard.jsx`.
   - Remove all `localStorage` student session code in `client/src/api.js`.
   - Update `AuthModal.jsx`: Only Faculty and Admin login tabs; only Faculty self-registration (which creates pending status).
   - Update `DirectoryView.jsx`: Becomes purely the Faculty Directory.
   - Update `AdminDashboard.jsx`: Remove Total Students metric, Manage Students tab, and student password reset modals.
   - Update `Header.jsx`: Remove student registration link. Display Faculty Login and Admin Login buttons.
