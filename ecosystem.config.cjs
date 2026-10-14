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
    env: {
      NODE_ENV: 'production',
      PORT: '4188'
    }
  }]
};
