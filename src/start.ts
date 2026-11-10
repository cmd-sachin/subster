import { createStart } from '@tanstack/react-start';

// The dashboards are driven by live client-side data (TanStack Query plus an event stream) and
// two browser-only component libraries, so pages render on the client. The server serves the
// document shell and the API.
export const startInstance = createStart(() => ({ defaultSsr: false }));
