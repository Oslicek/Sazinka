import { Suspense } from 'react';
import {
  createRootRoute,
  createRoute,
  redirect,
  Outlet,
} from '@tanstack/react-router';

import { Layout } from '@/components/Layout';
import { PageLoader } from '@/components/PageLoader';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { lazyWithRetry } from '@/lib/lazyWithRetry';

// --- Eager imports (needed immediately) ---
import { Login } from '@/pages/Login';
import { Calendar } from '@/pages/Calendar';

// --- Lazy imports (loaded on navigate) ---
// Uses lazyWithRetry to handle Cloudflare Access session expiry: if a chunk
// fetch is redirected to the login page (MIME mismatch), the import is retried
// once and, if still failing, the page reloads to re-authenticate.
const Register = lazyWithRetry(() =>
  import('@/components/onboarding/OnboardingWizard').then(m => ({ default: m.OnboardingWizard }))
);
const VerifyEmailCallback = lazyWithRetry(() =>
  import('@/pages/VerifyEmailCallback').then(m => ({ default: m.VerifyEmailCallback }))
);
const Dashboard = lazyWithRetry(() => import('@/pages/Dashboard').then(m => ({ default: m.Dashboard })));
const Customers = lazyWithRetry(() => import('@/pages/Customers').then(m => ({ default: m.Customers })));
const CustomerDetail = lazyWithRetry(() => import('@/pages/CustomerDetail').then(m => ({ default: m.CustomerDetail })));
const CustomerSummary = lazyWithRetry(() => import('@/pages/CustomerSummary').then(m => ({ default: m.CustomerSummary })));
const Plan = lazyWithRetry(() => import('@/pages/Plan').then(m => ({ default: m.Plan })));
const PlanningInbox = lazyWithRetry(() => import('@/pages/PlanningInbox').then(m => ({ default: m.PlanningInbox })));
const Admin = lazyWithRetry(() => import('@/pages/Admin').then(m => ({ default: m.Admin })));
const Settings = lazyWithRetry(() => import('@/pages/Settings').then(m => ({ default: m.Settings })));
const RevisionDetail = lazyWithRetry(() => import('@/pages/RevisionDetail').then(m => ({ default: m.RevisionDetail })));
const VisitDetail = lazyWithRetry(() => import('@/pages/VisitDetail').then(m => ({ default: m.VisitDetail })));
const WorkItemDetail = lazyWithRetry(() => import('@/pages/WorkItemDetail').then(m => ({ default: m.WorkItemDetail })));
const Jobs = lazyWithRetry(() => import('@/pages/Jobs').then(m => ({ default: m.Jobs })));
const WorkLog = lazyWithRetry(() => import('@/pages/WorkLog').then(m => ({ default: m.WorkLog })));
const RoutesPage = lazyWithRetry(() => import('@/pages/Routes').then(m => ({ default: m.Routes })));
const About = lazyWithRetry(() => import('@/pages/About').then(m => ({ default: m.About })));
const DetachedPanelPage = lazyWithRetry(() =>
  import('@/components/layout/DetachedPanelPage').then(m => ({ default: m.DetachedPanelPage }))
);

// Root route with layout (only for authenticated pages)
const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

// --- Auth routes (no layout, no protection) ---

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: Login,
});

const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <Register />
    </Suspense>
  ),
});

const verifyEmailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/verify-email',
  component: () => (
    <Suspense fallback={<PageLoader />}>
      <VerifyEmailCallback />
    </Suspense>
  ),
});

// --- Layout wrapper for authenticated pages ---

const layoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'layout',
  component: () => (
    <ProtectedRoute>
      <Layout>
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </Layout>
    </ProtectedRoute>
  ),
});

// Dashboard (home page) - redirect to calendar
const indexRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/calendar' });
  },
});

// Customers
const customersRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/customers',
  component: () => (
    <ProtectedRoute requiredPermission="page:customers">
      <Customers />
    </ProtectedRoute>
  ),
});

// Customer summary (static route - must be before dynamic $customerId route)
const customerSummaryRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/customers/summary',
  component: CustomerSummary,
});

// Customer detail
const customerDetailRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/customers/$customerId',
  component: CustomerDetail,
});

// Calendar
const calendarRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/calendar',
  component: () => (
    <ProtectedRoute requiredPermission="page:calendar">
      <Calendar />
    </ProtectedRoute>
  ),
});

// Route plan
const planRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/plan',
  component: () => (
    <ProtectedRoute requiredPermission="page:planner">
      <Plan />
    </ProtectedRoute>
  ),
});

// Planning Inbox (route-aware)
const inboxRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/inbox',
  component: () => (
    <ProtectedRoute requiredPermission="page:inbox">
      <PlanningInbox />
    </ProtectedRoute>
  ),
});

// Admin - requires admin role
const adminRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/admin',
  component: () => (
    <ProtectedRoute roles={['admin']}>
      <Admin />
    </ProtectedRoute>
  ),
});

// Settings - requires page:settings permission (customer/admin always have it)
const settingsRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/settings',
  component: () => (
    <ProtectedRoute requiredPermission="page:settings">
      <Settings />
    </ProtectedRoute>
  ),
});

// Call Queue - redirect to new Planning Inbox
const callQueueRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/queue',
  beforeLoad: () => {
    throw redirect({ to: '/inbox' });
  },
});

// Redirect /today to /plan (TechnicianDay merged into Plan)
const todayRedirectRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/today',
  beforeLoad: () => {
    throw redirect({ to: '/plan' });
  },
});

// Revision Detail
const revisionDetailRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/revisions/$revisionId',
  component: RevisionDetail,
});

// Visit Detail
const visitDetailRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/visits/$visitId',
  component: VisitDetail,
});

// Work Item Detail
const workItemDetailRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/work-items/$workItemId',
  component: WorkItemDetail,
});

// Jobs Dashboard
const jobsRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/jobs',
  component: () => (
    <ProtectedRoute requiredPermission="page:jobs">
      <Jobs />
    </ProtectedRoute>
  ),
});

// Work Log
const workLogRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/worklog',
  component: () => (
    <ProtectedRoute requiredPermission="page:worklog">
      <WorkLog />
    </ProtectedRoute>
  ),
});

// Routes overview
const routesRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/routes',
  component: () => (
    <ProtectedRoute requiredPermission="page:routes">
      <RoutesPage />
    </ProtectedRoute>
  ),
});

// About page
const aboutRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/about',
  component: () => (
    <ProtectedRoute requiredPermission="page:about">
      <About />
    </ProtectedRoute>
  ),
});

// Detached panel route (no Layout wrapper — standalone window)
const panelRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/panel/$panelId',
  component: () => {
    const { panelId } = panelRoute.useParams();
    const searchParams = new URLSearchParams(window.location.search);
    const pageContext = (searchParams.get('page') === 'plan' ? 'plan' : 'inbox') as 'inbox' | 'plan';
    const validPanels = ['map', 'list'] as const;
    type PanelType = typeof validPanels[number];
    const isValid = validPanels.includes(panelId as PanelType);
    const panel: PanelType = isValid ? (panelId as PanelType) : 'map';

    // Parse URL-seeded context for hybrid bootstrap
    const date = searchParams.get('date') ?? undefined;
    const crewId = searchParams.get('crewId') ?? undefined;
    const depotId = searchParams.get('depotId') ?? undefined;
    const urlSeed = date && crewId && depotId ? { date, crewId, depotId } : undefined;

    return (
      <ProtectedRoute>
        <Suspense fallback={<PageLoader />}>
          <DetachedPanelPage
            panel={panel}
            pageContext={pageContext}
            urlSeed={urlSeed}
          />
        </Suspense>
      </ProtectedRoute>
    );
  },
});

// Route tree
export const routeTree = rootRoute.addChildren([
  loginRoute,
  registerRoute,
  verifyEmailRoute,
  panelRoute,
  layoutRoute.addChildren([
    indexRoute,
    customersRoute,
    customerSummaryRoute,
    customerDetailRoute,
    calendarRoute,
    planRoute,
    inboxRoute,
    callQueueRoute,
    todayRedirectRoute,
    revisionDetailRoute,
    visitDetailRoute,
    workItemDetailRoute,
    jobsRoute,
    workLogRoute,
    routesRoute,
    adminRoute,
    settingsRoute,
    aboutRoute,
  ]),
]);
