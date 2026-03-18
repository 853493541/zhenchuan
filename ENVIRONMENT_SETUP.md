/**
 * Environment Variables Guide for Zhenchuan Game
 * 
 * BACKEND_URL
 * ============
 * Specifies where the frontend server-side code can reach the backend.
 * 
 * Development (local):
 *   BACKEND_URL=http://localhost:5000
 *   - Frontend on :3000
 *   - Backend on :5000
 *   - Both are accessed via localhost by the server
 * 
 * Production (with nginx reverse proxy):
 *   Option 1 - Internal network reference (recommended):
 *   BACKEND_URL=http://backend:5000
 *   OR
 *   BACKEND_URL=http://127.0.0.1:5000
 *   - Nginx is on :443 (external)
 *   - Frontend (:3000) and Backend (:5000) are internal only
 *   - Both services are on the same internal network
 *   
 *   Option 2 - Via nginx (if both behind same reverse proxy):
 *   BACKEND_URL=http://localhost:5000
 *   - Requires custom nginx config to handle /api/* routing
 *   - Not recommended - use Option 1
 * 
 * NGINX Configuration Example (Option 1):
 * ========================================
 * Assuming:
 * - Frontend running on localhost:3000
 * - Backend running on localhost:5000
 * - Nginx serving on https://zhenchuan.renstoolbox.com
 * 
 * upstream frontend {
 *   server localhost:3000;
 * }
 * 
 * upstream backend {
 *   server localhost:5000;
 * }
 * 
 * server {
 *   listen 443 ssl http2;
 *   server_name zhenchuan.renstoolbox.com;
 *   
 *   ssl_certificate ...;
 *   ssl_certificate_key ...;
 *   
 *   # Backend API routes
 *   location /api/ {
 *     proxy_pass http://backend;
 *     proxy_http_version 1.1;
 *     proxy_set_header Upgrade $http_upgrade;
 *     proxy_set_header Connection 'upgrade';
 *     proxy_set_header Host $host;
 *     proxy_set_header X-Real-IP $remote_addr;
 *     proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
 *     proxy_set_header X-Forwarded-Proto $scheme;
 *     proxy_cache_bypass $http_upgrade;
 *   }
 *   
 *   # WebSocket support (same backend)
 *   location /ws {
 *     proxy_pass http://backend;
 *     proxy_http_version 1.1;
 *     proxy_set_header Upgrade $http_upgrade;
 *     proxy_set_header Connection 'upgrade';
 *     proxy_set_header Host $host;
 *     proxy_cache_bypass $http_upgrade;
 *   }
 *   
 *   # Frontend (everything else)
 *   location / {
 *     proxy_pass http://frontend;
 *     proxy_http_version 1.1;
 *     proxy_set_header Upgrade $http_upgrade;
 *     proxy_set_header Connection 'upgrade';
 *     proxy_set_header Host $host;
 *     proxy_cache_bypass $http_upgrade;
 *   }
 * }
 * 
 * Frontend and Backend Environment Variables:
 * ============================================
 * 
 * Frontend (.env.production):
 *   BACKEND_URL=http://localhost:5000
 *   NEXT_PUBLIC_API_URL=/api  # For client-side calls
 * 
 * Backend (.env):
 *   PORT=5000
 *   NODE_ENV=production
 *   JWT_SECRET=<your-secret>
 * 
 * Docker Compose Example:
 * ======================
 * services:
 *   frontend:
 *     build: ./frontend
 *     ports:
 *       - "3000:3000"
 *     environment:
 *       - BACKEND_URL=http://backend:5000
 *       - NODE_ENV=production
 *   
 *   backend:
 *     build: ./backend
 *     ports:
 *       - "5000:5000"
 *     environment:
 *       - PORT=5000
 *       - NODE_ENV=production
 *       - JWT_SECRET=<secret>
 *     depends_on:
 *       - mongo
 *   
 *   mongo:
 *     image: mongo:latest
 *     ports:
 *       - "27017:27017"
 * 
 * 
 * Troubleshooting:
 * ================
 * 
 * Q: Getting 404 on /api/auth/token in production?
 * A: Make sure BACKEND_URL is set correctly in frontend environment.
 *    Check nginx is routing /api/* to backend correctly.
 *    Verify backend is running on expected port.
 * 
 * Q: WebSocket not connecting?
 * A: Check /ws location in nginx is also proxying with Upgrade headers.
 *    Make sure WSS (WebSocket Secure) is enabled in nginx.
 * 
 * Q: Cookies not being sent?
 * A: Ensure proxy_set_header includes Host header.
 *    Check proxy_pass uses http:// not https:// for internal traffic.
 */
