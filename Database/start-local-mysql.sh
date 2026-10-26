#!/usr/bin/env bash
# Starts a project-local MySQL instance (127.0.0.1:3307) so GreenLeaf does not touch any
# other MySQL install. Safe to re-run: initializes the data dir only the first time.
# NOTE: the data dir must NOT start with a dot (MySQL 9.x/26.x InnoDB skips hidden
# directories and crashes on startup), hence "mysql-data" rather than ".mysql-data".
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$HERE/mysql-data"
SOCK="$HERE/mysql.sock"
PORT=3307
BASE="$(brew --prefix mysql)"

if [ ! -d "$DATA/mysql" ]; then
  echo "Initializing data directory..."
  mysqld --no-defaults --initialize-insecure --basedir="$BASE" --datadir="$DATA" >"$HERE/mysql-init.log" 2>&1
fi

if mysqladmin --socket="$SOCK" -uroot ping >/dev/null 2>&1; then
  echo "Local MySQL already running on port $PORT"
  exit 0
fi

nohup mysqld --no-defaults --basedir="$BASE" --datadir="$DATA" --port=$PORT --socket="$SOCK" \
  --mysqlx=OFF --bind-address=127.0.0.1 --pid-file="$HERE/mysql.pid" \
  >"$HERE/mysql.log" 2>&1 &

for i in $(seq 1 30); do
  if mysqladmin --socket="$SOCK" -uroot ping >/dev/null 2>&1; then
    echo "Local MySQL up on 127.0.0.1:$PORT (root, no password)"
    exit 0
  fi
  sleep 1
done
echo "MySQL failed to start; see $HERE/mysql.log" >&2
exit 1
