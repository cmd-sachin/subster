import { ClientOnly, createFileRoute } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { Loader } from '@/components/loader';

// Bryntum is a browser-only library, loaded on demand so it stays out of the other pages' bundle.
const Timeline = lazy(() => import('@/components/timeline'));
const loading = <Loader label="Loading timeline" />;

export const Route = createFileRoute('/timeline')({
  component: () => (
    <ClientOnly fallback={loading}>
      <Suspense fallback={loading}>
        <Timeline />
      </Suspense>
    </ClientOnly>
  ),
});
