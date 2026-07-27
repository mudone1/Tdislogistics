// PM2 process definition — lets the service run detached from any
// terminal (`pm2 start` daemonizes it) and auto-restart if it crashes.
// Uses the BUILT output (dist/), not tsx watch mode, since watch mode is
// meant for local development, not a long-running background process.
module.exports = {
  apps: [
    {
      name: "tdis-whatsapp",
      script: "dist/index.js",
      cwd: __dirname,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
