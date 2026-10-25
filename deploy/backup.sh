#!/usr/bin/env bash
# ==============================================================================
# RGMCET AIML Academic Schedule Management System (ASMS)
# Automated Daily WAL-Safe SQLite Database Backup Script
#
# Recommended cron setup (runs every night at 2:00 AM Asia/Kolkata):
# 0 2 * * * /var/www/asms/deploy/backup.sh >> /var/log/asms/backup.log 2>&1
# ==============================================================================

set -euo pipefail

# Configuration
ASMS_DIR="${ASMS_DIR:-/var/www/asms}"
DB_PATH="${DB_PATH:-$ASMS_DIR/server/data/academic.db}"
BACKUP_DIR="${BACKUP_DIR:-$ASMS_DIR/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
NAS_BACKUP_DIR="${NAS_BACKUP_DIR:-}" # Optional mounted NAS path e.g. /mnt/college-nas/asms

TIMESTAMP=$(date +"%Y-%m-%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/asms-backup-$TIMESTAMP.db"

mkdir -p "$BACKUP_DIR"

echo "======================================================================"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting ASMS SQLite Database Backup"
echo "Source DB: $DB_PATH"
echo "Target:    $BACKUP_FILE.gz"
echo "======================================================================"

if [ ! -f "$DB_PATH" ]; then
    echo "❌ ERROR: Database file not found at $DB_PATH" >&2
    exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
    echo "❌ ERROR: 'sqlite3' CLI utility is not installed. Run: sudo apt install sqlite3" >&2
    exit 1
fi

# Execute WAL-safe atomic backup using SQLite online backup API (.backup command)
# This safely coordinates with active WAL readers and writers without taking the server offline.
echo "  📦 Executing online SQLite .backup..."
sqlite3 "$DB_PATH" ".backup '$BACKUP_FILE'"

# Verify integrity of the newly created backup file before compressing
echo "  🔍 Verifying backup integrity..."
INTEGRITY=$(sqlite3 "$BACKUP_FILE" "PRAGMA integrity_check;")
if [ "$INTEGRITY" != "ok" ]; then
    echo "❌ ERROR: Backup integrity check failed: $INTEGRITY" >&2
    rm -f "$BACKUP_FILE"
    exit 1
fi
echo "  ✅ Backup integrity check passed: ok"

# Compress backup file with gzip
echo "  🗜️  Compressing backup..."
gzip -f "$BACKUP_FILE"
FINAL_ARCHIVE="$BACKUP_FILE.gz"
ARCHIVE_SIZE=$(du -h "$FINAL_ARCHIVE" | cut -f1)
echo "  ✅ Backup archive created ($ARCHIVE_SIZE): $FINAL_ARCHIVE"

# Optional: Copy to mounted NAS / institutional storage
if [ -n "$NAS_BACKUP_DIR" ] && [ -d "$NAS_BACKUP_DIR" ]; then
    echo "  💾 Copying to institutional NAS ($NAS_BACKUP_DIR)..."
    cp "$FINAL_ARCHIVE" "$NAS_BACKUP_DIR/"
    echo "  ✅ NAS backup copy complete."
fi

# Apply retention policy: remove backups older than $RETENTION_DAYS days
echo "  🧹 Applying retention policy (deleting local backups older than $RETENTION_DAYS days)..."
DELETED_COUNT=$(find "$BACKUP_DIR" -name "asms-backup-*.db.gz" -type f -mtime +"$RETENTION_DAYS" -print -delete | wc -l)
echo "  ✅ Pruned $DELETED_COUNT old backup archive(s)."

echo "======================================================================"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup Completed Successfully!"
echo "======================================================================"
exit 0
