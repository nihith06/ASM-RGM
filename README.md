# AIML — Academic Schedule Management System (RGMCET)

A fullstack web application for the **Department of Artificial Intelligence & Machine Learning (AIML)** at **Rajeev Gandhi Memorial College of Engineering and Technology (RGMCET)**.

Designed with a clean, professional academic aesthetic: white background, RGMCET signature navy blue accents (`#002147`), card-based layouts, generous whitespace, rounded corners, and subtle shadows.

---

## 🌟 Key Features

### 1. Landing Page
- **Header**: RGMCET initials emblem badge + `RGMCET` title + `Academic Schedule Management` subtitle on the left; quick `Student registration` and `Faculty registration` links on the right.
- **Hero Section**: Pill badge `"Monday to Saturday · 7 periods a day"`, prominent heading `"WELCOME"`, full college name and department subtitle.
- **Role Selection Cards**: Three side-by-side role cards for **Student**, **Faculty**, and **Admin** with icons, capability descriptions, and direct portal links.
- **Footer**: `"New here? Register as a student or register as faculty."`
- **Instant Demo Access**: 1-click login buttons for Student, Faculty, and Admin for immediate testing.

### 2. Authentication & Duplicate Prevention
- **Self-Registration**: Students and Faculty register with Full Name, Register ID / Employee ID, Password, Role, Phone Number, and Year (1st–4th Year for students).
- **Duplicate Prevention**: Register IDs and Employee IDs are validated against the database with duplicate rejection (HTTP 409 Conflict).
- **Admin Accounts**: Seeded and managed separately (not self-registered).
- **Persistent Database**: SQLite database (via Node.js native `node:sqlite`) storing user credentials (bcrypt hashed passwords), profiles, sections, timetables, and overrides.

### 3. Strict Privacy Rule Enforcement
- **Privacy Policy**: Student personal details and faculty personal details (contact numbers, student lists) are visible **ONLY** to logged-in faculty members and administrators via the Academic Directory.
- **Security**: Students cannot view peer phone numbers or faculty phone numbers. API requests from students to `/api/directory/students` and `/api/directory/faculty` are strictly rejected with **HTTP 403 Forbidden**.

### 4. Dynamic Weekly Timetables (Monday – Saturday, 7 Periods)
- **Comprehensive Access**: Every logged-in user (students, faculty, admin) can view weekly timetables for all 4 years (1st, 2nd, 3rd, and 4th Year AIML) and switch between sections.
- **Academic Timing**:
  - Period 1: 09:00 AM – 09:50 AM
  - Period 2: 09:50 AM – 10:40 AM
  - *Short Break: 10:40 AM – 10:50 AM*
  - Period 3: 10:50 AM – 11:40 AM
  - Period 4: 11:40 AM – 12:30 PM
  - *Lunch Break: 12:30 PM – 01:20 PM*
  - Period 5: 01:20 PM – 02:10 PM
  - Period 6: 02:10 PM – 03:00 PM
  - Period 7: 03:00 PM – 03:50 PM
- **Admin Timetable Tools**:
  - Add and delete sections per year (e.g. Section A, Section B, Section C).
  - Interactive grid editor: click any cell to edit Subject, Faculty, and Room.
  - Bulk CSV Import & Sample CSV Template download.
  - Print / PDF export mode.

### 5. Automated Faculty Availability Engine & Overrides
- **Auto-Computation**: Automatically scans active timetables across all 4 years and sections to identify periods where faculty members are not scheduled for classes.
- **Manual Overrides**: Faculty can log in and customize their non-teaching slots (e.g. mark as Office Hours, Department Meeting, Student Mentoring, or Unavailable) with custom notes.
- **Public Dashboard**: Visible to all users with filters by Day (Monday–Saturday), Faculty search, and status filters (Free, Office Hours, Teaching).

### 6. Dedicated Dashboards
- **Student Dashboard**: Default view of the student's enrolled year timetable, quick switchers for all other years, and faculty availability view.
- **Faculty Dashboard**: Consolidated personal teaching schedule across all years, Free Period & Office Hours Manager, Directory view, and departmental timetables.
- **Admin Dashboard**: System metrics, Section Manager, Timetable Editor & CSV Importer, Student Management, and Faculty Management.

---

## 🔑 Pre-Seeded Demo Credentials

| Role | Register / Employee ID | Password | Notes |
|---|---|---|---|
| **Administrator** | `ADMIN001` | `admin123` | Full administration & section management |
| **Faculty (HOD)** | `FAC001` | `faculty123` | Dr. K. Ramesh (Prof & Dean) |
| **Faculty** | `FAC002` | `faculty123` | Dr. S. Priya (Associate Professor) |
| **Student (3rd Yr)** | `22091A3324` | `student123` | Karthik Kumar (3rd Year AIML) |
| **Student (1st Yr)** | `24091A3301` | `student123` | Rahul Varma (1st Year AIML) |

*(You can also register any new Student or Faculty member directly through the UI!)*

---

## 🚀 Running the Application

### 1. Start the Production Server
```bash
npm start
```
The server will start at **`http://localhost:5000`** and serve both the API and the single-page application.

### 2. Run in Development Mode (Vite Hot-Reload)
In one terminal:
```bash
npm run server
```
In another terminal:
```bash
npm run client
```
Open **`http://localhost:3000`** for frontend live reload (API requests are automatically proxied to `:5000`).

### 3. Run Automated Tests
```bash
npm run test-api
```
Runs 20 automated tests verifying authentication, duplicate ID rejection, privacy rule enforcement, timetable retrieval, section creation, and the faculty availability engine.
