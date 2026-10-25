/**
 * RGMCET AIML Academic Schedule Management System (ASMS)
 * PM2 Production Ecosystem Configuration
 *
 * NOTE: Single instance (exec_mode: 'fork') is strictly mandatory.
 * In-memory SSE connections, active tab sessions, and SQLite WAL single-writer 
 * require a single process instance. DO NOT run in cluster mode.
 */

module.exports = {
  apps: [
    {
      name: 'asms-server',
      script: 'server/index.js',
      cwd: '/var/www/asms', // Update with college server deployment directory
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '500M',
      restart_delay: 4000,
      env: {
        NODE_ENV: 'production',
        PORT: 5000,
        HOST: '127.0.0.1',
        TZ: 'Asia/Kolkata'
      },
      error_file: '/var/log/asms/error.log',
      out_file: '/var/log/asms/out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      kill_timeout: 5000
    }
  ]
};
