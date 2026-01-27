import {
  createRootRoute,
  createRoute,
  Outlet,
} from '@tanstack/react-router';

import { Layout } from '@/components/Layout';
import { Dashboard } from '@/pages/Dashboard';
import { Customers } from '@/pages/Customers';
import { CustomerDetail } from '@/pages/CustomerDetail';
import { Calendar } from '@/pages/Calendar';
import { Planner } from '@/pages/Planner';

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

// Route tree
export const routeTree = rootRoute.addChildren([
  indexRoute,
  customersRoute,
  customerDetailRoute,
  calendarRoute,
  plannerRoute,
]);
