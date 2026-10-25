# RGMCET AIML — Academic Schedule Management System (ASMS)

A production-ready fullstack web application for the **Department of Computer Science & Engineering and Artificial Intelligence & Machine Learning (AIML)** at **Rajeev Gandhi Memorial College of Engineering and Technology (Autonomous)**, Nandyal, Andhra Pradesh.

Designed with a clean, professional academic aesthetic: white background, RGMCET signature navy blue accents (`#002147`), card-based layouts, generous whitespace, rounded corners, and subtle shadows.

---

## 🌟 Architecture & Access Model (2-Role System + Anonymous Visitor Access)

The application operates with exactly two authenticated account roles (**Faculty** and **Admin**) alongside comprehensive **Anonymous Read-Only Public Visitor Access** for students and the general public:

1. **Anonymous Read-Only Visitors (Students & Public)**:
   - No login or registration required.
   - Immediate access upon opening the portal to:
     - 6-day academic weekly timetables across all 4 cohorts (1st, 2nd, 3rd, and 4th Year AIML, Sections A–D).
     - Interactive schedule date picker with cross-referenced real-time faculty leave indicators.
     - Dynamic Faculty Availability Matrix with live period-by-period free/busy schedules.
     - Real-time Server-Sent Events (SSE) push updates and current-day leave notification alerts.
     - High-DPI Official A4 Landscape PDF export.
   - **Privacy Protection**: Faculty contact details (phone numbers and employee IDs) are strictly excluded from all public API responses and PDF downloads.

2. **Faculty Members**:
   - Access to personal consolidated weekly teaching workload across all cohorts.
   - Dedicated Slot Availability Manager: mark free periods as Busy or Leave with custom notes.
   - Faculty Directory containing staff profiles and official designations.
   - Real-time notification broadcast when marking leaves.

3. **Administrators**:
   - Comprehensive departmental schedule oversight.
   - Interactive Timetable Grid editor: update subjects, faculty assignments, and room numbers with real-time clash prevention (faculty double-booking and room collisions).
   - AI Schedule Generator with constraint satisfaction and dry-run preview.
   - Section management: add or remove sections per academic year.
   - Faculty management: register new staff, complete profiles, and approve pending registrations.
   - Security Audit Trail: immutable logging of all credential modifications and administrative actions.

---

## ⏰ Academic Periods & Timings

### Senior Cohorts (2nd, 3rd, 4th Year)
- **Period 1**: 09:00 AM – 09:50 AM
- **Period 2**: 09:50 AM – 10:40 AM
- *Morning Break: 10:40 AM – 11:00 AM*
- **Period 3**: 11:00 AM – 11:50 AM
- **Period 4**: 11:50 AM – 12:40 PM
- *Lunch Break: 12:40 PM – 01:50 PM*
- **Period 5**: 01:50 PM – 02:40 PM
- **Period 6**: 02:40 PM – 03:30 PM
- **Period 7**: 03:30 PM – 04:20 PM *(Faculty availability extends to 05:00 PM)*

### 1st Year Cohort
- **Period 1**: 09:00 AM – 09:50 AM
- **Period 2**: 09:50 AM – 10:40 AM
- *Morning Break: 10:40 AM – 11:00 AM*
- **Period 3**: 11:00 AM – 11:50 AM
- *Lunch Break: 11:50 AM – 01:00 PM*
- **Period 4**: 01:00 PM – 01:50 PM
- **Period 5**: 01:50 PM – 02:40 PM
- *Afternoon Break: 02:40 PM – 03:00 PM*
- **Period 6**: 03:00 PM – 03:50 PM
- **Period 7**: 04:00 PM – 04:50 PM

---

## 🔑 Pre-Seeded Academic Credentials

| Role | Employee / Username ID | Password | Department / Description |
|---|---|---|---|
| **System Administrator** | `admin01` | `1352468` | Full Privileges |
| **Academic Administrator** | `admin02` | `1352468` | Timetables & Sections |
| **Department Administrator** | `admin03` | `1352468` | Faculty Operations |
| **HOD (Dr. G. Kishor Kumar)** | `FAC001` | `12345678` | Head of Department |
| **Teaching Faculty** | `FAC002` – `FAC019` | `12345678` | AIML Teaching Staff |

---

## 🌐 API Endpoints & Access Control

### Public Read-Only Endpoints (No Authentication Required)
- `GET /api/health` — Service health status
- `GET /api/timetables?year=...&section_id=...&date=...` — Weekly timetable grid & whitelisted faculty details
- `GET /api/timetables/sections?year=...` — List active sections
- `GET /api/timetables/version` — Current timetable version timestamp
- `GET /api/timetables/events` — Server-Sent Events (SSE) live push stream (per-IP rate limited)
- `GET /api/faculty/availability?day=...&date=...` — Public availability matrix (safe fields only)
- `GET /api/faculty/leaves` — Active faculty leaves (safe fields only)
- `GET /api/notifications` — Current-day academic intimations (current day only for public visitors)

### Authenticated Endpoints (Bearer JWT Required)
- `POST /api/auth/login` — Authenticate faculty or admin (brute-force rate limited)
- `POST /api/auth/logout` — Terminate active session
- `POST /api/auth/change-password` — Change password for logged-in user
- `POST /api/auth/forgot-password/request-otp` — Request SMS OTP for password reset
- `POST /api/auth/forgot-password/verify-otp` — Verify SMS OTP
- `POST /api/auth/forgot-password/reset-password` — Complete password reset with reset token
- `GET /api/auth/me` — Current user profile and session validation
- `GET /api/faculty/my-schedule` — Personal teaching schedule for logged-in faculty
- `POST /api/faculty/overrides` — Set slot availability (busy/leave)
- `DELETE /api/faculty/overrides/:day/:period` — Clear slot override
- `POST /api/faculty/leaves` — Submit date-specific leave notice
- `DELETE /api/faculty/leaves/:id` — Cancel date-specific leave notice
- `GET /api/directory/faculty` — Full faculty directory with designations

### Admin-Only Endpoints
- `POST /api/timetables/cell` — Update timetable cell with conflict detection
- `POST /api/timetables/sections` — Add new section
- `DELETE /api/timetables/sections/:id` — Delete section
- `POST /api/timetables/generate` — Automated constraint solver schedule generator
- `POST /api/auth/register-admin` — Register additional administrator
- `GET /api/directory/audit-logs` — Immutable security audit trail
- `GET /api/directory/audit-logs/export` — Export security audit trail
- `PUT /api/directory/users/:id` — Update faculty profile details
- `DELETE /api/directory/users/:id` — Remove faculty member

---

## 🚀 Running the Application

### 1. Production Build & Start
```bash
# Build React client bundle
npm run build

# Start production server
npm start
```
The server binds to `http://localhost:5000` (or `PORT` env var) and serves both the Express 5 REST API and the compiled React SPA.

### 2. Development Mode
Run the backend and frontend development servers concurrently:
```bash
# Terminal 1: Backend server with auto-reload
npm run server

# Terminal 2: Vite development server
npm run client
```
Open `http://localhost:3000` (Vite dev server proxies `/api` to `:5000`).

### 3. Automated Test Suite
All tests run against an isolated temporary database (`DB_PATH=server/data/temp-test.db`) without touching `server/data/academic.db`:
```bash
# Run all verification suites
npm test

# Run individual test suites
npm run test-api        # Full REST API, authentication, RBAC, and timetable verification
npm run test-solver     # Constraint-satisfaction schedule solver verification
npm run test-realtime   # SSE push synchronization & reverse proxy verification
npm run test-verify     # Security hardening and student-removal verification
```
