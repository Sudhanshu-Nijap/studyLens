# StudyLens

An AI-powered study assistant built with **React + Vite + Tailwind CSS**.

## Tech Stack

- **React 18** + **TypeScript**
- **Vite 8** (dev server & bundler)
- **React Router DOM 7** (client-side routing)
- **Tailwind CSS v4** (via `@tailwindcss/vite` plugin)
- **Supabase** (auth + database)
- **Google Gemini API** (AI chat & study tools)
- **shadcn/ui** (component library)

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy `.env.example` to `.env` and fill in your keys:

```bash
cp .env.example .env
```

Required variables:
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_GEMINI_API_KEY=your-gemini-api-key
VITE_SITE_URL=http://localhost:3000
VITE_SERP_API_KEY=your-serpapi-key   # optional, for YouTube transcript search
```

### 3. Start development server

```bash
npm run dev
```

Opens at **http://localhost:3000**

### 4. Build for production

```bash
npm run build
```

Output is in the `dist/` folder. Preview with:

```bash
npm run preview
```

## Project Structure

```
studylens/
├── src/                    # React SPA entry points
│   ├── main.tsx            # ReactDOM.createRoot + BrowserRouter
│   ├── App.tsx             # Route definitions
│   ├── index.css           # Global styles (Tailwind)
│   └── pages/              # Page-level components
│       ├── DashboardPage.tsx
│       ├── NotebookPage.tsx
│       ├── SignInPage.tsx
│       ├── SignUpPage.tsx
│       ├── CallbackPage.tsx
│       └── ...
├── components/             # Shared UI components
│   ├── study/              # Study workspace components
│   └── ui/                 # shadcn/ui primitives
├── lib/                    # Utilities & API clients
│   ├── supabase/           # Supabase client
│   ├── ai.ts               # Gemini AI integration
│   ├── auth.ts             # Auth helpers + useAuth() hook
│   ├── notebooks.ts        # Notebook CRUD
│   ├── materials.ts        # Material management
│   └── ingestion.ts        # PDF/document ingestion
├── app/                    # Action functions (client-side)
│   └── notebooks/
│       ├── actions.ts
│       ├── material-actions.ts
│       ├── chat-actions.ts
│       └── studio-actions.ts
├── public/                 # Static assets
├── vite.config.ts          # Vite configuration
├── tsconfig.json           # TypeScript configuration
└── index.html              # SPA root HTML
```

## Routes

| Path | Page |
|---|---|
| `/` | Dashboard (notebook list) |
| `/notebooks/:id` | Notebook workspace |
| `/auth/sign-in` | Sign in |
| `/auth/sign-up` | Sign up |
| `/auth/reset-password` | Forgot password |
| `/auth/update-password` | Set new password |
| `/auth/callback` | OAuth / magic link callback |
| `/auth/verify` | Email verification |
