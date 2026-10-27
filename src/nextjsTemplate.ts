/**
 * File templates for `runtime: 'nextjs'` design artifacts.
 *
 * The dependency set is pinned exactly so every artifact shares one template
 * install (see `nextjsToolchain.ts`). The agent is told not to add packages;
 * changing these versions changes the install-cache key, which re-installs once.
 */

export const NEXTJS_DEPENDENCIES = Object.freeze({
  next: '16.4.3',
  react: '19.3.1',
  'react-dom': '19.3.1',
});

export const NEXTJS_DEV_DEPENDENCIES = Object.freeze({
  '@tailwindcss/postcss': '4.3.3',
  '@types/node': '20.19.43',
  '@types/react': '19.3.0',
  '@types/react-dom': '19.3.0',
  tailwindcss: '4.3.3',
  typescript: '5.9.3',
});

/** package.json used both in the artifact and (name aside) as the shared install-cache manifest. */
export function nextjsPackageJson(name: string): string {
  return `${JSON.stringify({
    name,
    private: true,
    version: '0.0.0',
    scripts: { dev: 'next dev --webpack', build: 'next build --webpack' },
    dependencies: NEXTJS_DEPENDENCIES,
    devDependencies: NEXTJS_DEV_DEPENDENCIES,
  }, null, 2)}\n`;
}

export const NEXTJS_CONFIG = `// Static-export configuration managed by Agent Threads Design. Do not remove 'output: "export"'.
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
};

export default nextConfig;
`;

export const NEXTJS_TSCONFIG = `${JSON.stringify({
  compilerOptions: {
    target: 'ES2022',
    lib: ['dom', 'dom.iterable', 'esnext'],
    allowJs: true,
    skipLibCheck: true,
    strict: true,
    noEmit: true,
    esModuleInterop: true,
    module: 'esnext',
    moduleResolution: 'bundler',
    resolveJsonModule: true,
    isolatedModules: true,
    jsx: 'preserve',
    incremental: true,
    plugins: [{ name: 'next' }],
    paths: { '@/*': ['./*'] },
  },
  include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
  exclude: ['node_modules', 'out', 'exports'],
}, null, 2)}\n`;

export const NEXTJS_POSTCSS = `const config = { plugins: { '@tailwindcss/postcss': {} } };

export default config;
`;

export const NEXTJS_GLOBALS_CSS = `@import "tailwindcss";

:root { color-scheme: light dark; }
body { font-family: ui-sans-serif, system-ui, sans-serif; }
`;

export const NEXTJS_LAYOUT = `import type { ReactNode } from 'react';
import './globals.css';

export const metadata = { title: 'Design prototype' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;

export const NEXTJS_PAGE = `export default function Page() {
  return (
    <main className="grid min-h-screen place-items-center bg-neutral-950 p-6 text-neutral-100" aria-live="polite">
      <div className="max-w-md rounded-3xl border border-white/10 bg-neutral-900 p-10 text-center">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-300">Agent Threads · Design</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">Preparing your design</h1>
        <p className="mt-2 text-sm text-neutral-400">Turning your brief into a Next.js prototype.</p>
      </div>
    </main>
  );
}
`;

export const NEXTJS_GITIGNORE = `node_modules
.next
out
next-env.d.ts
*.tsbuildinfo
`;

export const NEXTJS_AGENTS_NOTE = `# Design agent notes (Next.js static-export prototype)

This folder is a Next.js App Router prototype that Agent Threads Design previews on a local dev server and can export as plain static HTML (\`output: 'export'\`).

## Rules that keep the export working

- Mock data and client state only. Put fixtures in \`app/_data/\` or similar and use React state for interactivity.
- Do NOT add: API routes or route handlers (\`route.ts\`), middleware, Server Actions (\`'use server'\`), \`cookies()\`/\`headers()\`, or runtime server fetches. They break \`next build\` with static export.
- Dynamic route segments (\`[id]\`, \`[...slug]\`) are allowed only when that segment exports \`generateStaticParams()\` returning mock params.
- Use plain \`<img>\` or local assets under \`public/\`; \`next/image\` optimization is disabled. No remote fonts or network calls.
- Do not install packages and do not edit \`package.json\`, \`next.config.mjs\`, or \`artifact.json\`. Tailwind CSS v4 is already set up in \`app/globals.css\`.
- \`node_modules\` is a shared, pre-installed link. Do not run \`npm install\`. The preview dev server is started by Agent Threads; do not start your own.
- Keep accessibility basics: semantic landmarks, keyboard operation, labels, focus states, contrast.

## Layout

- \`app/layout.tsx\`, \`app/page.tsx\`: entry points. Replace the placeholder page promptly.
- \`app/<route>/page.tsx\`: additional pages for multi-page flows.
- \`public/\`: static assets, referenced with absolute paths such as \`/logo.svg\`.

An export-readiness check runs before export and reports any of the forbidden features above.
`;
