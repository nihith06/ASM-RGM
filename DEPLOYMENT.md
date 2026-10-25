# RGMCET AIML Academic Schedule Management System (ASMS)
## On-Premise Ubuntu Linux College Server Deployment Guide

This guide provides step-by-step instructions to deploy, secure, and maintain the ASMS production system on an on-premise college server running **Ubuntu 22.04 LTS** or **Ubuntu 24.04 LTS**.

The application is 100% self-contained: it requires **no external internet dependencies, no third-party cloud services, and no external database servers**. Everything runs locally on the physical/virtual machine using native Node.js and SQLite.

---

## 1. System Requirements

| Component | Minimum Specification | Recommended Specification |
| :--- | :--- | :--- |
| **Operating System** | Ubuntu Linux 22.04 LTS / 24.04 LTS | Ubuntu Linux 24.04 LTS (x86_64) |
| **Node.js** | Node.js v22.13.0 LTS | Node.js v22.13+ LTS (or Node 24 LTS) |
| **RAM** | 2 GB Available | 4 GB+ |
| **Disk Storage** | 10 GB SSD | 30 GB+ SSD |
| **Network** | College Campus LAN IP | Static LAN IP (e.g. `10.0.0.100`) + DNS entry |

---

## 2. Step-by-Step Installation

### Step 2.1: System Update & Essential Packages
Log in to your Ubuntu college server via SSH:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw nginx sqlite3 gzip
```

### Step 2.2: Install Node.js LTS (>= 22.13.0)
Native `node:sqlite` requires Node.js version 22.13.0 or higher. Install official NodeSource LTS repository:

```bash
# Download and setup NodeSource Node.js 22 LTS repo
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation (must be >= 22.13.0)
node -v
npm -v
```

> [!NOTE]
> If your package manager installs an older Node 22 (e.g. 22.0.0 - 22.12.x), you must run Node with `--experimental-sqlite`. On Node 22.13.0+ and Node 24+, native SQLite is enabled by default without flags.

### Step 2.3: Install Global Process Manager (PM2)
```bash
sudo npm install -g pm2
```

---

## 3. Application Setup

### Step 3.1: Clone and Set Directory Permissions
```bash
# Recommended deployment root
sudo mkdir -p /var/www/asms
sudo chown -R $USER:www-data /var/www/asms
chmod -R 775 /var/www/asms

# Clone repository
git clone https://github.com/rgmcet/asms.git /var/www/asms
cd /var/www/asms

# Ensure logs and data directories exist with write permissions
mkdir -p /var/log/asms /var/www/asms/server/data /var/www/asms/backups
sudo chown -R $USER:www-data /var/log/asms /var/www/asms/server/data /var/www/asms/backups
chmod 775 /var/log/asms /var/www/asms/server/data /var/www/asms/backups
```

### Step 3.2: Clean Dependency Installation & Frontend Build
Run clean install and compile the production client bundle:

```bash
cd /var/www/asms

# Install server dependencies
npm ci --omit=dev

# Build client React application
npm run build
```

This generates optimized static client assets in `/var/www/asms/client/dist`.

---

## 4. Environment Configuration

Copy the production template:

```bash
cp .env.example .env
chmod 600 .env
```

Generate a cryptographically secure 64-character JWT Secret and configure `.env`:

```bash
# Generate secret
openssl rand -hex 32
```

Edit `/var/www/asms/.env` with your preferred editor (`nano .env`):

```ini
# Production Server Environment
NODE_ENV=production
PORT=5000
HOST=127.0.0.1
TZ=Asia/Kolkata

# Mandatory 32+ character key
JWT_SECRET=your_generated_64_character_hex_secret_here

# SQLite Database Location
DB_PATH=/var/www/asms/server/data/academic.db

# CORS Allowed Origins (Comma-separated college domains or IP)
ALLOWED_ORIGINS=https://asms.rgmcet.edu.in,https://10.0.0.100

# Reverse Proxy Trust (1 indicates trusted Nginx proxy)
TRUST_PROXY=1

# Initial Seed Password for Default Accounts
ADMIN_INITIAL_PASSWORD=ChangeThisStrongInitialAdminPassword123!

# SMS Provider for Password Resets ('console' for dev, 'msg91'/'fast2sms' for gateway, or 'none')
SMS_PROVIDER=none
```

---

## 5. Process Management (PM2 or Systemd)

Choose either **PM2** (recommended) or **systemd**.

### Option A: PM2 (Recommended)
PM2 ensures the process restarts automatically after power loss, system reboots, or unexpected errors.

```bash
cd /var/www/asms

# Start single-instance application using production configuration
pm2 start deploy/ecosystem.config.cjs

# Save PM2 process list to restore on server reboot
pm2 save

# Register PM2 as system startup service
sudo pm2 startup systemd -u $USER --hp $HOME
```

Verify process status:
```bash
pm2 status
pm2 logs asms-server --lines 20
```

### Option B: Systemd Unit Alternative
If your institution enforces systemd:

```bash
sudo cp /var/www/asms/deploy/asms.service /etc/systemd/system/asms.service
sudo systemctl daemon-reload
sudo systemctl enable asms
sudo systemctl start asms
sudo systemctl status asms
```

---

## 6. Nginx Reverse Proxy & TLS Setup

### Step 6.1: TLS Certificate Generation
If an institutional wildcard certificate (`*.rgmcet.edu.in`) is available, copy it to `/etc/ssl/certs/asms.crt` and `/etc/ssl/private/asms.key`.

For an internal LAN deployment without public CA, generate a high-grade 2048-bit self-signed certificate:

```bash
sudo openssl req -x509 -nodes -days 1825 -newkey rsa:2048 \
  -keyout /etc/ssl/private/asms.key \
  -out /etc/ssl/certs/asms.crt \
  -subj "/C=IN/ST=Andhra Pradesh/L=Nandyal/O=RGMCET/OU=AIML Department/CN=asms.rgmcet.edu.in"

sudo chmod 600 /etc/ssl/private/asms.key
sudo chmod 644 /etc/ssl/certs/asms.crt
```

### Step 6.2: Install Nginx Configuration
```bash
sudo cp /var/www/asms/deploy/nginx/asms.conf /etc/nginx/sites-available/asms.conf
sudo ln -sf /etc/nginx/sites-available/asms.conf /etc/nginx/sites-enabled/asms.conf
sudo rm -f /etc/nginx/sites-enabled/default

# Test Nginx syntax
sudo nginx -t

# Reload Nginx service
sudo systemctl reload nginx
```

---

## 7. Firewall (UFW) Security

Only allow SSH (22), HTTP (80), and HTTPS (443). The backend port (5000) must **NEVER** be opened to the network; it binds exclusively to `127.0.0.1` behind Nginx.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp comment 'SSH Administration'
sudo ufw allow 80/tcp comment 'HTTP Redirect'
sudo ufw allow 443/tcp comment 'HTTPS Secure Traffic'
sudo ufw enable
sudo ufw status verbose
```

---

## 8. Automated Daily Backups & Disaster Recovery

### Step 8.1: Test Backup Script
```bash
chmod +x /var/www/asms/deploy/backup.sh /var/www/asms/deploy/restore.sh
/var/www/asms/deploy/backup.sh
```

### Step 8.2: Setup Daily Cron Job
Open root crontab:
```bash
sudo crontab -e
```

Add the daily backup task (runs daily at 2:00 AM IST with 30-day retention):
```cron
# ASMS Daily WAL-Safe Database Backup (02:00 AM Asia/Kolkata)
0 2 * * * /var/www/asms/deploy/backup.sh >> /var/log/asms/backup.log 2>&1
```

### Step 8.3: Disaster Recovery Restore Procedure
If the database ever needs to be restored to a previous snapshot:

```bash
# Syntax: sudo ./deploy/restore.sh <backup-file.db.gz>
sudo /var/www/asms/deploy/restore.sh /var/www/asms/backups/asms-backup-2026-10-25_020000.db.gz
```

The restore script:
1. Validates SQLite integrity (`PRAGMA integrity_check`) before applying.
2. Creates an emergency rollback copy of the current active database.
3. Restarts PM2 gracefully.

---

## 9. Update & Maintenance Procedure

To deploy codebase updates or patches without downtime:

```bash
cd /var/www/asms

# 1. Pull latest code
git fetch origin hardening/college-deploy
git checkout hardening/college-deploy
git pull

# 2. Update dependencies and recompile client
npm ci --omit=dev
npm run build

# 3. Reload PM2 process
pm2 reload asms-server

# 4. Verify health
curl -s http://127.0.0.1:5000/api/health
```

---

## 10. Troubleshooting & Common Issues

### Issue 1: "node:sqlite is not available"
- **Cause**: Node.js is older than v22.13.0.
- **Solution**: Upgrade Node to >= 22.13.0 (`sudo apt install nodejs`), or add `--experimental-sqlite` to the PM2 start command.

### Issue 2: "Port 5000 is already in use"
- **Cause**: A previous node instance is lingering.
- **Solution**: Run `sudo lsof -i :5000` to find PID, then `sudo kill -9 <PID>`.

### Issue 3: Real-Time SSE Disconnecting Every 60 Seconds
- **Cause**: Nginx `proxy_read_timeout` is too short or buffering is on.
- **Solution**: Ensure `proxy_buffering off;` and `proxy_read_timeout 86400s;` are configured in `/etc/nginx/sites-available/asms.conf` under `location /api/timetables/events`.

### Issue 4: Permissions Denied on `academic.db`
- **Cause**: `server/data` is owned by root instead of the application user.
- **Solution**: `sudo chown -R $USER:www-data /var/www/asms/server/data && chmod 775 /var/www/asms/server/data`.

---

## 11. Production Go-Live Checklist

- [ ] Node.js version is verified &ge; 22.13.0 (`node -v`).
- [ ] Database permissions are verified (`chmod 775 server/data`).
- [ ] `NODE_ENV=production` is set in `.env`.
- [ ] Strong 64-character `JWT_SECRET` configured in `.env`.
- [ ] `ALLOWED_ORIGINS` is configured with institutional domain / IP.
- [ ] Nginx HTTPS reverse proxy is online with TLS certificate.
- [ ] SSE `/api/timetables/events` is configured with `proxy_buffering off`.
- [ ] Daily backup cron job is registered (`crontab -l`).
- [ ] Firewall UFW is active with only ports 22, 80, 443 permitted.
- [ ] Health check endpoint `/api/health` returns status `online` and database `healthy`.
- [ ] Default administrator passwords have been rotated on first login.
