# DVS Industries frontend

React 18 + Vite + Tailwind. Charts use recharts, icons lucide-react,
toasts sonner. The signed-in apps (admin, supplier, client) load on demand.

```bash
npm ci
npm run dev        # http://localhost:5173, proxies /api to the backend on :3000
npm run typecheck
npm run lint
npm test           # Vitest unit tests (src/**/*.test.ts[x])
npm run build
npm run test:e2e   # Playwright; see playwright.config.ts for what it needs
```

Deployed on Vercel (`vercel.json`), which forwards `/api` and `/uploads` to
the API so the browser only ever talks to one origin.
