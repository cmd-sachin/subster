import { ClientOnly, createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { Loader } from '@/components/loader';

// AG Studio is a browser-only library, loaded on demand so it stays out of the other pages' bundle.
const Dashboard = lazy(() => import('@/components/studio/dashboard'));
const loading = <Loader label="Loading analytics" />;

export const Route = createFileRoute('/analytics')({
  component: () => (
    <ClientOnly fallback={loading}>
      <Suspense fallback={loading}>
        <Dashboard />
      </Suspense>
    </ClientOnly>
  ),
});
