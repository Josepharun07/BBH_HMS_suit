/**
 * BBH HMS – PM2 Ecosystem Config
 * Runs inside the bbh-website container.
 *
 * KEY: watch: true + watch path set to /app
 * When bbh-api runs `git pull` in /mnt/website (mounted as /app here),
 * PM2 detects the file changes and automatically restarts the Next.js process.
 *
 * No Docker socket access required. No root access required.
 * Pure file-system event driven restart.
 */

module.exports = {
  apps: [
    {
      name: 'bbh-website',
      script: 'node_modules/.bin/next',
      args: 'start',
      cwd: '/app',

      // ── THE SAFE UPDATE MECHANISM ──────────────────────────────────────────
      // PM2 watches for any file changes in /app (the shared volume).
      // When bbh-api performs `git pull`, changed source files trigger this.
      watch: true,
      watch_delay: 2000,           // Wait 2s after first change (debounce)
      ignore_watch: [
        'node_modules',
        '.git',
        '.next',
        '*.log',
        'coverage',
        '.env*',
      ],

      // ── PROCESS MANAGEMENT ────────────────────────────────────────────────
      instances: 1,                // Single instance (not cluster mode for this container)
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',           // Consider startup failed if < 10s uptime
      restart_delay: 3000,         // Wait 3s before restart

      // ── ENVIRONMENT ───────────────────────────────────────────────────────
      env_production: {
        NODE_ENV: 'production',
        PORT: 3000,
      },

      // ── LOGGING ───────────────────────────────────────────────────────────
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      out_file: '/app/.pm2/logs/out.log',
      error_file: '/app/.pm2/logs/error.log',
      combine_logs: true,
      log_type: 'json',
    },
  ],
};
