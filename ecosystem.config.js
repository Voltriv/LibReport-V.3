module.exports = {
  apps: [
    {
      name: 'libreport-backend',
      cwd: __dirname + '/Backend',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production'
      },
      max_memory_restart: '400M'
    }
  ]
};
