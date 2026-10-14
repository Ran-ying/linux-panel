// PM2 deployment definition. Run as a dedicated non-root Linux user.
module.exports = {
  apps: [{
    name: 'linux-panel',
    script: './apps/api/src/server.js',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    autorestart: true,
    max_memory_restart: '180M',
    // PANEL_PUBLIC_ORIGIN and PANEL_DATA_DIR are supplied by the process environment.
    // PM2 must run as the dedicated non-root account, with only one instance.
    env: {
      NODE_ENV: 'production',
      PORT: '4188'
    }
  }]
};
