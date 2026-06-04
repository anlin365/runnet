module.exports = {
  apps: [
    {
      name: "runnet",
      script: "server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      max_memory_restart: "300M",
      env: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: "3000",
        DATABASE_URL: process.env.DATABASE_URL || "",
        DATABASE_SSL: process.env.DATABASE_SSL || "false",
      },
    },
  ],
};
