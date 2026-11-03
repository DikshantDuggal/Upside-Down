# Upside-Down 2.0: Deployment & Hosting Guide
## Deploying Web Frontend and Authoritative Backend

Upside-Down 2.0 is designed for **hosted, cloud-native deployments** (Vercel, Render, Railway, fly.io, Docker) as well as zero-config local running.

---

## 1. Hosting Architecture

- **Frontend (`web/`):** React 19 Single Page App built with Vite. Deployable to **Vercel**, **Netlify**, or **Cloudflare Pages**.
- **Backend (`server/`):** Express Node.js application (LTS 20+) with Server-Sent Events (SSE) and SQLite persistence. Deployable to **Render**, **Railway**, **fly.io**, or **Docker VPS**.

---

## 2. Deploying the Backend (`server/`)

### 2.1 Render / Railway Quick Setup
1. **Repository Root:** Point to `https://github.com/DikshantDuggal/Upside-Down`
2. **Build Command:** `npm install`
3. **Start Command:** `node --experimental-strip-types server/index.ts`
4. **Persistent Disk:**
   - Mount a persistent volume at `/data`
   - Set environment variable: `UD_COORDINATOR_DB=/data/coordinator.db`
5. **Environment Variables:**
   ```bash
   NODE_ENV=production
   PORT=4000
   UD_COORDINATOR_PORT=4000
   UD_ALLOWED_ORIGINS=https://upside-down.vercel.app
   GEMINI_API_KEY=your_gemini_api_key_here # Optional: enables real LLM generation; if absent, defaults to built-in Demo Mode
   ```

### 2.2 Dockerfile
A production container can be built with:
```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 4000
ENV PORT=4000
CMD ["node", "--experimental-strip-types", "server/index.ts"]
```

---

## 3. Deploying the Frontend (`web/`) to Vercel

1. In the Vercel Dashboard, import the repository and set the **Root Directory** to `web`.
2. **Framework Preset:** Vite
3. **Build Command:** `npm run build`
4. **Output Directory:** `dist`
5. **Environment Variables:**
   ```bash
   VITE_API_URL=https://your-upside-down-backend.onrender.com
   ```
6. **Rewrites (`web/vercel.json`):**
   ```json
   {
     "rewrites": [
       { "source": "/api/(.*)", "destination": "https://your-upside-down-backend.onrender.com/api/$1" },
       { "source": "/(.*)", "destination": "/index.html" }
     ]
   }
   ```

---

## 4. Production Checklist

- [x] Node.js v20+ or v22+ installed
- [x] Persistent storage directory for SQLite Write-Ahead Log (`coordinator.db`)
- [x] CORS allowed origin configured for the hosted frontend domain
- [x] Server-Sent Events headers enabled (`Cache-Control: no-cache`, `Connection: keep-alive`)
- [x] Health check endpoint verified: `GET /api/health` returns `200 OK`
