module.exports = {
  apps: [
    {
      name: "frontend",
      cwd: "/home/ubuntu/zhenchuan/frontend",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      interpreter: "node",
      env: {
        PORT: 3000,
        NODE_ENV: "production"
      }
    },
    {
      name: "backend",
      cwd: "/home/ubuntu/zhenchuan/backend",
      script: "dist/index.js",
      interpreter: "node",
      env: {
        PORT: 5000,
        NODE_ENV: "production"
      }
    },
    {
      name: "ocr",
      cwd: "/home/azureuser/baizhan-v2/backend",
      // Option 1: Use Python interpreter inside venv
      script: "uvicorn",
      args: "main:app --host 0.0.0.0 --port 8000",
      interpreter: "/home/azureuser/baizhan-v2/backend/.venv/bin/python"

      // Option 2 (alternative): run uvicorn binary directly, no interpreter needed
      // script: "./.venv/bin/uvicorn",
      // args: "main:app --host 0.0.0.0 --port 8000"
    }
  ]
};
