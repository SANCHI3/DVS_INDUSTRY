module.exports = {
  apps: [
    {
      name: 'dvs-industry-api',
      script: './dist/server.js',
      // Rate limiting is per process (in-memory). Use PM2_INSTANCES=1 for
      // exact limits, or add a shared store before scaling out.
      instances: process.env.PM2_INSTANCES || 'max',
      exec_mode: 'cluster',
      autorestart: true,
      max_memory_restart: '512M',
      time: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
