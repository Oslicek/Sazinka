import { lazy, Suspense } from 'react';
import {
  createRootRoute,
  createRoute,
  redirect,
  Outlet,
} from '@tanstack/react-router';

import { Layout } from '@/components/Layout';
import { PageLoader } from '@/components/PageLoader';
import { ProtectedRoute } from '@/components/ProtectedRoute';

// --- Eager imports (needed immediately) ---
import { Login } from '@/pages/Login';
import { Calendar } from '@/pages/Calendar';

// --- Lazy imports (loaded on navigate) ---
const Register = lazy(() => import('@/pages/Register').then(m => ({ default: m.Register })));
const Dashboard = lazy(() => import('@/pages/Dashboard').then(m => ({ default: m.Dashboard })));
const Customers = lazy(() => import('@/pages/Customers').then(m => ({ default: m.Customers })));
const CustomerDetail = lazy(() => import('@/pages/CustomerDetail').then(m => ({ default: m.CustomerDetail })));
const CustomerSummary = lazy(() => import('@/pages/CustomerSummary').then(m => ({ default: m.CustomerSummary })));
const Planner = lazy(() => import('@/pages/Planner').then(m => ({ default: m.Planner })));
const PlanningInbox = lazy(() => import('@/pages/PlanningInbox').then(m => ({ default: m.PlanningInbox })));
const Admin = lazy(() => import('@/pages/Admin').then(m => ({ default: m.Admin })));
const Settings = lazy(() => import('@/pages/Settings').then(m => ({ default: m.Settings })));
const RevisionDetail = lazy(() => import('@/pages/RevisionDetail').then(m => ({ default: m.RevisionDetail })));
const VisitDetail = lazy(() => import('@/pages/VisitDetail').then(m => ({ default: m.VisitDetail })));
const WorkItemDetail = lazy(() => import('@/pages/WorkItemDetail').then(m => ({ default: m.WorkItemDetail })));
const Jobs = lazy(() => import('@/pages/Jobs').then(m => ({ default: m.Jobs })));
const WorkLog = lazy(() => import('@/pages/WorkLog').then(m => ({ default: m.WorkLog })));
const RoutesPage = lazy(() => import('@/pages/Routes').then(m => ({ default: m.Routes })));
const About = lazy(() => import('@/pages/About').then(m => ({ default: m.About })));

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
  component: Customers,
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
  component: Calendar,
});

// Route planner
const plannerRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/planner',
  component: Planner,
});

// Planning Inbox (route-aware)
const inboxRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/inbox',
  component: PlanningInbox,
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

// Settings - requires customer or admin role
const settingsRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/settings',
  component: () => (
    <ProtectedRoute roles={['customer', 'admin']}>
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

// Redirect /today to /planner (TechnicianDay merged into Planner)
const todayRedirectRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/today',
  beforeLoad: () => {
    throw redirect({ to: '/planner' });
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
  component: Jobs,
});

// Work Log
const workLogRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/worklog',
  component: WorkLog,
});

// Routes overview
const routesRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/routes',
  component: RoutesPage,
});

// About page
const aboutRoute = createRoute({
  getParentRoute: () => layoutRoute,
  path: '/about',
  component: About,
});

// Route tree
export const routeTree = rootRoute.addChildren([
  loginRoute,
  registerRoute,
  layoutRoute.addChildren([
    indexRoute,
    customersRoute,
    customerSummaryRoute,
    customerDetailRoute,
    calendarRoute,
    plannerRoute,
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
