# BilimBattle Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the BilimBattle frontend — a React + Telegram WebApp SDK Mini App client implementing all 7 screens from the design spec, wired to the already-built-and-deployed backend (REST + Socket.io) at `https://github.com/islombek4642/BilimBattle`.

**Architecture:** A single-page Vite/React/TypeScript app with no router library — navigation is a simple in-memory screen stack (`NavigationContext`) integrated with Telegram's native BackButton. One shared Socket.io connection (`GameSocketContext`) persists across the matchmaking → battle flow. Telegram auth (`initData`) is exchanged for a JWT once at startup (`AuthContext`), then used for both REST calls and the Socket.io handshake.

**Tech Stack:** Vite, React 18, TypeScript, Tailwind CSS, `socket.io-client`, Vitest + React Testing Library (full TDD, matching the backend's rigor) + `@testing-library/user-event` + `@testing-library/jest-dom`.

**Backend API reference:** `backend/src/socket/socketServer.ts`, `backend/src/auth/authRoutes.ts`, `backend/src/questions/questionsRoutes.ts`, `backend/src/leaderboard/leaderboardRoutes.ts`, `backend/src/stats/statsRoutes.ts` (all already built, merged to `master`, verified — see below for exact contracts used throughout this plan).

---

## Backend API Contract (read this before starting — every task below depends on it being exact)

**REST** (base URL `VITE_API_URL`, e.g. `http://localhost:3000/api`):

- `POST /auth/login` — body `{ initData: string, startParam?: string }` → `200 { token: string, user: User }` / `400 { error }` (no initData) / `401 { error }` (invalid initData)
- `GET /categories` — no auth → `200 { categories: { key: string, label: string }[] }`
- `GET /leaderboard/global` — `Authorization: Bearer <token>` → `200 { leaderboard: LeaderboardEntry[] }` / `401`
- `GET /leaderboard/friends` — same auth → `200 { leaderboard: LeaderboardEntry[] }` / `401`
- `GET /stats/me` — same auth → `200 { gamesPlayed, gamesWon, winRate, currentStreak, bestStreak, rating }` / `401`

```typescript
interface User {
  id: number; telegramId: number; username: string | null; firstName: string;
  invitedByTelegramId: number | null; rating: number; gamesPlayed: number;
  gamesWon: number; currentStreak: number; bestStreak: number;
}
interface LeaderboardEntry {
  telegramId: number; firstName: string; username: string | null; rating: number; gamesWon: number;
}
```

**Socket.io** (connect with `auth: { token }` in handshake; `connect_error` fires with message containing `"topilmadi"` if no token, `"yaroqsiz"` if invalid):

Client emits:
- `join_queue` `{ category: string }`
- `leave_queue` `{ category: string }`
- `submit_answer` `{ gameId: string, questionIndex: number, selectedOption: number }`
- `create_invite` `{ category: string }`
- `join_invite` `{ inviterTelegramId: number, category: string }`
- `reconnect_game` `{ gameId: string }` with an **ack callback** → `(ack: { found: boolean, currentQuestionIndex?: number, scores?: {userId:number,score:number}[] }) => void`

Server emits:
- `session_replaced` — no payload (another device logged in; this session should stop)
- `match_found` `{ gameId: string, category: string }`
- `question` `{ index: number, total: number, text: string, options: string[], timeLimitMs: number }` — **never** includes the correct answer
- `question_result` `{ index: number, correctIndex: number, scores: {userId:number,score:number}[] }`
- `game_over` `{ scores: {userId:number,score:number}[], winnerId: number | null, forfeited?: boolean }`
- `invite_created` — no payload (confirms the invite was stored server-side; client now shares the deep link)
- `invite_expired` — no payload (invite not found/expired, or the invitee/inviter is already in another match)

Invite deep link format: `https://t.me/<bot_username>?startapp=invite_<inviterTelegramId>`.

---

## File Structure

```
frontend/
  package.json
  vite.config.ts
  vitest.config.ts
  tailwind.config.js
  postcss.config.js
  tsconfig.json
  tsconfig.node.json
  index.html
  .env.example
  .gitignore
  src/
    main.tsx                        # ReactDOM root
    App.tsx                         # provider tree + screen router
    index.css                       # Tailwind directives
    telegram/
      webApp.ts                     # thin wrapper around window.Telegram.WebApp
    api/
      types.ts                      # shared API DTOs (User, Category, LeaderboardEntry, Stats, ScoreEntry)
      client.ts                     # fetch wrapper (apiGet/apiPost, ApiError)
      auth.ts                       # login()
      questions.ts                  # getCategories()
      leaderboard.ts                # getGlobalLeaderboard(), getFriendsLeaderboard()
      stats.ts                      # getMyStats()
    socket/
      socketClient.ts               # createSocket(token) factory
      useGameSocket.ts               # raw hook: connection + event state + emit helpers
    context/
      AuthContext.tsx               # token/user, runs login() once on mount
      GameSocketContext.tsx          # wraps useGameSocket in a single shared instance
      NavigationContext.tsx          # screen stack + Telegram BackButton integration
    utils/
      category.ts                   # category key -> label lookup
      score.ts                      # win-rate/score formatting helpers
      time.ts                       # ms -> seconds display
      leaderboardRank.ts             # find a telegramId's 1-based rank in a leaderboard array
    components/
      PrimaryButton.tsx
      BottomNav.tsx
      ScoreBar.tsx
      CountdownTimer.tsx
    screens/
      HomeScreen.tsx
      CategorySelectScreen.tsx
      WaitingScreen.tsx
      BattleScreen.tsx
      ResultScreen.tsx
      LeaderboardScreen.tsx
      SettingsScreen.tsx
  tests/
    setup.ts                        # jest-dom matchers
  (every src/**/*.ts(x) above has a co-located *.test.ts(x))
```

**Prerequisites before starting:** Node.js installed. The backend does NOT need to be running for the TDD tasks (everything is unit/component-tested against mocks) — it's only needed for the final manual smoke test (Task 30).

---

## Task 1: Loyihani boshlash (Vite + React + TS + Vitest + RTL scaffold)

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/vitest.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/tsconfig.node.json`
- Create: `frontend/index.html`
- Create: `frontend/.env.example`
- Create: `frontend/.gitignore`
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/index.css`
- Create: `frontend/tests/setup.ts`

- [ ] **Step 1: Initialize the npm project and install dependencies**

```bash
mkdir -p frontend/src frontend/tests
cd frontend
npm init -y
npm install react react-dom socket.io-client
npm install -D typescript vite @vitejs/plugin-react vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @types/react @types/react-dom tailwindcss postcss autoprefixer
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "tests"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 3: Create `tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 4: Create `vite.config.ts`**

```typescript
// frontend/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
```

- [ ] **Step 5: Create `vitest.config.ts`**

```typescript
// frontend/vitest.config.ts
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./tests/setup.ts'],
    },
  })
);
```

- [ ] **Step 6: Create `tests/setup.ts`**

```typescript
// frontend/tests/setup.ts
import '@testing-library/jest-dom';
```

- [ ] **Step 7: Create `.env.example` and `.gitignore`**

`.env.example`:
```
VITE_API_URL=http://localhost:3000/api
VITE_SOCKET_URL=http://localhost:3000
VITE_BOT_USERNAME=bilimbattle_bot
```

`.gitignore`:
```
node_modules/
dist/
.env
```

Copy `.env.example` to `.env` for local development (values above already match the backend's default local dev setup).

- [ ] **Step 8: Add npm scripts to `package.json`**

Merge into the `"scripts"` section:
```json
{
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  }
}
```

- [ ] **Step 9: Create `index.html`**

```html
<!doctype html>
<html lang="uz">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>BilimBattle</title>
    <script src="https://telegram.org/js/telegram-web-app.js"></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 10: Create `src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 11: Create a placeholder `src/App.tsx` and `src/main.tsx` so the project builds**

```tsx
// frontend/src/App.tsx
export default function App() {
  return <div>BilimBattle</div>;
}
```

```tsx
// frontend/src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

(These are placeholders overwritten by Task 29 — this task only exists to prove the toolchain runs.)

- [ ] **Step 12: Verify the toolchain runs**

Run: `npx vitest run`
Expected: `No test files found` (not an error — confirms Vitest itself runs cleanly)

Run: `npx tsc --noEmit`
Expected: no output (clean)

- [ ] **Step 13: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vite.config.ts frontend/vitest.config.ts frontend/tsconfig.json frontend/tsconfig.node.json frontend/index.html frontend/.env.example frontend/.gitignore frontend/src/main.tsx frontend/src/App.tsx frontend/src/index.css frontend/tests/setup.ts
git commit -m "chore: scaffold frontend project with Vite, React, TypeScript, Vitest"
```

---

## Task 2: Tailwind CSS sozlash

**Files:**
- Create: `frontend/tailwind.config.js`
- Create: `frontend/postcss.config.js`

- [ ] **Step 1: Create `tailwind.config.js`**

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
```

- [ ] **Step 2: Create `postcss.config.js`**

```javascript
export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
```

- [ ] **Step 3: Verify Tailwind classes compile**

Temporarily add `className="text-red-500"` to the placeholder `App.tsx`, run `npm run build`, confirm it succeeds with no PostCSS/Tailwind errors, then revert the temporary class change (leave `App.tsx` as the Task 1 placeholder).

- [ ] **Step 4: Commit**

```bash
git add frontend/tailwind.config.js frontend/postcss.config.js
git commit -m "chore: configure Tailwind CSS"
```

---

## Task 3: telegram/webApp.ts — Telegram WebApp SDK wrapper

**Files:**
- Create: `frontend/src/telegram/webApp.ts`
- Test: `frontend/src/telegram/webApp.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/telegram/webApp.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getTelegramWebApp,
  getInitData,
  getStartParam,
  readyWebApp,
  buildInviteLink,
  shareInviteLink,
} from './webApp';

describe('telegram/webApp', () => {
  beforeEach(() => {
    // @ts-expect-error - test-only cleanup of the global
    delete window.Telegram;
  });

  it('returns null when window.Telegram is not present', () => {
    expect(getTelegramWebApp()).toBeNull();
    expect(getInitData()).toBe('');
    expect(getStartParam()).toBeUndefined();
  });

  it('reads initData and start_param from window.Telegram.WebApp', () => {
    window.Telegram = {
      WebApp: {
        initData: 'raw-init-data-string',
        initDataUnsafe: { start_param: 'invite_555' },
      },
    } as any;

    expect(getInitData()).toBe('raw-init-data-string');
    expect(getStartParam()).toBe('invite_555');
  });

  it('calls ready() and expand() on the WebApp when readyWebApp() is invoked', () => {
    const ready = vi.fn();
    const expand = vi.fn();
    window.Telegram = { WebApp: { ready, expand } } as any;

    readyWebApp();

    expect(ready).toHaveBeenCalledOnce();
    expect(expand).toHaveBeenCalledOnce();
  });

  it('does not throw when readyWebApp() is called with no Telegram WebApp present', () => {
    expect(() => readyWebApp()).not.toThrow();
  });

  it('builds an invite deep link with the bot username and inviter telegram id', () => {
    expect(buildInviteLink('bilimbattle_bot', 12345)).toBe(
      'https://t.me/bilimbattle_bot?startapp=invite_12345'
    );
  });

  it('shares a link via openTelegramLink when the WebApp is present', () => {
    const openTelegramLink = vi.fn();
    window.Telegram = { WebApp: { openTelegramLink } } as any;

    shareInviteLink('https://t.me/bilimbattle_bot?startapp=invite_1', "Men bilan o'ynang!");

    expect(openTelegramLink).toHaveBeenCalledOnce();
    const calledUrl = openTelegramLink.mock.calls[0][0] as string;
    expect(calledUrl).toContain('https://t.me/share/url');
    expect(calledUrl).toContain(encodeURIComponent('https://t.me/bilimbattle_bot?startapp=invite_1'));
  });

  it('falls back to window.open when no Telegram WebApp is present', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    shareInviteLink('https://t.me/bilimbattle_bot?startapp=invite_1', "Men bilan o'ynang!");

    expect(openSpy).toHaveBeenCalledOnce();
    openSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/telegram/webApp.test.ts`
Expected: FAIL — `Cannot find module './webApp'`

- [ ] **Step 3: Implement `webApp.ts`**

```typescript
// frontend/src/telegram/webApp.ts
export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { start_param?: string };
  ready(): void;
  expand(): void;
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  BackButton: {
    show(): void;
    hide(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
  };
  HapticFeedback: {
    impactOccurred(style: 'light' | 'medium' | 'heavy'): void;
    notificationOccurred(type: 'success' | 'error' | 'warning'): void;
  };
  openTelegramLink(url: string): void;
  close(): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

export function getTelegramWebApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

export function getInitData(): string {
  return getTelegramWebApp()?.initData ?? '';
}

export function getStartParam(): string | undefined {
  return getTelegramWebApp()?.initDataUnsafe?.start_param;
}

export function readyWebApp(): void {
  const webApp = getTelegramWebApp();
  webApp?.ready();
  webApp?.expand();
}

export function buildInviteLink(botUsername: string, inviterTelegramId: number): string {
  return `https://t.me/${botUsername}?startapp=invite_${inviterTelegramId}`;
}

export function shareInviteLink(link: string, text: string): void {
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
  const webApp = getTelegramWebApp();
  if (webApp) {
    webApp.openTelegramLink(shareUrl);
  } else {
    window.open(shareUrl, '_blank');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/telegram/webApp.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/telegram/webApp.ts frontend/src/telegram/webApp.test.ts
git commit -m "feat: add Telegram WebApp SDK wrapper"
```

---

## Task 4: api/types.ts + api/client.ts — shared DTOs and fetch wrapper

**Files:**
- Create: `frontend/src/api/types.ts`
- Create: `frontend/src/api/client.ts`
- Test: `frontend/src/api/client.test.ts`

- [ ] **Step 1: Create `types.ts` (no test needed — pure type declarations, nothing to execute)**

```typescript
// frontend/src/api/types.ts
export interface User {
  id: number;
  telegramId: number;
  username: string | null;
  firstName: string;
  invitedByTelegramId: number | null;
  rating: number;
  gamesPlayed: number;
  gamesWon: number;
  currentStreak: number;
  bestStreak: number;
}

export interface Category {
  key: string;
  label: string;
}

export interface LeaderboardEntry {
  telegramId: number;
  firstName: string;
  username: string | null;
  rating: number;
  gamesWon: number;
}

export interface Stats {
  gamesPlayed: number;
  gamesWon: number;
  winRate: number;
  currentStreak: number;
  bestStreak: number;
  rating: number;
}

export interface ScoreEntry {
  userId: number;
  score: number;
}
```

- [ ] **Step 2: Write the failing test for `client.ts`**

```typescript
// frontend/src/api/client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiGet, apiPost, ApiError } from './client';

describe('api/client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('apiGet resolves with the parsed JSON body on success', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ hello: 'world' }),
    });

    const result = await apiGet<{ hello: string }>('/ping');

    expect(result).toEqual({ hello: 'world' });
  });

  it('apiGet sends an Authorization header when a token is provided', async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

    await apiGet('/protected', 'my-token');

    const [, options] = (fetch as any).mock.calls[0];
    expect(options.headers.Authorization).toBe('Bearer my-token');
  });

  it('apiPost sends the JSON body and correct method', async () => {
    (fetch as any).mockResolvedValue({ ok: true, json: () => Promise.resolve({ ok: true }) });

    await apiPost('/thing', { a: 1 });

    const [, options] = (fetch as any).mock.calls[0];
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ a: 1 });
  });

  it('throws an ApiError with the response status and server error message on failure', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'initData yuborilmadi' }),
    });

    await expect(apiPost('/auth/login', {})).rejects.toMatchObject({
      status: 400,
      message: 'initData yuborilmadi',
    });
  });

  it('throws a generic ApiError when the failed response has no error body', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('not json')),
    });

    const error = await apiGet('/broken').catch((e) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(500);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/api/client.test.ts`
Expected: FAIL — `Cannot find module './client'`

- [ ] **Step 4: Implement `client.ts`**

```typescript
// frontend/src/api/client.ts
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(res.status, body.error ?? "Noma'lum xatolik yuz berdi");
  }

  return body as T;
}

function authHeaders(token?: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function apiGet<T>(path: string, token?: string): Promise<T> {
  return request<T>(path, { headers: authHeaders(token) });
}

export function apiPost<T>(path: string, data: unknown, token?: string): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: JSON.stringify(data),
    headers: authHeaders(token),
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/api/client.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/api/client.ts frontend/src/api/client.test.ts
git commit -m "feat: add shared API types and fetch client wrapper"
```

---

## Task 5: api/auth.ts

**Files:**
- Create: `frontend/src/api/auth.ts`
- Test: `frontend/src/api/auth.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/api/auth.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as client from './client';
import { login } from './auth';

describe('api/auth', () => {
  it('calls apiPost with /auth/login and the given initData/startParam', async () => {
    const apiPostSpy = vi
      .spyOn(client, 'apiPost')
      .mockResolvedValue({ token: 'abc', user: { id: 1 } } as any);

    const result = await login('raw-init-data', 'invite_555');

    expect(apiPostSpy).toHaveBeenCalledWith('/auth/login', {
      initData: 'raw-init-data',
      startParam: 'invite_555',
    });
    expect(result).toEqual({ token: 'abc', user: { id: 1 } });
  });

  it('omits startParam from the payload key value when not provided (still calls with undefined)', async () => {
    const apiPostSpy = vi.spyOn(client, 'apiPost').mockResolvedValue({ token: 'x', user: {} } as any);

    await login('raw-init-data');

    expect(apiPostSpy).toHaveBeenCalledWith('/auth/login', {
      initData: 'raw-init-data',
      startParam: undefined,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/api/auth.test.ts`
Expected: FAIL — `Cannot find module './auth'`

- [ ] **Step 3: Implement `auth.ts`**

```typescript
// frontend/src/api/auth.ts
import { apiPost } from './client';
import { User } from './types';

export interface LoginResponse {
  token: string;
  user: User;
}

export function login(initData: string, startParam?: string): Promise<LoginResponse> {
  return apiPost<LoginResponse>('/auth/login', { initData, startParam });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/api/auth.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/auth.ts frontend/src/api/auth.test.ts
git commit -m "feat: add auth API client"
```

---

## Task 6: api/questions.ts

**Files:**
- Create: `frontend/src/api/questions.ts`
- Test: `frontend/src/api/questions.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/api/questions.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as client from './client';
import { getCategories } from './questions';

describe('api/questions', () => {
  it('calls apiGet with /categories and returns the response', async () => {
    const apiGetSpy = vi.spyOn(client, 'apiGet').mockResolvedValue({
      categories: [{ key: 'umumiy_bilim', label: 'Umumiy bilim' }],
    });

    const result = await getCategories();

    expect(apiGetSpy).toHaveBeenCalledWith('/categories');
    expect(result.categories).toEqual([{ key: 'umumiy_bilim', label: 'Umumiy bilim' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/api/questions.test.ts`
Expected: FAIL — `Cannot find module './questions'`

- [ ] **Step 3: Implement `questions.ts`**

```typescript
// frontend/src/api/questions.ts
import { apiGet } from './client';
import { Category } from './types';

export function getCategories(): Promise<{ categories: Category[] }> {
  return apiGet<{ categories: Category[] }>('/categories');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/api/questions.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/questions.ts frontend/src/api/questions.test.ts
git commit -m "feat: add categories API client"
```

---

## Task 7: api/leaderboard.ts

**Files:**
- Create: `frontend/src/api/leaderboard.ts`
- Test: `frontend/src/api/leaderboard.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/api/leaderboard.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as client from './client';
import { getGlobalLeaderboard, getFriendsLeaderboard } from './leaderboard';

describe('api/leaderboard', () => {
  it('getGlobalLeaderboard calls apiGet with /leaderboard/global and the token', async () => {
    const apiGetSpy = vi.spyOn(client, 'apiGet').mockResolvedValue({ leaderboard: [] });

    await getGlobalLeaderboard('tok');

    expect(apiGetSpy).toHaveBeenCalledWith('/leaderboard/global', 'tok');
  });

  it('getFriendsLeaderboard calls apiGet with /leaderboard/friends and the token', async () => {
    const apiGetSpy = vi.spyOn(client, 'apiGet').mockResolvedValue({ leaderboard: [] });

    await getFriendsLeaderboard('tok');

    expect(apiGetSpy).toHaveBeenCalledWith('/leaderboard/friends', 'tok');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/api/leaderboard.test.ts`
Expected: FAIL — `Cannot find module './leaderboard'`

- [ ] **Step 3: Implement `leaderboard.ts`**

```typescript
// frontend/src/api/leaderboard.ts
import { apiGet } from './client';
import { LeaderboardEntry } from './types';

export function getGlobalLeaderboard(token: string): Promise<{ leaderboard: LeaderboardEntry[] }> {
  return apiGet<{ leaderboard: LeaderboardEntry[] }>('/leaderboard/global', token);
}

export function getFriendsLeaderboard(token: string): Promise<{ leaderboard: LeaderboardEntry[] }> {
  return apiGet<{ leaderboard: LeaderboardEntry[] }>('/leaderboard/friends', token);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/api/leaderboard.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/leaderboard.ts frontend/src/api/leaderboard.test.ts
git commit -m "feat: add leaderboard API client"
```

---

## Task 8: api/stats.ts

**Files:**
- Create: `frontend/src/api/stats.ts`
- Test: `frontend/src/api/stats.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/api/stats.test.ts
import { describe, it, expect, vi } from 'vitest';
import * as client from './client';
import { getMyStats } from './stats';

describe('api/stats', () => {
  it('calls apiGet with /stats/me and the token', async () => {
    const apiGetSpy = vi.spyOn(client, 'apiGet').mockResolvedValue({
      gamesPlayed: 5, gamesWon: 3, winRate: 60, currentStreak: 1, bestStreak: 2, rating: 1020,
    });

    const result = await getMyStats('tok');

    expect(apiGetSpy).toHaveBeenCalledWith('/stats/me', 'tok');
    expect(result.winRate).toBe(60);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/api/stats.test.ts`
Expected: FAIL — `Cannot find module './stats'`

- [ ] **Step 3: Implement `stats.ts`**

```typescript
// frontend/src/api/stats.ts
import { apiGet } from './client';
import { Stats } from './types';

export function getMyStats(token: string): Promise<Stats> {
  return apiGet<Stats>('/stats/me', token);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/api/stats.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/stats.ts frontend/src/api/stats.test.ts
git commit -m "feat: add stats API client"
```

---

## Task 9: context/AuthContext.tsx

**Files:**
- Create: `frontend/src/context/AuthContext.tsx`
- Test: `frontend/src/context/AuthContext.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/context/AuthContext.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';
import * as authApi from '../api/auth';
import * as telegram from '../telegram/webApp';

function Consumer() {
  const { loading, error, token, user } = useAuth();
  if (loading) return <div>loading</div>;
  if (error) return <div>error: {error}</div>;
  return <div>user: {user?.firstName}, token: {token}</div>;
}

describe('AuthContext', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows an error when no Telegram initData is available', async () => {
    vi.spyOn(telegram, 'getInitData').mockReturnValue('');
    vi.spyOn(telegram, 'getStartParam').mockReturnValue(undefined);

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByText(/error:/)).toBeInTheDocument());
  });

  it('logs in with the Telegram initData and exposes the resulting token/user', async () => {
    vi.spyOn(telegram, 'getInitData').mockReturnValue('raw-init-data');
    vi.spyOn(telegram, 'getStartParam').mockReturnValue('invite_555');
    vi.spyOn(authApi, 'login').mockResolvedValue({
      token: 'jwt-token',
      user: { id: 1, firstName: 'Aziz' } as any,
    });

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );

    expect(screen.getByText('loading')).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByText('user: Aziz, token: jwt-token')).toBeInTheDocument()
    );

    expect(authApi.login).toHaveBeenCalledWith('raw-init-data', 'invite_555');
  });

  it('shows an error when the login API call fails', async () => {
    vi.spyOn(telegram, 'getInitData').mockReturnValue('raw-init-data');
    vi.spyOn(telegram, 'getStartParam').mockReturnValue(undefined);
    vi.spyOn(authApi, 'login').mockRejectedValue(new Error('network down'));

    render(
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    );

    await waitFor(() => expect(screen.getByText(/error:/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/context/AuthContext.test.tsx`
Expected: FAIL — `Cannot find module './AuthContext'`

- [ ] **Step 3: Implement `AuthContext.tsx`**

```tsx
// frontend/src/context/AuthContext.tsx
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { login } from '../api/auth';
import { getInitData, getStartParam } from '../telegram/webApp';
import { User } from '../api/types';

interface AuthContextValue {
  token: string | null;
  user: User | null;
  loading: boolean;
  error: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initData = getInitData();
    if (!initData) {
      setError("Telegram ma'lumotlari topilmadi");
      setLoading(false);
      return;
    }

    login(initData, getStartParam())
      .then((res) => {
        setToken(res.token);
        setUser(res.user);
      })
      .catch(() => {
        setError('Tizimga kirishda xatolik yuz berdi');
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  return (
    <AuthContext.Provider value={{ token, user, loading, error }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/context/AuthContext.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/context/AuthContext.tsx frontend/src/context/AuthContext.test.tsx
git commit -m "feat: add AuthContext with Telegram login flow"
```

---

## Task 10: socket/socketClient.ts

**Files:**
- Create: `frontend/src/socket/socketClient.ts`
- Test: `frontend/src/socket/socketClient.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/socket/socketClient.test.ts
import { describe, it, expect, vi } from 'vitest';
import { io } from 'socket.io-client';
import { createSocket } from './socketClient';

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({ id: 'fake-socket' })),
}));

describe('socket/socketClient', () => {
  it('calls io() with the socket URL, the token in auth, and autoConnect disabled', () => {
    createSocket('my-jwt-token');

    expect(io).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ auth: { token: 'my-jwt-token' }, autoConnect: false })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/socket/socketClient.test.ts`
Expected: FAIL — `Cannot find module './socketClient'`

- [ ] **Step 3: Implement `socketClient.ts`**

```typescript
// frontend/src/socket/socketClient.ts
import { io, Socket } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:3000';

export function createSocket(token: string): Socket {
  return io(SOCKET_URL, {
    auth: { token },
    autoConnect: false,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/socket/socketClient.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/socket/socketClient.ts frontend/src/socket/socketClient.test.ts
git commit -m "feat: add Socket.io client factory"
```

---

## Task 11: socket/useGameSocket.ts — the real-time event hook

**Files:**
- Create: `frontend/src/socket/useGameSocket.ts`
- Test: `frontend/src/socket/useGameSocket.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/socket/useGameSocket.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useGameSocket } from './useGameSocket';
import { createSocket } from './socketClient';

vi.mock('./socketClient', () => ({
  createSocket: vi.fn(),
}));

function createFakeSocket() {
  const listeners: Record<string, (payload?: any, ack?: any) => void> = {};
  return {
    on: vi.fn((event: string, cb: any) => {
      listeners[event] = cb;
    }),
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    __trigger: (event: string, payload?: any, ack?: any) => {
      listeners[event]?.(payload, ack);
    },
  };
}

describe('useGameSocket', () => {
  let fakeSocket: ReturnType<typeof createFakeSocket>;

  beforeEach(() => {
    fakeSocket = createFakeSocket();
    (createSocket as any).mockReturnValue(fakeSocket);
  });

  it('does not create a socket when token is null', () => {
    renderHook(() => useGameSocket(null));
    expect(createSocket).not.toHaveBeenCalled();
  });

  it('connects the socket when a token is provided and updates connected state', async () => {
    const { result } = renderHook(() => useGameSocket('tok'));

    expect(createSocket).toHaveBeenCalledWith('tok');
    expect(fakeSocket.connect).toHaveBeenCalledOnce();
    expect(result.current.connected).toBe(false);

    act(() => fakeSocket.__trigger('connect'));

    await waitFor(() => expect(result.current.connected).toBe(true));
  });

  it('exposes match_found, question, question_result, and game_over payloads as they arrive', async () => {
    const { result } = renderHook(() => useGameSocket('tok'));

    act(() => fakeSocket.__trigger('match_found', { gameId: 'g1', category: 'umumiy_bilim' }));
    await waitFor(() => expect(result.current.matchFound).toEqual({ gameId: 'g1', category: 'umumiy_bilim' }));

    act(() =>
      fakeSocket.__trigger('question', {
        index: 0, total: 7, text: 'Q1?', options: ['A', 'B'], timeLimitMs: 10000,
      })
    );
    await waitFor(() => expect(result.current.question?.text).toBe('Q1?'));

    act(() =>
      fakeSocket.__trigger('question_result', {
        index: 0, correctIndex: 1, scores: [{ userId: 1, score: 100 }],
      })
    );
    await waitFor(() => expect(result.current.questionResult?.correctIndex).toBe(1));

    act(() =>
      fakeSocket.__trigger('game_over', { scores: [{ userId: 1, score: 700 }], winnerId: 1 })
    );
    await waitFor(() => expect(result.current.gameOver?.winnerId).toBe(1));
  });

  it('clears questionResult when a new question event arrives', async () => {
    const { result } = renderHook(() => useGameSocket('tok'));

    act(() =>
      fakeSocket.__trigger('question_result', { index: 0, correctIndex: 1, scores: [] })
    );
    await waitFor(() => expect(result.current.questionResult).not.toBeNull());

    act(() =>
      fakeSocket.__trigger('question', { index: 1, total: 7, text: 'Q2?', options: [], timeLimitMs: 10000 })
    );
    await waitFor(() => expect(result.current.questionResult).toBeNull());
  });

  it('sets sessionReplaced, inviteCreated, and inviteExpired flags on their respective events', async () => {
    const { result } = renderHook(() => useGameSocket('tok'));

    act(() => fakeSocket.__trigger('session_replaced'));
    await waitFor(() => expect(result.current.sessionReplaced).toBe(true));

    act(() => fakeSocket.__trigger('invite_created'));
    await waitFor(() => expect(result.current.inviteCreated).toBe(true));

    act(() => fakeSocket.__trigger('invite_expired'));
    await waitFor(() => expect(result.current.inviteExpired).toBe(true));
  });

  it('joinQueue/leaveQueue/submitAnswer/createInvite/joinInvite emit the correct events and payloads', () => {
    const { result } = renderHook(() => useGameSocket('tok'));

    result.current.joinQueue('umumiy_bilim');
    expect(fakeSocket.emit).toHaveBeenCalledWith('join_queue', { category: 'umumiy_bilim' });

    result.current.leaveQueue('umumiy_bilim');
    expect(fakeSocket.emit).toHaveBeenCalledWith('leave_queue', { category: 'umumiy_bilim' });

    result.current.submitAnswer('game-1', 2, 3);
    expect(fakeSocket.emit).toHaveBeenCalledWith('submit_answer', {
      gameId: 'game-1', questionIndex: 2, selectedOption: 3,
    });

    result.current.createInvite('sport_kino_musiqa');
    expect(fakeSocket.emit).toHaveBeenCalledWith('create_invite', { category: 'sport_kino_musiqa' });

    result.current.joinInvite(999, 'umumiy_bilim');
    expect(fakeSocket.emit).toHaveBeenCalledWith('join_invite', {
      inviterTelegramId: 999, category: 'umumiy_bilim',
    });
  });

  it('reconnectGame emits reconnect_game and resolves with the ack payload', async () => {
    const { result } = renderHook(() => useGameSocket('tok'));

    fakeSocket.emit.mockImplementation((event: string, payload: any, ack: any) => {
      if (event === 'reconnect_game') {
        ack({ found: true, currentQuestionIndex: 3, scores: [] });
      }
    });

    const ack = await result.current.reconnectGame('game-1');

    expect(fakeSocket.emit).toHaveBeenCalledWith('reconnect_game', { gameId: 'game-1' }, expect.any(Function));
    expect(ack).toEqual({ found: true, currentQuestionIndex: 3, scores: [] });
  });

  it('disconnects the socket on unmount', () => {
    const { unmount } = renderHook(() => useGameSocket('tok'));
    unmount();
    expect(fakeSocket.disconnect).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/socket/useGameSocket.test.ts`
Expected: FAIL — `Cannot find module './useGameSocket'`

- [ ] **Step 3: Implement `useGameSocket.ts`**

```typescript
// frontend/src/socket/useGameSocket.ts
import { useEffect, useRef, useState, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import { createSocket } from './socketClient';
import { ScoreEntry } from '../api/types';

export interface QuestionPayload {
  index: number;
  total: number;
  text: string;
  options: string[];
  timeLimitMs: number;
}

export interface QuestionResultPayload {
  index: number;
  correctIndex: number;
  scores: ScoreEntry[];
}

export interface GameOverPayload {
  scores: ScoreEntry[];
  winnerId: number | null;
  forfeited?: boolean;
}

export interface MatchFoundPayload {
  gameId: string;
  category: string;
}

export interface ReconnectAck {
  found: boolean;
  currentQuestionIndex?: number;
  scores?: ScoreEntry[];
}

export interface UseGameSocketResult {
  connected: boolean;
  matchFound: MatchFoundPayload | null;
  question: QuestionPayload | null;
  questionResult: QuestionResultPayload | null;
  gameOver: GameOverPayload | null;
  sessionReplaced: boolean;
  inviteCreated: boolean;
  inviteExpired: boolean;
  joinQueue: (category: string) => void;
  leaveQueue: (category: string) => void;
  submitAnswer: (gameId: string, questionIndex: number, selectedOption: number) => void;
  createInvite: (category: string) => void;
  joinInvite: (inviterTelegramId: number, category: string) => void;
  reconnectGame: (gameId: string) => Promise<ReconnectAck>;
  clearMatchFound: () => void;
  clearQuestionResult: () => void;
  clearGameOver: () => void;
  clearInviteCreated: () => void;
  clearInviteExpired: () => void;
}

export function useGameSocket(token: string | null): UseGameSocketResult {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [matchFound, setMatchFound] = useState<MatchFoundPayload | null>(null);
  const [question, setQuestion] = useState<QuestionPayload | null>(null);
  const [questionResult, setQuestionResult] = useState<QuestionResultPayload | null>(null);
  const [gameOver, setGameOver] = useState<GameOverPayload | null>(null);
  const [sessionReplaced, setSessionReplaced] = useState(false);
  const [inviteCreated, setInviteCreated] = useState(false);
  const [inviteExpired, setInviteExpired] = useState(false);

  useEffect(() => {
    if (!token) return;

    const socket = createSocket(token);
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('match_found', (payload: MatchFoundPayload) => setMatchFound(payload));
    socket.on('question', (payload: QuestionPayload) => {
      setQuestion(payload);
      setQuestionResult(null);
    });
    socket.on('question_result', (payload: QuestionResultPayload) => setQuestionResult(payload));
    socket.on('game_over', (payload: GameOverPayload) => setGameOver(payload));
    socket.on('session_replaced', () => setSessionReplaced(true));
    socket.on('invite_created', () => setInviteCreated(true));
    socket.on('invite_expired', () => setInviteExpired(true));

    socket.connect();

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [token]);

  const joinQueue = useCallback((category: string) => {
    socketRef.current?.emit('join_queue', { category });
  }, []);

  const leaveQueue = useCallback((category: string) => {
    socketRef.current?.emit('leave_queue', { category });
  }, []);

  const submitAnswer = useCallback(
    (gameId: string, questionIndex: number, selectedOption: number) => {
      socketRef.current?.emit('submit_answer', { gameId, questionIndex, selectedOption });
    },
    []
  );

  const createInvite = useCallback((category: string) => {
    socketRef.current?.emit('create_invite', { category });
  }, []);

  const joinInvite = useCallback((inviterTelegramId: number, category: string) => {
    socketRef.current?.emit('join_invite', { inviterTelegramId, category });
  }, []);

  const reconnectGame = useCallback((gameId: string): Promise<ReconnectAck> => {
    return new Promise((resolve) => {
      socketRef.current?.emit('reconnect_game', { gameId }, (ack: ReconnectAck) => resolve(ack));
    });
  }, []);

  const clearMatchFound = useCallback(() => setMatchFound(null), []);
  const clearQuestionResult = useCallback(() => setQuestionResult(null), []);
  const clearGameOver = useCallback(() => setGameOver(null), []);
  const clearInviteCreated = useCallback(() => setInviteCreated(false), []);
  const clearInviteExpired = useCallback(() => setInviteExpired(false), []);

  return {
    connected,
    matchFound,
    question,
    questionResult,
    gameOver,
    sessionReplaced,
    inviteCreated,
    inviteExpired,
    joinQueue,
    leaveQueue,
    submitAnswer,
    createInvite,
    joinInvite,
    reconnectGame,
    clearMatchFound,
    clearQuestionResult,
    clearGameOver,
    clearInviteCreated,
    clearInviteExpired,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/socket/useGameSocket.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/socket/useGameSocket.ts frontend/src/socket/useGameSocket.test.ts
git commit -m "feat: add useGameSocket hook for real-time game events"
```

---

## Task 12: context/GameSocketContext.tsx — single shared socket instance

**Files:**
- Create: `frontend/src/context/GameSocketContext.tsx`
- Test: `frontend/src/context/GameSocketContext.test.tsx`

**Why this file exists:** every screen from Kategoriya tanlash through Natija needs the SAME socket connection (it persists across matchmaking → battle). If each screen called `useGameSocket` directly, each would open its own connection. This context calls the hook exactly once and shares the result via `useGameSocketContext()`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/context/GameSocketContext.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GameSocketProvider, useGameSocketContext } from './GameSocketContext';
import * as authContext from './AuthContext';
import * as gameSocketHook from '../socket/useGameSocket';

function Consumer() {
  const { connected } = useGameSocketContext();
  return <div>connected: {String(connected)}</div>;
}

describe('GameSocketContext', () => {
  it('calls useGameSocket exactly once with the current auth token and shares the result', () => {
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'shared-token', user: null, loading: false, error: null,
    });
    const useGameSocketSpy = vi.spyOn(gameSocketHook, 'useGameSocket').mockReturnValue({
      connected: true,
    } as any);

    render(
      <GameSocketProvider>
        <Consumer />
        <Consumer />
      </GameSocketProvider>
    );

    expect(useGameSocketSpy).toHaveBeenCalledOnce();
    expect(useGameSocketSpy).toHaveBeenCalledWith('shared-token');
    expect(screen.getAllByText('connected: true')).toHaveLength(2);
  });

  it('throws when useGameSocketContext is used outside the provider', () => {
    function Bare() {
      useGameSocketContext();
      return null;
    }
    // Suppress the expected React error-boundary console noise for this one assertion.
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Bare />)).toThrow('useGameSocketContext must be used within GameSocketProvider');
    consoleSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/context/GameSocketContext.test.tsx`
Expected: FAIL — `Cannot find module './GameSocketContext'`

- [ ] **Step 3: Implement `GameSocketContext.tsx`**

```tsx
// frontend/src/context/GameSocketContext.tsx
import { createContext, useContext, ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { useGameSocket, UseGameSocketResult } from '../socket/useGameSocket';

const GameSocketContext = createContext<UseGameSocketResult | null>(null);

export function GameSocketProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const socket = useGameSocket(token);

  return <GameSocketContext.Provider value={socket}>{children}</GameSocketContext.Provider>;
}

export function useGameSocketContext(): UseGameSocketResult {
  const ctx = useContext(GameSocketContext);
  if (!ctx) throw new Error('useGameSocketContext must be used within GameSocketProvider');
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/context/GameSocketContext.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/context/GameSocketContext.tsx frontend/src/context/GameSocketContext.test.tsx
git commit -m "feat: add GameSocketContext for a single shared socket connection"
```

---

## Task 13: context/NavigationContext.tsx — screen stack + Telegram BackButton

**Files:**
- Create: `frontend/src/context/NavigationContext.tsx`
- Test: `frontend/src/context/NavigationContext.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/context/NavigationContext.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NavigationProvider, useNavigation } from './NavigationContext';
import * as telegram from '../telegram/webApp';

function Consumer() {
  const { current, navigate, goBack, replace, reset } = useNavigation();
  return (
    <div>
      <div>current: {current.name}</div>
      <button onClick={() => navigate({ name: 'leaderboard' })}>go-leaderboard</button>
      <button onClick={() => replace({ name: 'settings' })}>replace-settings</button>
      <button onClick={() => reset({ name: 'home' })}>reset-home</button>
      <button onClick={goBack}>back</button>
    </div>
  );
}

describe('NavigationContext', () => {
  let backButtonMock: { show: ReturnType<typeof vi.fn>; hide: ReturnType<typeof vi.fn>; onClick: ReturnType<typeof vi.fn>; offClick: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    backButtonMock = { show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() };
    vi.spyOn(telegram, 'getTelegramWebApp').mockReturnValue({
      BackButton: backButtonMock,
    } as any);
  });

  it('starts on the home screen', () => {
    render(
      <NavigationProvider>
        <Consumer />
      </NavigationProvider>
    );
    expect(screen.getByText('current: home')).toBeInTheDocument();
  });

  it('navigate pushes a new screen and goBack returns to the previous one', () => {
    render(
      <NavigationProvider>
        <Consumer />
      </NavigationProvider>
    );

    fireEvent.click(screen.getByText('go-leaderboard'));
    expect(screen.getByText('current: leaderboard')).toBeInTheDocument();

    fireEvent.click(screen.getByText('back'));
    expect(screen.getByText('current: home')).toBeInTheDocument();
  });

  it('replace swaps the current screen without growing the stack', () => {
    render(
      <NavigationProvider>
        <Consumer />
      </NavigationProvider>
    );

    fireEvent.click(screen.getByText('go-leaderboard'));
    fireEvent.click(screen.getByText('replace-settings'));
    expect(screen.getByText('current: settings')).toBeInTheDocument();

    fireEvent.click(screen.getByText('back'));
    expect(screen.getByText('current: home')).toBeInTheDocument();
  });

  it('reset clears the whole stack down to a single screen', () => {
    render(
      <NavigationProvider>
        <Consumer />
      </NavigationProvider>
    );

    fireEvent.click(screen.getByText('go-leaderboard'));
    fireEvent.click(screen.getByText('reset-home'));
    fireEvent.click(screen.getByText('back'));
    expect(screen.getByText('current: home')).toBeInTheDocument();
  });

  it('shows the Telegram BackButton once the stack has more than one screen', () => {
    render(
      <NavigationProvider>
        <Consumer />
      </NavigationProvider>
    );

    expect(backButtonMock.hide).toHaveBeenCalled();

    fireEvent.click(screen.getByText('go-leaderboard'));
    expect(backButtonMock.show).toHaveBeenCalled();
  });

  it('hides the BackButton while on the battle screen even if the stack has history', () => {
    function BattleConsumer() {
      const { current, navigate } = useNavigation();
      return (
        <div>
          <div>current: {current.name}</div>
          <button onClick={() => navigate({ name: 'battle', gameId: 'g1', category: 'umumiy_bilim' })}>
            go-battle
          </button>
        </div>
      );
    }

    render(
      <NavigationProvider>
        <BattleConsumer />
      </NavigationProvider>
    );

    fireEvent.click(screen.getByText('go-battle'));
    expect(backButtonMock.hide).toHaveBeenLastCalledWith();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/context/NavigationContext.test.tsx`
Expected: FAIL — `Cannot find module './NavigationContext'`

- [ ] **Step 3: Implement `NavigationContext.tsx`**

```tsx
// frontend/src/context/NavigationContext.tsx
import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { getTelegramWebApp } from '../telegram/webApp';
import { ScoreEntry } from '../api/types';

export type Screen =
  | { name: 'home' }
  | { name: 'categorySelect'; intent: 'quick' | 'invite' }
  | { name: 'waiting'; category: string; intent: 'quick' | 'invite' }
  | { name: 'battle'; gameId: string; category: string }
  | { name: 'result'; scores: ScoreEntry[]; winnerId: number | null; forfeited: boolean }
  | { name: 'leaderboard' }
  | { name: 'settings' };

interface NavigationContextValue {
  current: Screen;
  navigate: (screen: Screen) => void;
  goBack: () => void;
  replace: (screen: Screen) => void;
  reset: (screen: Screen) => void;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Screen[]>([{ name: 'home' }]);

  const navigate = useCallback((screen: Screen) => {
    setStack((prev) => [...prev, screen]);
  }, []);

  const goBack = useCallback(() => {
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const replace = useCallback((screen: Screen) => {
    setStack((prev) => [...prev.slice(0, -1), screen]);
  }, []);

  const reset = useCallback((screen: Screen) => {
    setStack([screen]);
  }, []);

  const current = stack[stack.length - 1];

  useEffect(() => {
    const webApp = getTelegramWebApp();
    if (!webApp) return;

    const shouldShowBack = stack.length > 1 && current.name !== 'battle';
    if (shouldShowBack) {
      webApp.BackButton.show();
    } else {
      webApp.BackButton.hide();
    }

    webApp.BackButton.onClick(goBack);
    return () => webApp.BackButton.offClick(goBack);
  }, [stack.length, current.name, goBack]);

  return (
    <NavigationContext.Provider value={{ current, navigate, goBack, replace, reset }}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigation(): NavigationContextValue {
  const ctx = useContext(NavigationContext);
  if (!ctx) throw new Error('useNavigation must be used within NavigationProvider');
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/context/NavigationContext.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/context/NavigationContext.tsx frontend/src/context/NavigationContext.test.tsx
git commit -m "feat: add NavigationContext with Telegram BackButton integration"
```

---

## Task 14: utils/category.ts

**Files:**
- Create: `frontend/src/utils/category.ts`
- Test: `frontend/src/utils/category.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/utils/category.test.ts
import { describe, it, expect } from 'vitest';
import { categoryLabel } from './category';

describe('utils/category', () => {
  it('returns the known Uzbek label for a known category key', () => {
    expect(categoryLabel('umumiy_bilim')).toBe('Umumiy bilim');
    expect(categoryLabel('sport_kino_musiqa')).toBe('Sport/Kino/Musiqa');
  });

  it('falls back to the raw key for an unknown category', () => {
    expect(categoryLabel('unknown_key')).toBe('unknown_key');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/category.test.ts`
Expected: FAIL — `Cannot find module './category'`

- [ ] **Step 3: Implement `category.ts`**

```typescript
// frontend/src/utils/category.ts
const CATEGORY_LABELS: Record<string, string> = {
  umumiy_bilim: 'Umumiy bilim',
  sport_kino_musiqa: 'Sport/Kino/Musiqa',
};

export function categoryLabel(key: string): string {
  return CATEGORY_LABELS[key] ?? key;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/category.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/category.ts frontend/src/utils/category.test.ts
git commit -m "feat: add category label lookup util"
```

---

## Task 15: utils/score.ts

**Files:**
- Create: `frontend/src/utils/score.ts`
- Test: `frontend/src/utils/score.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/utils/score.test.ts
import { describe, it, expect } from 'vitest';
import { findMyScore, findOpponentScore } from './score';

describe('utils/score', () => {
  const scores = [
    { userId: 1, score: 450 },
    { userId: 2, score: 300 },
  ];

  it('findMyScore returns the score entry matching the given userId', () => {
    expect(findMyScore(scores, 1)).toBe(450);
  });

  it('findMyScore returns 0 when the userId is not present', () => {
    expect(findMyScore(scores, 999)).toBe(0);
  });

  it('findOpponentScore returns the score entry NOT matching the given userId', () => {
    expect(findOpponentScore(scores, 1)).toBe(300);
  });

  it('findOpponentScore returns 0 when there is no other entry', () => {
    expect(findOpponentScore([{ userId: 1, score: 100 }], 1)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/score.test.ts`
Expected: FAIL — `Cannot find module './score'`

- [ ] **Step 3: Implement `score.ts`**

```typescript
// frontend/src/utils/score.ts
import { ScoreEntry } from '../api/types';

export function findMyScore(scores: ScoreEntry[], myUserId: number): number {
  return scores.find((s) => s.userId === myUserId)?.score ?? 0;
}

export function findOpponentScore(scores: ScoreEntry[], myUserId: number): number {
  return scores.find((s) => s.userId !== myUserId)?.score ?? 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/score.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/score.ts frontend/src/utils/score.test.ts
git commit -m "feat: add score lookup utils"
```

---

## Task 16: utils/time.ts

**Files:**
- Create: `frontend/src/utils/time.ts`
- Test: `frontend/src/utils/time.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/utils/time.test.ts
import { describe, it, expect } from 'vitest';
import { msToSeconds } from './time';

describe('utils/time', () => {
  it('rounds up to the nearest whole second', () => {
    expect(msToSeconds(10000)).toBe(10);
    expect(msToSeconds(9001)).toBe(10);
    expect(msToSeconds(9000)).toBe(9);
  });

  it('never returns a negative number', () => {
    expect(msToSeconds(-500)).toBe(0);
  });

  it('returns 0 for exactly 0ms', () => {
    expect(msToSeconds(0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/time.test.ts`
Expected: FAIL — `Cannot find module './time'`

- [ ] **Step 3: Implement `time.ts`**

```typescript
// frontend/src/utils/time.ts
export function msToSeconds(ms: number): number {
  return Math.max(Math.ceil(ms / 1000), 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/time.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/time.ts frontend/src/utils/time.test.ts
git commit -m "feat: add ms-to-seconds display util"
```

---

## Task 17: utils/leaderboardRank.ts

**Files:**
- Create: `frontend/src/utils/leaderboardRank.ts`
- Test: `frontend/src/utils/leaderboardRank.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// frontend/src/utils/leaderboardRank.test.ts
import { describe, it, expect } from 'vitest';
import { findRank } from './leaderboardRank';
import { LeaderboardEntry } from '../api/types';

describe('utils/leaderboardRank', () => {
  const entries: LeaderboardEntry[] = [
    { telegramId: 111, firstName: 'A', username: null, rating: 1200, gamesWon: 5 },
    { telegramId: 222, firstName: 'B', username: null, rating: 1100, gamesWon: 3 },
  ];

  it('returns the 1-based position of a present telegramId', () => {
    expect(findRank(entries, 111)).toBe(1);
    expect(findRank(entries, 222)).toBe(2);
  });

  it('returns null when the telegramId is not in the list', () => {
    expect(findRank(entries, 999)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/leaderboardRank.test.ts`
Expected: FAIL — `Cannot find module './leaderboardRank'`

- [ ] **Step 3: Implement `leaderboardRank.ts`**

```typescript
// frontend/src/utils/leaderboardRank.ts
import { LeaderboardEntry } from '../api/types';

export function findRank(entries: LeaderboardEntry[], telegramId: number): number | null {
  const index = entries.findIndex((e) => e.telegramId === telegramId);
  return index === -1 ? null : index + 1;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/leaderboardRank.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/leaderboardRank.ts frontend/src/utils/leaderboardRank.test.ts
git commit -m "feat: add leaderboard rank lookup util"
```

---

## Task 18: components/PrimaryButton.tsx

**Files:**
- Create: `frontend/src/components/PrimaryButton.tsx`
- Test: `frontend/src/components/PrimaryButton.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/PrimaryButton.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PrimaryButton } from './PrimaryButton';

describe('PrimaryButton', () => {
  it('renders its children and responds to a click', async () => {
    const onClick = vi.fn();
    render(<PrimaryButton onClick={onClick}>Tezkor o'yin</PrimaryButton>);

    const button = screen.getByRole('button', { name: "Tezkor o'yin" });
    await userEvent.click(button);

    expect(onClick).toHaveBeenCalledOnce();
  });

  it('respects the disabled prop', () => {
    render(<PrimaryButton disabled>Band</PrimaryButton>);
    expect(screen.getByRole('button', { name: 'Band' })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/PrimaryButton.test.tsx`
Expected: FAIL — `Cannot find module './PrimaryButton'`

- [ ] **Step 3: Implement `PrimaryButton.tsx`**

```tsx
// frontend/src/components/PrimaryButton.tsx
import { ButtonHTMLAttributes } from 'react';

export function PrimaryButton({
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`w-full rounded-lg bg-blue-600 py-3 font-semibold text-white disabled:opacity-50 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/PrimaryButton.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/PrimaryButton.tsx frontend/src/components/PrimaryButton.test.tsx
git commit -m "feat: add shared PrimaryButton component"
```

---

## Task 19: components/ScoreBar.tsx

**Files:**
- Create: `frontend/src/components/ScoreBar.tsx`
- Test: `frontend/src/components/ScoreBar.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/ScoreBar.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScoreBar } from './ScoreBar';
import * as authContext from '../context/AuthContext';

describe('ScoreBar', () => {
  it('shows "Siz" for the score entry matching the logged-in user and "Raqib" for the other', () => {
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1 } as any, loading: false, error: null,
    });

    render(
      <ScoreBar
        scores={[
          { userId: 1, score: 450 },
          { userId: 2, score: 300 },
        ]}
      />
    );

    expect(screen.getByText(/Siz: 450/)).toBeInTheDocument();
    expect(screen.getByText(/Raqib: 300/)).toBeInTheDocument();
  });

  it('renders zeros when scores is empty', () => {
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1 } as any, loading: false, error: null,
    });

    render(<ScoreBar scores={[]} />);

    expect(screen.getByText(/Siz: 0/)).toBeInTheDocument();
    expect(screen.getByText(/Raqib: 0/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ScoreBar.test.tsx`
Expected: FAIL — `Cannot find module './ScoreBar'`

- [ ] **Step 3: Implement `ScoreBar.tsx`**

```tsx
// frontend/src/components/ScoreBar.tsx
import { useAuth } from '../context/AuthContext';
import { ScoreEntry } from '../api/types';
import { findMyScore, findOpponentScore } from '../utils/score';

export function ScoreBar({ scores }: { scores: ScoreEntry[] }) {
  const { user } = useAuth();
  const myUserId = user?.id ?? -1;

  return (
    <div className="flex justify-between text-sm font-semibold" data-testid="score-bar">
      <span>Siz: {findMyScore(scores, myUserId)}</span>
      <span>Raqib: {findOpponentScore(scores, myUserId)}</span>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/ScoreBar.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ScoreBar.tsx frontend/src/components/ScoreBar.test.tsx
git commit -m "feat: add ScoreBar component"
```

---

## Task 20: components/CountdownTimer.tsx

**Files:**
- Create: `frontend/src/components/CountdownTimer.tsx`
- Test: `frontend/src/components/CountdownTimer.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/CountdownTimer.test.tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { CountdownTimer } from './CountdownTimer';

describe('CountdownTimer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the full duration in seconds immediately on mount', () => {
    render(<CountdownTimer timeLimitMs={10000} />);
    expect(screen.getByTestId('countdown-timer')).toHaveTextContent('10s');
  });

  it('counts down as time passes', () => {
    render(<CountdownTimer timeLimitMs={10000} />);

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(screen.getByTestId('countdown-timer')).toHaveTextContent('7s');
  });

  it('never displays a negative number once the limit is exceeded', () => {
    render(<CountdownTimer timeLimitMs={1000} />);

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.getByTestId('countdown-timer')).toHaveTextContent('0s');
  });

  it('resets when timeLimitMs changes (a new question starts)', () => {
    const { rerender } = render(<CountdownTimer key="q0" timeLimitMs={10000} />);

    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(screen.getByTestId('countdown-timer')).toHaveTextContent('2s');

    rerender(<CountdownTimer key="q1" timeLimitMs={10000} />);
    expect(screen.getByTestId('countdown-timer')).toHaveTextContent('10s');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/CountdownTimer.test.tsx`
Expected: FAIL — `Cannot find module './CountdownTimer'`

- [ ] **Step 3: Implement `CountdownTimer.tsx`**

```tsx
// frontend/src/components/CountdownTimer.tsx
import { useEffect, useState } from 'react';
import { msToSeconds } from '../utils/time';

export function CountdownTimer({ timeLimitMs }: { timeLimitMs: number }) {
  const [remainingMs, setRemainingMs] = useState(timeLimitMs);

  useEffect(() => {
    setRemainingMs(timeLimitMs);
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      setRemainingMs(Math.max(timeLimitMs - elapsed, 0));
    }, 100);
    return () => clearInterval(interval);
  }, [timeLimitMs]);

  return (
    <div className="text-center text-2xl font-bold" data-testid="countdown-timer">
      {msToSeconds(remainingMs)}s
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/CountdownTimer.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/CountdownTimer.tsx frontend/src/components/CountdownTimer.test.tsx
git commit -m "feat: add CountdownTimer component"
```

---

## Task 21: components/BottomNav.tsx

**Files:**
- Create: `frontend/src/components/BottomNav.tsx`
- Test: `frontend/src/components/BottomNav.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/components/BottomNav.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NavigationProvider, useNavigation } from '../context/NavigationContext';
import { BottomNav } from './BottomNav';

function CurrentScreenLabel() {
  const { current } = useNavigation();
  return <div>current: {current.name}</div>;
}

describe('BottomNav', () => {
  it('renders three tabs and navigates (via reset) when clicked', () => {
    render(
      <NavigationProvider>
        <CurrentScreenLabel />
        <BottomNav />
      </NavigationProvider>
    );

    expect(screen.getByText('Bosh sahifa')).toBeInTheDocument();
    expect(screen.getByText('Reyting')).toBeInTheDocument();
    expect(screen.getByText('Sozlamalar')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Reyting'));
    expect(screen.getByText('current: leaderboard')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Sozlamalar'));
    expect(screen.getByText('current: settings')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/BottomNav.test.tsx`
Expected: FAIL — `Cannot find module './BottomNav'`

- [ ] **Step 3: Implement `BottomNav.tsx`**

```tsx
// frontend/src/components/BottomNav.tsx
import { useNavigation } from '../context/NavigationContext';

const TABS = [
  { name: 'home' as const, label: 'Bosh sahifa' },
  { name: 'leaderboard' as const, label: 'Reyting' },
  { name: 'settings' as const, label: 'Sozlamalar' },
];

export function BottomNav() {
  const { current, reset } = useNavigation();

  return (
    <nav className="flex justify-around border-t bg-white py-2" data-testid="bottom-nav">
      {TABS.map((tab) => (
        <button
          key={tab.name}
          className={`text-sm font-medium ${
            current.name === tab.name ? 'text-blue-600' : 'text-gray-400'
          }`}
          onClick={() => reset({ name: tab.name })}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/BottomNav.test.tsx`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/BottomNav.tsx frontend/src/components/BottomNav.test.tsx
git commit -m "feat: add BottomNav component"
```

---

## Task 22: screens/HomeScreen.tsx

**Files:**
- Create: `frontend/src/screens/HomeScreen.tsx`
- Test: `frontend/src/screens/HomeScreen.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/screens/HomeScreen.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HomeScreen } from './HomeScreen';
import * as authContext from '../context/AuthContext';
import * as navigationContext from '../context/NavigationContext';

describe('HomeScreen', () => {
  it('renders the user first name and rating', () => {
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok',
      user: { id: 1, firstName: 'Aziz', rating: 1050 } as any,
      loading: false,
      error: null,
    });
    vi.spyOn(navigationContext, 'useNavigation').mockReturnValue({
      current: { name: 'home' }, navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn(), reset: vi.fn(),
    });

    render(<HomeScreen />);

    expect(screen.getByText('Aziz')).toBeInTheDocument();
    expect(screen.getByText(/1050/)).toBeInTheDocument();
  });

  it('navigates to categorySelect with intent=quick when "Tezkor o\'yin" is clicked', () => {
    const navigate = vi.fn();
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1, firstName: 'Aziz', rating: 1050 } as any, loading: false, error: null,
    });
    vi.spyOn(navigationContext, 'useNavigation').mockReturnValue({
      current: { name: 'home' }, navigate, goBack: vi.fn(), replace: vi.fn(), reset: vi.fn(),
    });

    render(<HomeScreen />);
    fireEvent.click(screen.getByText("Tezkor o'yin"));

    expect(navigate).toHaveBeenCalledWith({ name: 'categorySelect', intent: 'quick' });
  });

  it('navigates to categorySelect with intent=invite when "Do\'stni chaqirish" is clicked', () => {
    const navigate = vi.fn();
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1, firstName: 'Aziz', rating: 1050 } as any, loading: false, error: null,
    });
    vi.spyOn(navigationContext, 'useNavigation').mockReturnValue({
      current: { name: 'home' }, navigate, goBack: vi.fn(), replace: vi.fn(), reset: vi.fn(),
    });

    render(<HomeScreen />);
    fireEvent.click(screen.getByText("Do'stni chaqirish"));

    expect(navigate).toHaveBeenCalledWith({ name: 'categorySelect', intent: 'invite' });
  });

  it('renders nothing when there is no user yet', () => {
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: null, user: null, loading: false, error: null,
    });
    vi.spyOn(navigationContext, 'useNavigation').mockReturnValue({
      current: { name: 'home' }, navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn(), reset: vi.fn(),
    });

    const { container } = render(<HomeScreen />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/screens/HomeScreen.test.tsx`
Expected: FAIL — `Cannot find module './HomeScreen'`

- [ ] **Step 3: Implement `HomeScreen.tsx`**

```tsx
// frontend/src/screens/HomeScreen.tsx
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '../context/NavigationContext';
import { PrimaryButton } from '../components/PrimaryButton';

export function HomeScreen() {
  const { user } = useAuth();
  const { navigate } = useNavigation();

  if (!user) return null;

  return (
    <div className="flex flex-col items-center gap-6 p-6">
      <h1 className="text-xl font-bold">{user.firstName}</h1>
      <p className="text-sm text-gray-500">Reyting: {user.rating}</p>
      <PrimaryButton onClick={() => navigate({ name: 'categorySelect', intent: 'quick' })}>
        Tezkor o'yin
      </PrimaryButton>
      <button
        className="w-full rounded-lg bg-gray-200 py-3 font-semibold text-gray-800"
        onClick={() => navigate({ name: 'categorySelect', intent: 'invite' })}
      >
        Do'stni chaqirish
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/screens/HomeScreen.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screens/HomeScreen.tsx frontend/src/screens/HomeScreen.test.tsx
git commit -m "feat: add HomeScreen"
```

---

## Task 23: screens/CategorySelectScreen.tsx

**Files:**
- Create: `frontend/src/screens/CategorySelectScreen.tsx`
- Test: `frontend/src/screens/CategorySelectScreen.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/screens/CategorySelectScreen.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CategorySelectScreen } from './CategorySelectScreen';
import * as questionsApi from '../api/questions';
import * as navigationContext from '../context/NavigationContext';
import * as gameSocketContext from '../context/GameSocketContext';

describe('CategorySelectScreen', () => {
  const navigate = vi.fn();
  const joinQueue = vi.fn();
  const createInvite = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    navigate.mockClear();
    joinQueue.mockClear();
    createInvite.mockClear();

    vi.spyOn(questionsApi, 'getCategories').mockResolvedValue({
      categories: [
        { key: 'umumiy_bilim', label: 'Umumiy bilim' },
        { key: 'sport_kino_musiqa', label: 'Sport/Kino/Musiqa' },
      ],
    });
    vi.spyOn(navigationContext, 'useNavigation').mockReturnValue({
      current: { name: 'categorySelect', intent: 'quick' },
      navigate, goBack: vi.fn(), replace: vi.fn(), reset: vi.fn(),
    });
    vi.spyOn(gameSocketContext, 'useGameSocketContext').mockReturnValue({
      joinQueue, createInvite,
    } as any);
  });

  it('fetches and renders the categories', async () => {
    render(<CategorySelectScreen intent="quick" />);

    await waitFor(() => expect(screen.getByText('Umumiy bilim')).toBeInTheDocument());
    expect(screen.getByText('Sport/Kino/Musiqa')).toBeInTheDocument();
  });

  it('calls joinQueue and navigates to waiting when intent is quick', async () => {
    render(<CategorySelectScreen intent="quick" />);

    await waitFor(() => screen.getByText('Umumiy bilim'));
    fireEvent.click(screen.getByText('Umumiy bilim'));

    expect(joinQueue).toHaveBeenCalledWith('umumiy_bilim');
    expect(createInvite).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({ name: 'waiting', category: 'umumiy_bilim', intent: 'quick' });
  });

  it('calls createInvite and navigates to waiting when intent is invite', async () => {
    render(<CategorySelectScreen intent="invite" />);

    await waitFor(() => screen.getByText('Umumiy bilim'));
    fireEvent.click(screen.getByText('Umumiy bilim'));

    expect(createInvite).toHaveBeenCalledWith('umumiy_bilim');
    expect(joinQueue).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({ name: 'waiting', category: 'umumiy_bilim', intent: 'invite' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/screens/CategorySelectScreen.test.tsx`
Expected: FAIL — `Cannot find module './CategorySelectScreen'`

- [ ] **Step 3: Implement `CategorySelectScreen.tsx`**

```tsx
// frontend/src/screens/CategorySelectScreen.tsx
import { useEffect, useState } from 'react';
import { useNavigation } from '../context/NavigationContext';
import { useGameSocketContext } from '../context/GameSocketContext';
import { getCategories } from '../api/questions';
import { Category } from '../api/types';

export function CategorySelectScreen({ intent }: { intent: 'quick' | 'invite' }) {
  const { navigate } = useNavigation();
  const { joinQueue, createInvite } = useGameSocketContext();
  const [categories, setCategories] = useState<Category[]>([]);

  useEffect(() => {
    getCategories().then((res) => setCategories(res.categories));
  }, []);

  const handleSelect = (category: string) => {
    if (intent === 'quick') {
      joinQueue(category);
    } else {
      createInvite(category);
    }
    navigate({ name: 'waiting', category, intent });
  };

  return (
    <div className="flex flex-col gap-3 p-6">
      <h2 className="text-lg font-bold">Kategoriya tanlang</h2>
      {categories.map((c) => (
        <button
          key={c.key}
          className="rounded-lg bg-gray-100 py-3 font-semibold"
          onClick={() => handleSelect(c.key)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/screens/CategorySelectScreen.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screens/CategorySelectScreen.tsx frontend/src/screens/CategorySelectScreen.test.tsx
git commit -m "feat: add CategorySelectScreen"
```

---

## Task 24: screens/WaitingScreen.tsx

**Files:**
- Create: `frontend/src/screens/WaitingScreen.tsx`
- Test: `frontend/src/screens/WaitingScreen.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/screens/WaitingScreen.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { WaitingScreen } from './WaitingScreen';
import * as authContext from '../context/AuthContext';
import * as navigationContext from '../context/NavigationContext';
import * as gameSocketContext from '../context/GameSocketContext';
import * as telegram from '../telegram/webApp';

describe('WaitingScreen', () => {
  const navigate = vi.fn();
  const replace = vi.fn();
  const goBack = vi.fn();
  const leaveQueue = vi.fn();
  const clearMatchFound = vi.fn();

  function mockSocket(overrides: Partial<ReturnType<typeof buildDefaultSocket>> = {}) {
    vi.spyOn(gameSocketContext, 'useGameSocketContext').mockReturnValue({
      ...buildDefaultSocket(),
      ...overrides,
    } as any);
  }

  function buildDefaultSocket() {
    return {
      matchFound: null,
      clearMatchFound,
      leaveQueue,
      inviteCreated: false,
    };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    navigate.mockClear();
    replace.mockClear();
    goBack.mockClear();
    leaveQueue.mockClear();
    clearMatchFound.mockClear();

    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1, telegramId: 555 } as any, loading: false, error: null,
    });
    vi.spyOn(navigationContext, 'useNavigation').mockReturnValue({
      current: { name: 'waiting', category: 'umumiy_bilim', intent: 'quick' },
      navigate, goBack, replace, reset: vi.fn(),
    });
  });

  it('shows a searching message with the category label', () => {
    mockSocket();
    render(<WaitingScreen category="umumiy_bilim" intent="quick" />);
    expect(screen.getByText(/Umumiy bilim/)).toBeInTheDocument();
  });

  it('replaces the current screen with battle when matchFound arrives', async () => {
    mockSocket({ matchFound: { gameId: 'g1', category: 'umumiy_bilim' } as any });
    render(<WaitingScreen category="umumiy_bilim" intent="quick" />);

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({ name: 'battle', gameId: 'g1', category: 'umumiy_bilim' })
    );
    expect(clearMatchFound).toHaveBeenCalledOnce();
  });

  it('calls leaveQueue and goes back when cancelling a quick match', () => {
    mockSocket();
    render(<WaitingScreen category="umumiy_bilim" intent="quick" />);

    fireEvent.click(screen.getByText('Bekor qilish'));

    expect(leaveQueue).toHaveBeenCalledWith('umumiy_bilim');
    expect(goBack).toHaveBeenCalledOnce();
  });

  it('does not call leaveQueue when cancelling an invite (no queue was joined)', () => {
    mockSocket();
    render(<WaitingScreen category="umumiy_bilim" intent="invite" />);

    fireEvent.click(screen.getByText('Bekor qilish'));

    expect(leaveQueue).not.toHaveBeenCalled();
    expect(goBack).toHaveBeenCalledOnce();
  });

  it('shows a share button for invite intent that shares the deep link', () => {
    mockSocket({ inviteCreated: true });
    const shareSpy = vi.spyOn(telegram, 'shareInviteLink').mockImplementation(() => {});

    render(<WaitingScreen category="umumiy_bilim" intent="invite" />);
    fireEvent.click(screen.getByText("Do'stga ulashish"));

    expect(shareSpy).toHaveBeenCalledOnce();
    const [link] = shareSpy.mock.calls[0];
    expect(link).toContain('startapp=invite_555');
  });

  it('does not show a share button for quick-match intent', () => {
    mockSocket();
    render(<WaitingScreen category="umumiy_bilim" intent="quick" />);
    expect(screen.queryByText("Do'stga ulashish")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/screens/WaitingScreen.test.tsx`
Expected: FAIL — `Cannot find module './WaitingScreen'`

- [ ] **Step 3: Implement `WaitingScreen.tsx`**

```tsx
// frontend/src/screens/WaitingScreen.tsx
import { useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '../context/NavigationContext';
import { useGameSocketContext } from '../context/GameSocketContext';
import { categoryLabel } from '../utils/category';
import { buildInviteLink, shareInviteLink } from '../telegram/webApp';

export function WaitingScreen({
  category,
  intent,
}: {
  category: string;
  intent: 'quick' | 'invite';
}) {
  const { user } = useAuth();
  const { replace, goBack } = useNavigation();
  const { matchFound, clearMatchFound, leaveQueue, inviteCreated } = useGameSocketContext();

  useEffect(() => {
    if (matchFound) {
      replace({ name: 'battle', gameId: matchFound.gameId, category: matchFound.category });
      clearMatchFound();
    }
  }, [matchFound, replace, clearMatchFound]);

  const handleCancel = () => {
    if (intent === 'quick') {
      leaveQueue(category);
    }
    goBack();
  };

  const handleShare = () => {
    if (!user) return;
    const botUsername = import.meta.env.VITE_BOT_USERNAME ?? 'bilimbattle_bot';
    const link = buildInviteLink(botUsername, user.telegramId);
    shareInviteLink(link, "BilimBattle'da men bilan o'ynang!");
  };

  return (
    <div className="flex flex-col items-center gap-4 p-6">
      <p className="text-lg">{categoryLabel(category)} bo'yicha raqib qidirilmoqda...</p>
      {intent === 'invite' && inviteCreated && (
        <p className="text-sm text-gray-500">Havola yuborildi, do'stingiz kutilmoqda</p>
      )}
      {intent === 'invite' && (
        <button className="rounded-lg bg-blue-600 px-4 py-2 text-white" onClick={handleShare}>
          Do'stga ulashish
        </button>
      )}
      <button className="rounded-lg bg-gray-200 px-4 py-2" onClick={handleCancel}>
        Bekor qilish
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/screens/WaitingScreen.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screens/WaitingScreen.tsx frontend/src/screens/WaitingScreen.test.tsx
git commit -m "feat: add WaitingScreen"
```

---

## Task 25: screens/BattleScreen.tsx

**Files:**
- Create: `frontend/src/screens/BattleScreen.tsx`
- Test: `frontend/src/screens/BattleScreen.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/screens/BattleScreen.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BattleScreen } from './BattleScreen';
import * as navigationContext from '../context/NavigationContext';
import * as gameSocketContext from '../context/GameSocketContext';
import * as authContext from '../context/AuthContext';

describe('BattleScreen', () => {
  const replace = vi.fn();
  const submitAnswer = vi.fn();
  const clearGameOver = vi.fn();
  const clearQuestionResult = vi.fn();
  const reconnectGame = vi.fn().mockResolvedValue({ found: true });

  function mockSocket(overrides: Record<string, unknown> = {}) {
    vi.spyOn(gameSocketContext, 'useGameSocketContext').mockReturnValue({
      question: null,
      questionResult: null,
      gameOver: null,
      connected: true,
      submitAnswer,
      clearGameOver,
      clearQuestionResult,
      reconnectGame,
      ...overrides,
    } as any);
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    replace.mockClear();
    submitAnswer.mockClear();
    clearGameOver.mockClear();
    clearQuestionResult.mockClear();
    reconnectGame.mockClear().mockResolvedValue({ found: true });

    vi.spyOn(navigationContext, 'useNavigation').mockReturnValue({
      current: { name: 'battle', gameId: 'g1', category: 'umumiy_bilim' },
      navigate: vi.fn(), goBack: vi.fn(), replace, reset: vi.fn(),
    });
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1 } as any, loading: false, error: null,
    });
  });

  it('shows a waiting message when no question has arrived yet', () => {
    mockSocket();
    render(<BattleScreen gameId="g1" />);
    expect(screen.getByText(/Keyingi savol kutilmoqda/)).toBeInTheDocument();
  });

  it('renders the question text and options', () => {
    mockSocket({
      question: { index: 0, total: 7, text: 'Poytaxt qaysi?', options: ['Toshkent', 'Samarqand'], timeLimitMs: 10000 },
    });
    render(<BattleScreen gameId="g1" />);

    expect(screen.getByText('Poytaxt qaysi?')).toBeInTheDocument();
    expect(screen.getByText('Toshkent')).toBeInTheDocument();
    expect(screen.getByText('Samarqand')).toBeInTheDocument();
  });

  it('submits the selected answer and disables further selection', () => {
    mockSocket({
      question: { index: 2, total: 7, text: 'Q?', options: ['A', 'B'], timeLimitMs: 10000 },
    });
    render(<BattleScreen gameId="g1" />);

    fireEvent.click(screen.getByText('A'));

    expect(submitAnswer).toHaveBeenCalledWith('g1', 2, 0);
    expect(screen.getByText('A')).toBeDisabled();
    expect(screen.getByText('B')).toBeDisabled();
  });

  it('ignores a second click after an answer has already been selected', () => {
    mockSocket({
      question: { index: 0, total: 7, text: 'Q?', options: ['A', 'B'], timeLimitMs: 10000 },
    });
    render(<BattleScreen gameId="g1" />);

    fireEvent.click(screen.getByText('A'));
    fireEvent.click(screen.getByText('B'));

    expect(submitAnswer).toHaveBeenCalledOnce();
  });

  it('highlights the correct answer once questionResult arrives for the current question', () => {
    mockSocket({
      question: { index: 0, total: 7, text: 'Q?', options: ['A', 'B'], timeLimitMs: 10000 },
      questionResult: { index: 0, correctIndex: 1, scores: [] },
    });
    render(<BattleScreen gameId="g1" />);

    expect(screen.getByText('B')).toHaveClass('bg-green-500');
  });

  it('navigates to the result screen (via replace) when gameOver arrives', async () => {
    mockSocket({
      gameOver: { scores: [{ userId: 1, score: 400 }], winnerId: 1, forfeited: false },
    });
    render(<BattleScreen gameId="g1" />);

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({
        name: 'result', scores: [{ userId: 1, score: 400 }], winnerId: 1, forfeited: false,
      })
    );
    expect(clearGameOver).toHaveBeenCalledOnce();
  });

  it('calls reconnectGame when the socket is connected', () => {
    mockSocket();
    render(<BattleScreen gameId="g1" />);
    expect(reconnectGame).toHaveBeenCalledWith('g1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/screens/BattleScreen.test.tsx`
Expected: FAIL — `Cannot find module './BattleScreen'`

- [ ] **Step 3: Implement `BattleScreen.tsx`**

```tsx
// frontend/src/screens/BattleScreen.tsx
import { useEffect, useState } from 'react';
import { useNavigation } from '../context/NavigationContext';
import { useGameSocketContext } from '../context/GameSocketContext';
import { ScoreBar } from '../components/ScoreBar';
import { CountdownTimer } from '../components/CountdownTimer';

export function BattleScreen({ gameId }: { gameId: string }) {
  const {
    question,
    questionResult,
    gameOver,
    connected,
    submitAnswer,
    clearGameOver,
    clearQuestionResult,
    reconnectGame,
  } = useGameSocketContext();
  const { replace } = useNavigation();
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [answeredIndex, setAnsweredIndex] = useState<number | null>(null);

  useEffect(() => {
    if (question && question.index !== answeredIndex) {
      setSelectedOption(null);
    }
  }, [question, answeredIndex]);

  useEffect(() => {
    if (gameOver) {
      replace({
        name: 'result',
        scores: gameOver.scores,
        winnerId: gameOver.winnerId,
        forfeited: gameOver.forfeited ?? false,
      });
      clearGameOver();
      clearQuestionResult();
    }
  }, [gameOver, replace, clearGameOver, clearQuestionResult]);

  useEffect(() => {
    if (connected) {
      reconnectGame(gameId);
    }
  }, [connected, gameId, reconnectGame]);

  const handleSelect = (optionIndex: number) => {
    if (!question || selectedOption !== null) return;
    setSelectedOption(optionIndex);
    setAnsweredIndex(question.index);
    submitAnswer(gameId, question.index, optionIndex);
  };

  if (!question) {
    return <div className="p-6 text-center">Keyingi savol kutilmoqda...</div>;
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <ScoreBar scores={questionResult?.scores ?? []} />
      <CountdownTimer key={question.index} timeLimitMs={question.timeLimitMs} />
      <p className="text-lg font-semibold">{question.text}</p>
      <div className="flex flex-col gap-2">
        {question.options.map((option, index) => {
          const isCorrect = questionResult?.index === question.index && questionResult.correctIndex === index;
          const isSelected = selectedOption === index;
          return (
            <button
              key={index}
              disabled={selectedOption !== null}
              onClick={() => handleSelect(index)}
              className={`rounded-lg py-3 font-medium ${
                isCorrect
                  ? 'bg-green-500 text-white'
                  : isSelected
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100'
              }`}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/screens/BattleScreen.test.tsx`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screens/BattleScreen.tsx frontend/src/screens/BattleScreen.test.tsx
git commit -m "feat: add BattleScreen"
```

---

## Task 26: screens/ResultScreen.tsx

**Files:**
- Create: `frontend/src/screens/ResultScreen.tsx`
- Test: `frontend/src/screens/ResultScreen.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/screens/ResultScreen.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ResultScreen } from './ResultScreen';
import * as authContext from '../context/AuthContext';
import * as navigationContext from '../context/NavigationContext';
import * as telegram from '../telegram/webApp';

describe('ResultScreen', () => {
  const reset = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    reset.mockClear();
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1, firstName: 'Aziz' } as any, loading: false, error: null,
    });
    vi.spyOn(navigationContext, 'useNavigation').mockReturnValue({
      current: { name: 'result', scores: [], winnerId: null, forfeited: false },
      navigate: vi.fn(), goBack: vi.fn(), replace: vi.fn(), reset,
    });
  });

  it('shows a win message and the player\'s own score when they are the winner', () => {
    render(
      <ResultScreen
        scores={[{ userId: 1, score: 550 }, { userId: 2, score: 300 }]}
        winnerId={1}
        forfeited={false}
      />
    );

    expect(screen.getByText(/G'alaba qozondingiz/)).toBeInTheDocument();
    expect(screen.getByText(/550/)).toBeInTheDocument();
  });

  it('shows a loss message when the other player won', () => {
    render(
      <ResultScreen
        scores={[{ userId: 1, score: 200 }, { userId: 2, score: 500 }]}
        winnerId={2}
        forfeited={false}
      />
    );

    expect(screen.getByText(/Mag'lubiyat/)).toBeInTheDocument();
  });

  it('shows a draw message when winnerId is null', () => {
    render(
      <ResultScreen
        scores={[{ userId: 1, score: 300 }, { userId: 2, score: 300 }]}
        winnerId={null}
        forfeited={false}
      />
    );

    expect(screen.getByText(/Durrang/)).toBeInTheDocument();
  });

  it('shows a forfeit note when the match ended by forfeit', () => {
    render(
      <ResultScreen
        scores={[{ userId: 1, score: 100 }, { userId: 2, score: 0 }]}
        winnerId={1}
        forfeited
      />
    );

    expect(screen.getByText(/o'yindan chiqib ketdi/)).toBeInTheDocument();
  });

  it('resets navigation to home when "Yana o\'ynash" is clicked', () => {
    render(<ResultScreen scores={[]} winnerId={null} forfeited={false} />);

    fireEvent.click(screen.getByText("Yana o'ynash"));

    expect(reset).toHaveBeenCalledWith({ name: 'home' });
  });

  it('shares the result when "Do\'stga ulashish" is clicked', () => {
    const shareSpy = vi.spyOn(telegram, 'shareInviteLink').mockImplementation(() => {});

    render(
      <ResultScreen scores={[{ userId: 1, score: 450 }]} winnerId={1} forfeited={false} />
    );
    fireEvent.click(screen.getByText("Do'stga ulashish"));

    expect(shareSpy).toHaveBeenCalledOnce();
    const [, text] = shareSpy.mock.calls[0];
    expect(text).toContain('450');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/screens/ResultScreen.test.tsx`
Expected: FAIL — `Cannot find module './ResultScreen'`

- [ ] **Step 3: Implement `ResultScreen.tsx`**

```tsx
// frontend/src/screens/ResultScreen.tsx
import { useAuth } from '../context/AuthContext';
import { useNavigation } from '../context/NavigationContext';
import { shareInviteLink } from '../telegram/webApp';
import { findMyScore } from '../utils/score';
import { ScoreEntry } from '../api/types';
import { PrimaryButton } from '../components/PrimaryButton';

export function ResultScreen({
  scores,
  winnerId,
  forfeited,
}: {
  scores: ScoreEntry[];
  winnerId: number | null;
  forfeited: boolean;
}) {
  const { user } = useAuth();
  const { reset } = useNavigation();

  if (!user) return null;

  const myScore = findMyScore(scores, user.id);
  const isWinner = winnerId === user.id;
  const isDraw = winnerId === null;
  const resultText = isDraw ? 'Durrang!' : isWinner ? "G'alaba qozondingiz!" : "Mag'lubiyat";

  const handleShare = () => {
    const botUsername = import.meta.env.VITE_BOT_USERNAME ?? 'bilimbattle_bot';
    shareInviteLink(`https://t.me/${botUsername}`, `BilimBattle'da ${myScore} ball to'pladim!`);
  };

  return (
    <div className="flex flex-col items-center gap-4 p-6">
      <h2 className="text-2xl font-bold">{resultText}</h2>
      {forfeited && <p className="text-sm text-gray-500">Raqibingiz o'yindan chiqib ketdi</p>}
      <p className="text-lg">Sizning ballingiz: {myScore}</p>
      <PrimaryButton onClick={() => reset({ name: 'home' })}>Yana o'ynash</PrimaryButton>
      <button className="w-full rounded-lg bg-gray-200 py-3 font-semibold" onClick={handleShare}>
        Do'stga ulashish
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/screens/ResultScreen.test.tsx`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screens/ResultScreen.tsx frontend/src/screens/ResultScreen.test.tsx
git commit -m "feat: add ResultScreen"
```

---

## Task 27: screens/LeaderboardScreen.tsx

**Files:**
- Create: `frontend/src/screens/LeaderboardScreen.tsx`
- Test: `frontend/src/screens/LeaderboardScreen.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/screens/LeaderboardScreen.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LeaderboardScreen } from './LeaderboardScreen';
import * as authContext from '../context/AuthContext';
import * as leaderboardApi from '../api/leaderboard';

describe('LeaderboardScreen', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1, telegramId: 111 } as any, loading: false, error: null,
    });
  });

  it('loads and displays the global leaderboard by default', async () => {
    vi.spyOn(leaderboardApi, 'getGlobalLeaderboard').mockResolvedValue({
      leaderboard: [
        { telegramId: 111, firstName: 'Aziz', username: null, rating: 1200, gamesWon: 4 },
        { telegramId: 222, firstName: 'Vali', username: null, rating: 1100, gamesWon: 2 },
      ],
    });

    render(<LeaderboardScreen />);

    await waitFor(() => expect(screen.getByText(/Aziz/)).toBeInTheDocument());
    expect(screen.getByText(/Vali/)).toBeInTheDocument();
    expect(screen.getByText(/Sizning o'rningiz: 1/)).toBeInTheDocument();
  });

  it('switches to the friends leaderboard when the "Do\'stlar" tab is clicked', async () => {
    vi.spyOn(leaderboardApi, 'getGlobalLeaderboard').mockResolvedValue({ leaderboard: [] });
    const friendsSpy = vi.spyOn(leaderboardApi, 'getFriendsLeaderboard').mockResolvedValue({
      leaderboard: [{ telegramId: 111, firstName: 'Aziz', username: null, rating: 1200, gamesWon: 4 }],
    });

    render(<LeaderboardScreen />);
    await waitFor(() => expect(leaderboardApi.getGlobalLeaderboard).toHaveBeenCalledOnce());

    fireEvent.click(screen.getByText("Do'stlar"));

    await waitFor(() => expect(friendsSpy).toHaveBeenCalledWith('tok'));
  });

  it('does not show a rank line when the user is not present in the fetched list', async () => {
    vi.spyOn(leaderboardApi, 'getGlobalLeaderboard').mockResolvedValue({
      leaderboard: [{ telegramId: 999, firstName: 'Other', username: null, rating: 900, gamesWon: 0 }],
    });

    render(<LeaderboardScreen />);

    await waitFor(() => expect(screen.getByText(/Other/)).toBeInTheDocument());
    expect(screen.queryByText(/Sizning o'rningiz/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/screens/LeaderboardScreen.test.tsx`
Expected: FAIL — `Cannot find module './LeaderboardScreen'`

- [ ] **Step 3: Implement `LeaderboardScreen.tsx`**

```tsx
// frontend/src/screens/LeaderboardScreen.tsx
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getGlobalLeaderboard, getFriendsLeaderboard } from '../api/leaderboard';
import { LeaderboardEntry } from '../api/types';
import { findRank } from '../utils/leaderboardRank';

export function LeaderboardScreen() {
  const { token, user } = useAuth();
  const [tab, setTab] = useState<'global' | 'friends'>('global');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);

  useEffect(() => {
    if (!token) return;
    const fetcher = tab === 'global' ? getGlobalLeaderboard : getFriendsLeaderboard;
    fetcher(token).then((res) => setEntries(res.leaderboard));
  }, [tab, token]);

  const myRank = user ? findRank(entries, user.telegramId) : null;

  return (
    <div className="flex flex-col gap-3 p-6">
      <div className="flex gap-2">
        <button
          className={`flex-1 rounded-lg py-2 font-semibold ${
            tab === 'global' ? 'bg-blue-600 text-white' : 'bg-gray-100'
          }`}
          onClick={() => setTab('global')}
        >
          Umumiy
        </button>
        <button
          className={`flex-1 rounded-lg py-2 font-semibold ${
            tab === 'friends' ? 'bg-blue-600 text-white' : 'bg-gray-100'
          }`}
          onClick={() => setTab('friends')}
        >
          Do'stlar
        </button>
      </div>
      {myRank !== null && <p className="text-sm text-gray-500">Sizning o'rningiz: {myRank}</p>}
      <ul className="flex flex-col gap-2">
        {entries.map((entry, index) => (
          <li key={entry.telegramId} className="flex justify-between rounded-lg bg-gray-50 px-3 py-2">
            <span>
              {index + 1}. {entry.firstName}
            </span>
            <span className="font-semibold">{entry.rating}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/screens/LeaderboardScreen.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screens/LeaderboardScreen.tsx frontend/src/screens/LeaderboardScreen.test.tsx
git commit -m "feat: add LeaderboardScreen"
```

---

## Task 28: screens/SettingsScreen.tsx

**Files:**
- Create: `frontend/src/screens/SettingsScreen.tsx`
- Test: `frontend/src/screens/SettingsScreen.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/screens/SettingsScreen.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SettingsScreen } from './SettingsScreen';
import * as authContext from '../context/AuthContext';
import * as statsApi from '../api/stats';

describe('SettingsScreen', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      token: 'tok', user: { id: 1 } as any, loading: false, error: null,
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('loads and displays stats', async () => {
    vi.spyOn(statsApi, 'getMyStats').mockResolvedValue({
      gamesPlayed: 10, gamesWon: 6, winRate: 60, currentStreak: 2, bestStreak: 4, rating: 1080,
    });

    render(<SettingsScreen />);

    await waitFor(() => expect(screen.getByText(/O'ynagan o'yinlar: 10/)).toBeInTheDocument());
    expect(screen.getByText(/G'alaba foizi: 60%/)).toBeInTheDocument();
    expect(screen.getByText(/Joriy seriya: 2/)).toBeInTheDocument();
    expect(screen.getByText(/Eng uzun seriya: 4/)).toBeInTheDocument();
    expect(screen.getByText(/Reyting: 1080/)).toBeInTheDocument();
  });

  it('defaults sound to enabled and toggles it, persisting to localStorage', async () => {
    vi.spyOn(statsApi, 'getMyStats').mockResolvedValue({
      gamesPlayed: 0, gamesWon: 0, winRate: 0, currentStreak: 0, bestStreak: 0, rating: 1000,
    });

    render(<SettingsScreen />);

    expect(screen.getByText('Yoqilgan')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Yoqilgan'));

    expect(screen.getByText("O'chirilgan")).toBeInTheDocument();
    expect(localStorage.getItem('bilimbattle:soundEnabled')).toBe('false');
  });

  it('reads a previously-persisted sound-off preference on mount', () => {
    localStorage.setItem('bilimbattle:soundEnabled', 'false');
    vi.spyOn(statsApi, 'getMyStats').mockResolvedValue({
      gamesPlayed: 0, gamesWon: 0, winRate: 0, currentStreak: 0, bestStreak: 0, rating: 1000,
    });

    render(<SettingsScreen />);

    expect(screen.getByText("O'chirilgan")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/screens/SettingsScreen.test.tsx`
Expected: FAIL — `Cannot find module './SettingsScreen'`

- [ ] **Step 3: Implement `SettingsScreen.tsx`**

```tsx
// frontend/src/screens/SettingsScreen.tsx
import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getMyStats } from '../api/stats';
import { Stats } from '../api/types';

const SOUND_KEY = 'bilimbattle:soundEnabled';

export function SettingsScreen() {
  const { token } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(
    () => localStorage.getItem(SOUND_KEY) !== 'false'
  );

  useEffect(() => {
    if (!token) return;
    getMyStats(token).then(setStats);
  }, [token]);

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    localStorage.setItem(SOUND_KEY, String(next));
  };

  return (
    <div className="flex flex-col gap-4 p-6">
      <h2 className="text-lg font-bold">Sozlamalar</h2>
      <div className="flex items-center justify-between">
        <span>Ovoz/Vibratsiya</span>
        <button
          className={`rounded-full px-4 py-1 font-semibold ${
            soundEnabled ? 'bg-blue-600 text-white' : 'bg-gray-200'
          }`}
          onClick={toggleSound}
        >
          {soundEnabled ? 'Yoqilgan' : "O'chirilgan"}
        </button>
      </div>
      {stats && (
        <div className="flex flex-col gap-1 rounded-lg bg-gray-50 p-4">
          <p>O'ynagan o'yinlar: {stats.gamesPlayed}</p>
          <p>G'alaba foizi: {stats.winRate}%</p>
          <p>Joriy seriya: {stats.currentStreak}</p>
          <p>Eng uzun seriya: {stats.bestStreak}</p>
          <p>Reyting: {stats.rating}</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/screens/SettingsScreen.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screens/SettingsScreen.tsx frontend/src/screens/SettingsScreen.test.tsx
git commit -m "feat: add SettingsScreen"
```

---

## Task 29: App.tsx — wire everything together

**Files:**
- Modify: `frontend/src/App.tsx`
- Test: `frontend/src/App.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/App.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';
import * as authContext from './context/AuthContext';
import * as gameSocketContext from './context/GameSocketContext';
import * as telegram from './telegram/webApp';

vi.mock('./context/AuthContext', async () => {
  const actual = await vi.importActual<typeof import('./context/AuthContext')>('./context/AuthContext');
  // AuthProvider is also replaced with a passthrough, not just useAuth. If the
  // real AuthProvider rendered here, its internal useEffect would still fire
  // a REAL login() call (unmocked fetch, in jsdom, with no window.Telegram) —
  // noisy/undeterministic and irrelevant, since AppShell reads from the
  // mocked useAuth() return value below, not from real context state anyway.
  return { ...actual, useAuth: vi.fn(), AuthProvider: ({ children }: any) => children };
});
vi.mock('./context/GameSocketContext', async () => {
  const actual = await vi.importActual<typeof import('./context/GameSocketContext')>(
    './context/GameSocketContext'
  );
  return { ...actual, useGameSocketContext: vi.fn(), GameSocketProvider: ({ children }: any) => children };
});

describe('App', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(telegram, 'readyWebApp').mockImplementation(() => {});
  });

  it('shows a loading state while auth is in progress', () => {
    vi.mocked(authContext.useAuth).mockReturnValue({
      token: null, user: null, loading: true, error: null,
    });
    vi.mocked(gameSocketContext.useGameSocketContext).mockReturnValue({
      sessionReplaced: false,
    } as any);

    render(<App />);

    expect(screen.getByText('Yuklanmoqda...')).toBeInTheDocument();
  });

  it('shows the auth error when login failed', () => {
    vi.mocked(authContext.useAuth).mockReturnValue({
      token: null, user: null, loading: false, error: 'Tizimga kirishda xatolik yuz berdi',
    });
    vi.mocked(gameSocketContext.useGameSocketContext).mockReturnValue({
      sessionReplaced: false,
    } as any);

    render(<App />);

    expect(screen.getByText('Tizimga kirishda xatolik yuz berdi')).toBeInTheDocument();
  });

  it('shows the home screen and bottom nav once loaded successfully', () => {
    vi.mocked(authContext.useAuth).mockReturnValue({
      token: 'tok', user: { id: 1, firstName: 'Aziz', rating: 1000 } as any, loading: false, error: null,
    });
    vi.mocked(gameSocketContext.useGameSocketContext).mockReturnValue({
      sessionReplaced: false,
    } as any);

    render(<App />);

    expect(screen.getByText('Aziz')).toBeInTheDocument();
    expect(screen.getByTestId('bottom-nav')).toBeInTheDocument();
  });

  it('shows a session-replaced message and hides normal UI when another device logs in', () => {
    vi.mocked(authContext.useAuth).mockReturnValue({
      token: 'tok', user: { id: 1, firstName: 'Aziz', rating: 1000 } as any, loading: false, error: null,
    });
    vi.mocked(gameSocketContext.useGameSocketContext).mockReturnValue({
      sessionReplaced: true,
    } as any);

    render(<App />);

    expect(screen.getByText(/boshqa qurilmada ochildi/)).toBeInTheDocument();
    expect(screen.queryByTestId('bottom-nav')).not.toBeInTheDocument();
  });

  it('calls readyWebApp on mount', () => {
    vi.mocked(authContext.useAuth).mockReturnValue({
      token: 'tok', user: { id: 1, firstName: 'Aziz', rating: 1000 } as any, loading: false, error: null,
    });
    vi.mocked(gameSocketContext.useGameSocketContext).mockReturnValue({
      sessionReplaced: false,
    } as any);

    render(<App />);

    expect(telegram.readyWebApp).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/App.test.tsx`
Expected: FAIL — the placeholder `App.tsx` from Task 1 doesn't render any of the expected content (loading/error/home/session-replaced states)

- [ ] **Step 3: Implement `App.tsx`**

```tsx
// frontend/src/App.tsx
import { useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { NavigationProvider, useNavigation } from './context/NavigationContext';
import { GameSocketProvider, useGameSocketContext } from './context/GameSocketContext';
import { BottomNav } from './components/BottomNav';
import { HomeScreen } from './screens/HomeScreen';
import { CategorySelectScreen } from './screens/CategorySelectScreen';
import { WaitingScreen } from './screens/WaitingScreen';
import { BattleScreen } from './screens/BattleScreen';
import { ResultScreen } from './screens/ResultScreen';
import { LeaderboardScreen } from './screens/LeaderboardScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { readyWebApp } from './telegram/webApp';

function Router() {
  const { current } = useNavigation();

  switch (current.name) {
    case 'home':
      return <HomeScreen />;
    case 'categorySelect':
      return <CategorySelectScreen intent={current.intent} />;
    case 'waiting':
      return <WaitingScreen category={current.category} intent={current.intent} />;
    case 'battle':
      return <BattleScreen gameId={current.gameId} />;
    case 'result':
      return (
        <ResultScreen scores={current.scores} winnerId={current.winnerId} forfeited={current.forfeited} />
      );
    case 'leaderboard':
      return <LeaderboardScreen />;
    case 'settings':
      return <SettingsScreen />;
  }
}

function AppShell() {
  const { loading, error } = useAuth();
  const { current } = useNavigation();
  const { sessionReplaced } = useGameSocketContext();

  useEffect(() => {
    readyWebApp();
  }, []);

  if (loading) return <div className="p-6 text-center">Yuklanmoqda...</div>;
  if (error) return <div className="p-6 text-center text-red-600">{error}</div>;
  if (sessionReplaced) {
    return (
      <div className="p-6 text-center">Bu sessiya boshqa qurilmada ochildi.</div>
    );
  }

  const showBottomNav = ['home', 'leaderboard', 'settings'].includes(current.name);

  return (
    <div className="flex min-h-screen flex-col justify-between">
      <div className="flex-1">
        <Router />
      </div>
      {showBottomNav && <BottomNav />}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <NavigationProvider>
        <GameSocketProvider>
          <AppShell />
        </GameSocketProvider>
      </NavigationProvider>
    </AuthProvider>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/App.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: all test files pass (29 test files across api/, telegram/, socket/, context/, utils/, components/, screens/, and App.test.tsx)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.test.tsx
git commit -m "feat: wire providers, router, and screens together in App"
```

---

## Task 30: Ilovani real backend bilan qo'lda sinash

**Files:** none (manual verification only, matching the design spec's section 7 "Qo'lda QA" requirement)

- [ ] **Step 1: Point the frontend at the real local backend**

Confirm `frontend/.env` has:
```
VITE_API_URL=http://localhost:3000/api
VITE_SOCKET_URL=http://localhost:3000
VITE_BOT_USERNAME=<your real bot username from @BotFather, if testing invite links for real>
```

- [ ] **Step 2: Start the backend**

In `backend/`: `npm run dev` (requires local Postgres + Redis running, per `backend/README.md`)

- [ ] **Step 3: Start the frontend dev server**

In `frontend/`: `npm run dev` — Vite will print a local URL (e.g. `http://localhost:5173`)

- [ ] **Step 4: Manual smoke test in a desktop browser (no real Telegram initData available)**

Opening the Vite dev URL directly in a browser has no `window.Telegram.WebApp`, so `AuthContext` will show "Telegram ma'lumotlari topilmadi" — this is EXPECTED and confirms the error path works correctly. Confirm this error message renders instead of a blank page or crash.

- [ ] **Step 5: Manual smoke test inside real Telegram (the actual target environment)**

Per the design spec's own testing strategy, full verification requires a real Telegram client:
1. Deploy the frontend build (`npm run build`, serve `dist/` over HTTPS — Telegram Mini Apps require HTTPS in production; for local testing, a tunnel tool like `ngrok`/`cloudflared` pointed at the Vite dev server works) or use Telegram's local testing flow if available.
2. Set `WEBAPP_URL` in `backend/.env` to that HTTPS URL (per `backend/src/bot/telegramBot.ts`'s `/start` button and CORS config) and restart the backend.
3. Open the bot in Telegram (desktop, iOS, or Android client), send `/start`, tap "O'yinni ochish".
4. Verify: Home screen loads with your real Telegram name and starting rating (1000).
5. Tap "Tezkor o'yin" → pick a category → confirm the Kutish (waiting) screen appears.
6. Open the SAME bot link in a second Telegram account (or ask a friend) and repeat steps 3-5 with the same category — confirm both clients transition to the Bellashuv (battle) screen with the same `gameId` context and see the same first question.
7. Answer questions on both clients, confirm scores update, confirm the correct answer is revealed after both answer (or after 10s), confirm all 7 questions complete and the Natija (result) screen shows the correct winner/scores.
8. Tap "Do'stga ulashish" on the Result screen and confirm Telegram's native share sheet opens.
9. From the Home screen, tap "Do'stni chaqirish", pick a category, tap "Do'stga ulashish" on the Waiting screen, and send the resulting link to a second account — confirm opening that link seats the second player directly into a match with the inviter (no random matchmaking wait).
10. Check the Reyting (leaderboard) and Sozlamalar (settings/stats) tabs render real data from the backend.
11. Test on iOS, Android, and Telegram Desktop clients if available, per the spec's explicit QA requirement — note any platform-specific rendering issues (safe-area insets, BackButton behavior) for follow-up.

- [ ] **Step 6: Report findings**

Document any real-device issues found (do not silently patch them into this plan) — file them as follow-up tasks separate from this plan, since this plan's scope is the MVP screens/flows as specified.

---

## Self-Review Notes

- **Spec coverage:** all 7 screens (Bosh, Kategoriya, Kutish, Bellashuv, Natija, Reyting, Sozlamalar) map to Tasks 22-28. The "muhim mantiq" constraint (correct answer never sent to client before reveal) is honored by construction — `QuestionPayload` has no `correctIndex` field anywhere in this plan's types. Disconnect/reconnect (spec §6) is handled by `BattleScreen`'s `reconnectGame` call tied to the `connected` flag from `useGameSocket`. Bot-fallback/15s matchmaking timeout requires no special client handling — the client just waits for `match_found` regardless of whether it comes from a human pairing or the server's bot-fallback path. Single-active-session (spec §6) is handled by the `sessionReplaced` flag surfaced in `App.tsx`.
- **Known, accepted gap (matches a gap already flagged in the backend's own final review):** there is no backend endpoint for a user's exact numeric rank outside the top-100 list; `LeaderboardScreen` only shows a rank when the user's `telegramId` appears in the fetched (top-100 or friends-circle) list, consistent with what the backend actually supports today.
- **Known, accepted gap:** `reconnect_game`'s ack does not include the current question's text/options (only `currentQuestionIndex`/`scores`) — this is a backend limitation noted in the final holistic backend review, not something the frontend can work around. `BattleScreen` shows "Keyingi savol kutilmoqda..." until the next real `question` event arrives, which is the correct honest behavior given that backend constraint.
- **Placeholder scan:** no TBD/TODO markers; every task has complete, runnable code.
- **Type consistency check:** `ScoreEntry` is defined once in `api/types.ts` (Task 4) and reused verbatim by `useGameSocket.ts` (Task 11), `NavigationContext.tsx`'s `Screen` union (Task 13), `ScoreBar.tsx` (Task 19), and `ResultScreen.tsx` (Task 26) — no duplicate/drifted definitions. `Screen` union's field names (`gameId`, `category`, `scores`, `winnerId`, `forfeited`, `intent`) are used identically everywhere they're constructed (`WaitingScreen`, `BattleScreen`) and consumed (`App.tsx`'s `Router`, `ResultScreen`).
