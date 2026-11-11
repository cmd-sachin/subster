import '@fontsource-variable/inter';
import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from '@tanstack/react-router';
import { LiveUpdates } from '@/components/app-state';
import { AlertWatcher, Toasts } from '@/components/notifications';
import { ExtensionLink } from '@/components/extension-link';
import { Gate } from '@/components/session';
import { Shell } from '@/components/shell';
import { Walkthrough } from '@/components/walkthrough';
import appCss from '@/styles/app.css?url';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Subster' },
      { name: 'description', content: 'An agent that makes every subscription earn its place.' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32.png' },
      { rel: 'icon', type: 'image/png', sizes: '192x192', href: '/icon-192.png' },
      { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
    ],
  }),
  shellComponent: Document,
  component: App,
});

function Document({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <head>
        <HeadContent />
      </head>
      <body className="h-full">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function App() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <Toasts />
      <Gate>
        <LiveUpdates />
        <AlertWatcher />
        <ExtensionLink />
        <Shell>
          <Outlet />
        </Shell>
        <Walkthrough />
      </Gate>
    </QueryClientProvider>
  );
}
