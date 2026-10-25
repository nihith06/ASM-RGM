#!/usr/bin/env bash
# ==============================================================================
# RGMCET AIML Academic Schedule Management System (ASMS)
# Database Restore & Disaster Recovery Script
#
# Usage:
#   sudo ./deploy/restore.sh /var/www/asms/backups/asms-backup-YYYY-MM-DD_HHMMSS.db.gz
# ==============================================================================

set -euo pipefail

if [ "$#" -lt 1 ]; then
    echo "Usage: $0 <path-to-backup-archive-or-db>"
    echo "Example: $0 /var/www/asms/backups/asms-backup-2026-10-25_020000.db.gz"
    exit 1
fi

INPUT_FILE="$1"
ASMS_DIR="${ASMS_DIR:-/var/www/asms}"
DB_PATH="${DB_PATH:-$ASMS_DIR/server/data/academic.db}"
DB_DIR=$(dirname "$DB_PATH")

if [ ! -f "$INPUT_FILE" ]; then
    echo "❌ ERROR: File not found at $INPUT_FILE" >&2
    exit 1
fi

echo "======================================================================"
echo "⚠️  WARNING: You are about to restore the ASMS database."
echo "Active database will be replaced with: $INPUT_FILE"
echo "Target DB: $DB_PATH"
echo "======================================================================"
read -p "Are you sure you wish to proceed? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    echo "Restore aborted by administrator."
    exit 0
fi

# Prepare temporary working file
TEMP_RESTORE_DB="/tmp/asms_restore_$$.db"
trap 'rm -f "$TEMP_RESTORE_DB"' EXIT

if [[ "$INPUT_FILE" == *.gz ]]; then
    echo "  📦 Decompressing archive..."
    gunzip -c "$INPUT_FILE" > "$TEMP_RESTORE_DB"
else
    cp "$INPUT_FILE" "$TEMP_RESTORE_DB"
fi

# Run SQLite integrity check
echo "  🔍 Validating backup integrity before applying..."
INTEGRITY=$(sqlite3 "$TEMP_RESTORE_DB" "PRAGMA integrity_check;")
if [ "$INTEGRITY" != "ok" ]; then
    echo "❌ FATAL: Integrity check failed for backup file: $INTEGRITY" >&2
    echo "Restore aborted. Active database was NOT touched." >&2
    exit 1
fi
echo "  ✅ Integrity check passed: ok"

# Create emergency rollback copy of current database
if [ -f "$DB_PATH" ]; then
    PREV_BACKUP="$DB_PATH.prev_$(date +'%Y%m%d_%H%M%S')"
    echo "  💾 Creating rollback snapshot of current database at: $PREV_BACKUP"
    cp "$DB_PATH" "$PREV_BACKUP"
fi

# Stop application service if systemd or PM2 is running
STOPPED_PM2=false
if command -v pm2 >/dev/null 2>&1 && pm2 list | grep -q "asms-server"; then
    echo "  ⏹️  Stopping PM2 process (asms-server)..."
    pm2 stop asms-server || true
    STOPPED_PM2=true
fi

# Replace active database and clear WAL/SHM artifacts
echo "  🔄 Applying restored database..."
mkdir -p "$DB_DIR"
cp "$TEMP_RESTORE_DB" "$DB_PATH"
rm -f "$DB_PATH-wal" "$DB_PATH-shm"
chmod 640 "$DB_PATH"

if [ "$STOPPED_PM2" = true ]; then
    echo "  ▶️  Restarting PM2 process (asms-server)..."
    pm2 restart asms-server
fi

echo "======================================================================"
echo "✅ Database Restore Completed Successfully!"
echo "Active DB is now verified and online."
echo "======================================================================"
exit 0
