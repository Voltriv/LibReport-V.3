// PM2 process definition.
//
// env_file is the important line. Previously this passed only NODE_ENV, so
// production booted entirely on a Backend/.env happening to exist on the host --
// and server.js exits without JWT_SECRET, so a missing or misplaced file produced
// a process that died at startup with nothing in the PM2 log to explain why.
// Naming the file makes the dependency explicit and the failure diagnosable.
//
// instances/exec_mode are load-bearing beyond performance: the rate limiters in
// Backend/middleware/rateLimit.js keep their counters in process memory. Moving to
// cluster mode would give each worker its own counters and multiply every limit by
// the worker count, so that change needs a shared store first.
module.exports = {
  apps: [
    {
      name: 'libreport-backend',
      cwd: __dirname + '/Backend',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      env_file: __dirname + '/Backend/.env',
      env: {
        NODE_ENV: 'production'
      },
      max_memory_restart: '400M'
    }
  ]
};
