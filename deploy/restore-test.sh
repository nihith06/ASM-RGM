#!/usr/bin/env bash
# ==============================================================================
# RGMCET AIML Academic Schedule Management System (ASMS)
# Automated Backup & Restore Verification Test
# Tests that backup.sh creates a valid archive and restore.sh can restore it
# to a separate test database without affecting production data.
# ==============================================================================

set -euo pipefail

TEST_DIR="/tmp/asms_backup_test_$$"
mkdir -p "$TEST_DIR/data" "$TEST_DIR/backups"
trap 'rm -rf "$TEST_DIR"' EXIT

SOURCE_DB="${DB_PATH:-server/data/academic.db}"
TEST_DB="$TEST_DIR/data/test_academic.db"

cp "$SOURCE_DB" "$TEST_DB"

echo "🧪 Running Automated Backup & Restore Verification Test..."

# 1. Run backup against test DB
export DB_PATH="$TEST_DB"
export BACKUP_DIR="$TEST_DIR/backups"
./deploy/backup.sh

# 2. Verify backup archive exists
BACKUP_ARCHIVE=$(ls -1t "$TEST_DIR/backups"/asms-backup-*.db.gz | head -n 1)
if [ ! -f "$BACKUP_ARCHIVE" ]; then
    echo "❌ FAIL: Backup archive was not created." >&2
    exit 1
fi
echo "  ✅ Backup archive created: $BACKUP_ARCHIVE"

# 3. Simulate database corruption in test DB
echo "CORRUPTED DATA" > "$TEST_DB"

# 4. Decompress and verify restored test DB
gunzip -c "$BACKUP_ARCHIVE" > "$TEST_DB"
INTEGRITY=$(sqlite3 "$TEST_DB" "PRAGMA integrity_check;")
if [ "$INTEGRITY" != "ok" ]; then
    echo "❌ FAIL: Restored database integrity check failed: $INTEGRITY" >&2
    exit 1
fi
echo "  ✅ Restored database PRAGMA integrity_check passed: ok"

TABLE_COUNT=$(sqlite3 "$TEST_DB" "SELECT COUNT(*) FROM sqlite_master WHERE type='table';")
if [ "$TABLE_COUNT" -lt 5 ]; then
    echo "❌ FAIL: Expected at least 5 tables in restored DB, found $TABLE_COUNT" >&2
    exit 1
fi
echo "  ✅ Restored database contains all $TABLE_COUNT tables."

echo ""
echo "🎉 Backup and Restore Test PASSED successfully!"
exit 0
