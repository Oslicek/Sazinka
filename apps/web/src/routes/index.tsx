import {
  createRootRoute,
  createRoute,
  redirect,
  Outlet,
} from '@tanstack/react-router';

import { Layout } from '@/components/Layout';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { Dashboard } from '@/pages/Dashboard';
import { Customers } from '@/pages/Customers';
import { CustomerDetail } from '@/pages/CustomerDetail';
import { CustomerSummary } from '@/pages/CustomerSummary';
import { Calendar } from '@/pages/Calendar';
import { Planner } from '@/pages/Planner';
import { PlanningInbox } from '@/pages/PlanningInbox';
import { Admin } from '@/pages/Admin';
import { Settings } from '@/pages/Settings';
import { RevisionDetail } from '@/pages/RevisionDetail';
import { Jobs } from '@/pages/Jobs';
import { WorkLog } from '@/pages/WorkLog';
import { Login } from '@/pages/Login';
import { Register } from '@/pages/Register';
import { About } from '@/pages/About';

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
  component: Register,
});

// --- Layout wrapper for authenticated pages ---

const layoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'layout',
  component: () => (
    <ProtectedRoute>
      <Layout>
        <Outlet />
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
    jobsRoute,
    workLogRoute,
    adminRoute,
    settingsRoute,
    aboutRoute,
  ]),
]);
