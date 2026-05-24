# Zhenchuan China VM Deployment Runbook

This document describes how to keep developing on the current machine, build here, and ship a production runtime to a fresh mainland China VM.

It assumes the current architecture:

- Frontend: Next.js production server on port `3000`.
- Backend: compiled Node/Express/WebSocket server on port `5000`.
- WebSocket endpoint: `/ws` on the backend.
- Process manager: PM2.
- Database: MongoDB through `MONGO_URI`, forced database name `baizhan_V2` in backend code.
- Runtime Node version currently used here: Node `20.20.0`.

## 1. Capacity Answer

### Is 8 GB RAM enough for 5 players?

Yes for one room, but budget matters more than a one-size-fits-all recommendation. The cheapest practical floor for this project is not necessarily `4 vCPU / 8 GB`; a more budget-friendly starting point is often `2 vCPU / 16 GB`.

Current observed idle app memory on this server:

| Process | Approx Memory |
|---|---:|
| Backend PM2 process | 523 MB |
| Frontend PM2 process | 162 MB |
| App total before Mongo/nginx/OS cache | about 685 MB |

Current deployment footprint:

| Path | Approx Size |
|---|---:|
| `backend/dist` | 1.9 MB |
| `frontend/.next` | 829 MB |
| `frontend/public` | 249 MB |
| `backend/node_modules` | 115 MB |
| `frontend/node_modules` | 911 MB |
| current local logs | 469 MB |

RAM budget for a single-VM deployment:

| Component | Expected Working Range |
|---|---:|
| Frontend Next server | 200-600 MB |
| Backend game server | 600 MB-2 GB |
| MongoDB if local | 500 MB-2 GB, more with cache/load |
| nginx + PM2 + OS | 300 MB-800 MB |
| safety headroom | 2-3 GB |

That fits in 8 GB for one active 5-player room and light usage. If MongoDB is also local and the game will host several rooms, `16 GB` is the safer choice.

CPU guidance:

- `2 vCPU` is the budget floor I would actually try for one active room.
- `4 vCPU` is a comfort recommendation, not a hard requirement.
- More cores help because the backend, frontend, nginx, PM2, and possibly MongoDB compete on the same VM, but the current backend itself is still a single Node process and does not instantly require many cores.
- If you are cost-sensitive, start at `2 vCPU / 16 GB`, test, and scale up later if tick stability or reconnect behavior suffers.

Disk guidance:

- `80 GB` is not strictly required.
- `40-50 GB` is enough if you ship built artifacts from the current machine, keep MongoDB off the VM, and keep logs under control.
- `50-60 GB` is a safer low-cost choice if MongoDB or long-lived logs stay on the VM.
- `80 GB` is mainly comfort for local MongoDB, retained logs, release backups, and in-VM builds.

Recommended VM tiers:

| Scenario | CPU | RAM | Disk | Bandwidth |
|---|---:|---:|---:|---:|
| Private 1v1 testing, external Mongo | 2 vCPU | 4 GB | 40-60 GB SSD | 5-10 Mbps |
| Budget first production try, one active room | 2 vCPU | 16 GB | 40-60 GB SSD | 5-10 Mbps |
| Comfortable first mainland VM | 4 vCPU | 8-16 GB | 60-80 GB SSD | 10-20 Mbps |
| Safer with local Mongo or several rooms | 4-8 vCPU | 16 GB | 100 GB SSD | 20-50 Mbps |

### Does 5-player require a huge increase?

It is a real increase, but not automatically a huge server increase for one room.

Compared with 2 players:

- Movement and collision work usually grows with player count: about `2.5x` for 5 players versus 2.
- Some ability targeting/AOE checks can behave closer to `players * targets`, so spikes can be higher than linear.
- WebSocket fanout grows because the server broadcasts to every connected player.
- Payload size grows because each state diff can contain more player state.

A practical network estimate for one 5-player room:

| Assumption | Estimate |
|---|---:|
| Broadcast cadence | about 30 per second |
| Connected sockets | 5 |
| Average diff payload | 1-5 KB in normal play, higher during events |
| Gameplay outbound traffic | about 1.2-6 Mbps before overhead/spikes |

This is why `10-20 Mbps` bandwidth is a good first target. First-load asset downloads are separate from gameplay traffic and can be much larger. Use the existing resource-pack flow or a mainland CDN later if many players load the map at once.

Important code note: the current codebase is not fully unlocked for 5-player play yet. `startGame` allows up to 5 players, but `joinGame` still rejects rooms at 2 players. Some backend loop/channel logic also has 2-player assumptions. The VM does not solve those rules by itself.

## 2. China VM and VS Code Access

Mainland cloud VMs normally allow SSH, and VS Code Remote SSH works when these are true:

- The VM has a public IP.
- The cloud security group allows TCP port `22` from your IP.
- The VM's firewall allows SSH.
- Your local network can reach the VM over SSH.

Common providers: Alibaba Cloud, Tencent Cloud, Huawei Cloud, Baidu AI Cloud, UCloud.

Reality checks:

- Real-name verification is usually required before buying a mainland VM.
- SSH from outside China can be slower or occasionally unstable.
- VS Code Remote SSH may be slower because it uploads/installs the VS Code server on the VM.
- npm/GitHub downloads from the VM can be slow; use China mirrors when needed.
- If SSH is blocked by your local network, use the provider's web console as a fallback.

For production, do not rely on editing directly on the China VM. Use VS Code locally for development, then deploy builds to the VM.

## 3. Domain and Mainland China Requirements

### Mainland VM with public web domain

If the server is in mainland China and you want users to visit it on ports `80` or `443` with a domain, expect to need ICP filing for the domain. Many mainland providers will block or restrict HTTP/HTTPS service for unfiled domains.

Plan:

1. Buy or use a domain.
2. Complete provider real-name verification.
3. Complete ICP filing for the domain with the mainland VM provider.
4. Point DNS `A` record to the VM public IP.
5. After public launch, check whether public security filing is required for the site category.

### Testing before ICP

Possible options:

- Use the VM public IP and a high test port temporarily, if the provider allows it.
- Use provider preview tools or an SSH tunnel for internal testing.
- Use a Hong Kong VM first if you need a public domain quickly without mainland ICP. Latency is usually worse than mainland China, but deployment friction is lower.

### DNS records

For a domain such as `game.example.com`:

```text
Type: A
Host: game
Value: <china-vm-public-ip>
TTL: 300
```

Open these in the cloud security group:

| Port | Purpose | Public? |
|---:|---|---|
| 22 | SSH / VS Code Remote SSH | Restrict to your IP if possible |
| 80 | HTTP / Let's Encrypt challenge / redirect | Yes |
| 443 | HTTPS app traffic | Yes |
| 3000 | Next internal app | No, localhost only |
| 5000 | Backend internal app | No, localhost only |
| 27017 | MongoDB | No, never public |

## 4. Recommended Production Topology

First China deployment:

```text
Browser
  -> https://game.example.com
  -> nginx :443
      -> /ws              -> backend 127.0.0.1:5000
      -> /api             -> backend 127.0.0.1:5000
      -> /full-exports    -> backend 127.0.0.1:5000
      -> everything else  -> frontend 127.0.0.1:3000

PM2:
  frontend: next start -p 3000
  backend:  node dist/index.js on 5000

MongoDB:
  preferred: managed MongoDB in the same mainland region
  acceptable first test: local MongoDB on the same VM
```

Use same-region MongoDB. Running the game server in China while MongoDB stays overseas can still create slow saves, reconnect pain, and random latency spikes.

## 5. Fresh VM Setup

Commands below assume Ubuntu and user `ubuntu`. If the provider creates a different user, replace `/home/ubuntu` accordingly.

### 5.1 Update base system

```bash
sudo apt update
sudo apt upgrade -y
sudo apt install -y curl wget git rsync tar unzip build-essential nginx ca-certificates gnupg lsof
```

Optional firewall on the VM itself:

```bash
sudo apt install -y ufw
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Still configure the cloud provider security group too. Provider security groups are separate from `ufw`.

### 5.2 Install Node 20

Option A, NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

Option B, nvm:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
node -v
```

If npm is slow from inside China:

```bash
npm config set registry https://registry.npmmirror.com
```

### 5.3 Install PM2

```bash
sudo npm install -g pm2
pm2 -v
```

Enable PM2 startup after the app is running:

```bash
pm2 startup systemd
```

PM2 will print a command with `sudo env PATH=... pm2 startup ...`. Run that printed command.

### 5.4 MongoDB choice

Preferred: use managed MongoDB from the same provider and same region. Put its connection string into `backend/.env` as `MONGO_URI`.

If local MongoDB is needed for first testing, install MongoDB from the provider/official repository, bind it only to localhost, and never open `27017` publicly.

Minimum local MongoDB rules:

```text
bindIp: 127.0.0.1
authorization: enabled if this VM is not disposable
security group: no public 27017
```

Then use a URI like:

```bash
MONGO_URI=mongodb://127.0.0.1:27017/baizhan_V2
```

The backend still forces the database name to `baizhan_V2`, so the path database in the URI is less important than the host/auth options.

## 6. VM Directory Layout

Use the same path as the current PM2 config to reduce surprises:

```bash
sudo mkdir -p /home/ubuntu/zhenchuan
sudo chown -R ubuntu:ubuntu /home/ubuntu/zhenchuan
mkdir -p /home/ubuntu/zhenchuan/logs/latency
mkdir -p /home/ubuntu/zhenchuan/logs/frontend
mkdir -p /home/ubuntu/zhenchuan/logs/client-crashes
```

If your VM user is not `ubuntu`, either adjust paths everywhere or create a dedicated `deploy` user and use `/home/deploy/zhenchuan` consistently.

## 7. Environment Variables on the VM

Do not copy local `.env` files blindly. Create production values on the China VM.

Backend env file:

```bash
cd /home/ubuntu/zhenchuan/backend
nano .env
```

Example:

```bash
NODE_ENV=production
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/baizhan_V2
JWT_SECRET=replace_with_a_long_random_secret
EXPORT_VIEWER_ROOTS=/home/ubuntu/zhenchuan/frontend/public/game/exported-maps
CLIENT_LATENCY_LOG_DIR=/home/ubuntu/zhenchuan/logs/latency
CLIENT_LATENCY_STARRED_FILE=/home/ubuntu/zhenchuan/logs/latency/starred-games.json
```

Generate a strong JWT secret on the VM:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Frontend env file is optional today because `BACKEND_ORIGIN` defaults to `http://127.0.0.1:5000`, but it is clearer to set it:

```bash
cd /home/ubuntu/zhenchuan/frontend
nano .env.production
```

```bash
NODE_ENV=production
BACKEND_ORIGIN=http://127.0.0.1:5000
```

Important:

- Keep `JWT_SECRET` stable after launch. Changing it logs everyone out and invalidates WebSocket auth tokens.
- Do not commit `.env` files.
- Do not expose `MONGO_URI` or `JWT_SECRET` in logs or deployment output.

## 8. PM2 Config for the China VM

The current repository `ecosystem.config.js` includes an unrelated `ocr` app. On the China VM, use a local PM2 config with only this project.

Create `/home/ubuntu/zhenchuan/ecosystem.china.config.js` on the VM:

```js
module.exports = {
  apps: [
    {
      name: "frontend",
      cwd: "/home/ubuntu/zhenchuan/frontend",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      interpreter: "node",
      kill_timeout: 10000,
      env: {
        PORT: 3000,
        NODE_ENV: "production",
        BACKEND_ORIGIN: "http://127.0.0.1:5000"
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
    }
  ]
};
```

Start or reload:

```bash
cd /home/ubuntu/zhenchuan
pm2 start ecosystem.china.config.js
pm2 save
pm2 status frontend backend
```

For later deploys:

```bash
cd /home/ubuntu/zhenchuan
pm2 restart frontend backend --update-env
pm2 status frontend backend
```

## 9. nginx Setup

### 9.1 WebSocket connection header map

Create `/etc/nginx/conf.d/websocket-map.conf`:

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}
```

### 9.2 Site config before SSL

Create `/etc/nginx/sites-available/zhenchuan`:

```nginx
server {
    listen 80;
    server_name game.example.com;

    client_max_body_size 50m;

    location /ws {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 75s;
        proxy_send_timeout 75s;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 75s;
        proxy_send_timeout 75s;
    }

    location /full-exports/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 75s;
        proxy_send_timeout 75s;
    }
}
```

Enable it:

```bash
sudo ln -s /etc/nginx/sites-available/zhenchuan /etc/nginx/sites-enabled/zhenchuan
sudo nginx -t
sudo systemctl reload nginx
```

### 9.3 HTTPS certificate

Install Certbot:

```bash
sudo apt install -y certbot python3-certbot-nginx
```

Issue certificate:

```bash
sudo certbot --nginx -d game.example.com
```

Test renewal:

```bash
sudo certbot renew --dry-run
```

If Certbot cannot validate, check:

- Domain `A` record points to this VM.
- Port `80` is open in the cloud security group.
- ICP/provider domain restrictions are not blocking HTTP.
- nginx config passes `sudo nginx -t`.

## 10. Build Locally Before Shipping

Run from the current development machine:

```bash
cd /home/ubuntu/zhenchuan/backend
npm ci
npm run build

cd /home/ubuntu/zhenchuan/frontend
npm ci
npm run build
```

The current frontend is not using Next standalone output, so do not ship only `.next`. The VM also needs `package.json`, `package-lock.json`, production `node_modules`, `next.config.js`, and `public`.

## 11. Ship From This Machine to the China VM

### Option A: rsync, recommended for normal deploys

From the local development machine:

```bash
cd /home/ubuntu/zhenchuan

rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'logs' \
  --exclude 'test-results' \
  --exclude 'frontend/test-results' \
  --exclude '.tmp-map-viewer-ref' \
  --exclude 'frontend/.next/cache' \
  ./ ubuntu@CHINA_VM_IP:/home/ubuntu/zhenchuan/
```

Then on the China VM:

```bash
cd /home/ubuntu/zhenchuan/backend
npm ci --omit=dev

cd /home/ubuntu/zhenchuan/frontend
npm ci --omit=dev

cd /home/ubuntu/zhenchuan
pm2 restart frontend backend --update-env || pm2 start ecosystem.china.config.js
pm2 status frontend backend
```

Why install dependencies on the VM instead of copying `node_modules`?

- It avoids native-module mismatch if the VM OS differs.
- It keeps transfer size smaller.
- It is more repeatable.

If npm is too slow in China, set the npm mirror on the VM:

```bash
npm config set registry https://registry.npmmirror.com
```

### Option B: tarball release

Create a release archive locally:

```bash
cd /home/ubuntu/zhenchuan
tar \
  --exclude='./.git' \
  --exclude='./backend/node_modules' \
  --exclude='./frontend/node_modules' \
  --exclude='./logs' \
  --exclude='./test-results' \
  --exclude='./frontend/test-results' \
  --exclude='./.tmp-map-viewer-ref' \
  --exclude='./frontend/.next/cache' \
  -czf /tmp/zhenchuan-release.tgz .
```

Upload:

```bash
scp /tmp/zhenchuan-release.tgz ubuntu@CHINA_VM_IP:/tmp/
```

Unpack on VM:

```bash
mkdir -p /home/ubuntu/zhenchuan
tar -xzf /tmp/zhenchuan-release.tgz -C /home/ubuntu/zhenchuan
```

Then run the same dependency install and PM2 restart commands from Option A.

## 12. First Start Checklist on the VM

Run these on the China VM:

```bash
cd /home/ubuntu/zhenchuan/backend
npm ci --omit=dev
node dist/index.js
```

Stop it with `Ctrl+C` after confirming it connects to Mongo and listens on port `5000`.

Then test frontend directly:

```bash
cd /home/ubuntu/zhenchuan/frontend
npm ci --omit=dev
npx next start -p 3000
```

Stop it with `Ctrl+C` after confirming it serves.

Then start both with PM2:

```bash
cd /home/ubuntu/zhenchuan
pm2 start ecosystem.china.config.js
pm2 status frontend backend
pm2 logs frontend --lines 50
pm2 logs backend --lines 50
```

Check local health:

```bash
curl -i http://127.0.0.1:5000/
curl -i http://127.0.0.1:3000/
```

Check nginx:

```bash
sudo nginx -t
curl -i http://game.example.com/
```

After HTTPS:

```bash
curl -i https://game.example.com/
```

## 13. Post-Deploy Browser Verification

Use the public domain from a browser in China or through a China-network tester:

1. Open `https://game.example.com/`.
2. Log in or bootstrap a test account if needed.
3. Create a room.
4. Join with another browser/account.
5. Start a match.
6. Confirm `/ws` connects over WSS.
7. Move both players.
8. Cast one ability.
9. Open PM2 logs and confirm no backend startup errors.

Useful checks:

```bash
pm2 status frontend backend
pm2 logs backend --lines 100
pm2 logs frontend --lines 100
sudo tail -n 100 /var/log/nginx/error.log
```

## 14. Updating the China VM After New Local Changes

Every release:

```bash
cd /home/ubuntu/zhenchuan/backend
npm run build

cd /home/ubuntu/zhenchuan/frontend
npm run build

cd /home/ubuntu/zhenchuan
rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'logs' \
  --exclude 'test-results' \
  --exclude 'frontend/test-results' \
  --exclude '.tmp-map-viewer-ref' \
  --exclude 'frontend/.next/cache' \
  ./ ubuntu@CHINA_VM_IP:/home/ubuntu/zhenchuan/
```

Then on the VM:

```bash
cd /home/ubuntu/zhenchuan/backend
npm ci --omit=dev

cd /home/ubuntu/zhenchuan/frontend
npm ci --omit=dev

cd /home/ubuntu/zhenchuan
pm2 restart frontend backend --update-env
pm2 status frontend backend
```

Only restart `frontend` and `backend`. Do not use `pm2 restart all` on a shared machine.

## 15. Rollback Plan

Before overwriting the VM, keep a dated copy:

```bash
cd /home/ubuntu
cp -a zhenchuan zhenchuan.backup.$(date +%Y%m%d-%H%M%S)
```

Rollback:

```bash
cd /home/ubuntu
mv zhenchuan zhenchuan.failed.$(date +%Y%m%d-%H%M%S)
mv zhenchuan.backup.YYYYMMDD-HHMMSS zhenchuan
cd /home/ubuntu/zhenchuan
pm2 restart frontend backend --update-env
```

For a cleaner future setup, use `/home/ubuntu/zhenchuan/releases/<version>` and a `/home/ubuntu/zhenchuan/current` symlink, then point PM2 at `current`. The current PM2 config uses fixed paths, so the simple copy approach is easier for the first deployment.

## 16. 5-Player Readiness Before Public Use

Infrastructure readiness:

- Budget floor: `2 vCPU / 16 GB RAM / 5-10 Mbps` for one active room.
- More comfortable: `4 vCPU / 8-16 GB RAM / 10-20 Mbps`.
- Prefer same-region MongoDB.
- Watch PM2 memory during a 5-player match.
- Watch nginx outbound traffic during map first-load.

Code readiness still needed:

- Change room capacity from 2 to 5.
- Decide whether auto-start should happen at 2, 5, or host manual start.
- Audit backend logic guarded by `state.players.length === 2`.
- Audit targeting, channel, AOE, winner, disconnect, and HUD behavior with 5 clients.
- Run a real 5-client test before inviting players.

## 17. Common Problems

### WebSocket fails

Check:

- `/ws` nginx location proxies to backend `127.0.0.1:5000`.
- `Upgrade` and `Connection` headers are present.
- Browser uses `wss://` on HTTPS.
- Backend PM2 process is online.

### Login works but game cannot connect

Check:

- `JWT_SECRET` is set on backend.
- Cookies are passed through nginx with `Host` preserved.
- `/api/auth/token` reaches backend and returns `{ ok: true, token }`.

### Backend starts then exits

Check:

- `backend/.env` exists.
- `MONGO_URI` is reachable from the VM.
- `JWT_SECRET` is set.
- `backend/dist/index.js` exists from `npm run build`.

### Exported map assets fail

Check:

- `frontend/public/game/exported-maps` exists on the VM.
- `EXPORT_VIEWER_ROOTS` points to the exported maps root.
- nginx `/full-exports/` routes to backend or frontend consistently.

### Build works locally but VM install is slow

Use:

```bash
npm config set registry https://registry.npmmirror.com
```

If that is still slow, consider building a release image or uploading production `node_modules` from a Linux machine matching the VM OS and CPU architecture.

## 18. Decision Summary

For the first China deployment, choose:

- If budget is tight: `2 vCPU / 16 GB RAM / 40-60 GB SSD / 5-10 Mbps`.
- If budget is comfortable: `4 vCPU / 8-16 GB RAM / 60-80 GB SSD / 10-20 Mbps`.
- Upgrade CPU first if tick stability becomes the problem. Upgrade disk first if local MongoDB, logs, or release backups grow too fast.
- Use VS Code locally, deploy builds by `rsync`.
- Use VS Code Remote SSH only for emergency inspection, not normal development.
- Use nginx + PM2 + Node 20.
- Keep MongoDB in the same China region.
- Complete ICP filing before relying on a mainland public domain over `80/443`.