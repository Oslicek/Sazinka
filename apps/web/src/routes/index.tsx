import {
  createRootRoute,
  createRoute,
  redirect,
  Outlet,
} from '@tanstack/react-router';

import { Layout } from '@/components/Layout';
import { Dashboard } from '@/pages/Dashboard';
import { Customers } from '@/pages/Customers';
import { CustomerDetail } from '@/pages/CustomerDetail';
import { CustomerSummary } from '@/pages/CustomerSummary';
import { Calendar } from '@/pages/Calendar';
import { Planner } from '@/pages/Planner';
import { Admin } from '@/pages/Admin';
import { Settings } from '@/pages/Settings';
import { CallQueue } from '@/pages/CallQueue';
import { RevisionDetail } from '@/pages/RevisionDetail';

// Root route with layout
const rootRoute = createRootRoute({
  component: () => (
    <Layout>
      <Outlet />
    </Layout>
  ),
});

// Dashboard (home page)
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Dashboard,
});

// Customers
const customersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/customers',
  component: Customers,
});

// Customer summary (static route - must be before dynamic $customerId route)
const customerSummaryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/customers/summary',
  component: CustomerSummary,
});

// Customer detail
const customerDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/customers/$customerId',
  component: CustomerDetail,
});

// Calendar
const calendarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/calendar',
  component: Calendar,
});

// Route planner
const plannerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/planner',
  component: Planner,
});

// Admin
const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  component: Admin,
});

// Settings
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: Settings,
});

// Call Queue
const callQueueRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/queue',
  component: CallQueue,
});

// Redirect /today to /planner (TechnicianDay merged into Planner)
const todayRedirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/today',
  beforeLoad: () => {
    throw redirect({ to: '/planner' });
  },
});

// Revision Detail
const revisionDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/revisions/$revisionId',
  component: RevisionDetail,
});

// Route tree
export const routeTree = rootRoute.addChildren([
  indexRoute,
  customersRoute,
  customerSummaryRoute,
  customerDetailRoute,
  calendarRoute,
  plannerRoute,
  callQueueRoute,
  todayRedirectRoute,
  revisionDetailRoute,
  adminRoute,
  settingsRoute,
]);
