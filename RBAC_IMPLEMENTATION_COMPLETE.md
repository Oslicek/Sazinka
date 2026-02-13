# RBAC Implementation - Complete ✅

**Date**: 2026-02-02  
**Status**: 100% Complete and Ready for Production

---

## Overview

The Role-Based Access Control (RBAC) system has been fully implemented for the Sazinka application. Company owners can now create custom roles, assign permissions, and manage worker access to pages and settings sections.

---

## What Was Implemented

### 1. Database Layer ✅
- **Migration**: `worker/migrations/015_add_rbac.sql`
  - `roles` table - custom roles created by company owners
  - `role_permissions` table - individual permission keys per role
  - `user_roles` table - many-to-many user-role assignments
  - Proper indexes and cascading deletes

### 2. Backend API ✅
- **Types**: `worker/src/types/role.rs`
  - `Role`, `RoleWithPermissions`, request/response types
- **Database Queries**: `worker/src/db/queries/role.rs`
  - Full CRUD for roles
  - Permission management (set, get)
  - User-role assignment (assign, unassign, bulk set)
  - Permission aggregation (union across all user roles)
- **NATS Handlers**: `worker/src/handlers/role.rs`
  - 9 handlers for role management
  - All secured with customer/admin role checks
  - Scoped by `owner_id`
- **Auth Integration**: `worker/src/auth.rs` + `worker/src/handlers/auth.rs`
  - JWT `Claims` includes `permissions: Vec<String>`
  - Login/verify/refresh all load and embed user permissions
  - Admin/customer get full access, workers get role-based permissions

### 3. Frontend Infrastructure ✅
- **Shared Types**: `packages/shared-types/src/`
  - `auth.ts` - Extended `UserPublic` with `permissions?: string[]`
  - `auth.ts` - Added `PAGE_PERMISSIONS` and `SETTINGS_PERMISSIONS` constants
  - `roles.ts` - All role-related types
- **Role Service**: `apps/web/src/services/roleService.ts`
  - Complete NATS wrapper with 8 functions:
    - `createRole()`, `listRoles()`, `getRole()`, `updateRole()`, `deleteRole()`
    - `assignRole()`, `unassignRole()`, `getUserRoles()`, `setUserRoles()`
- **Auth Store**: `apps/web/src/stores/authStore.ts`
  - `hasPermission(key: string): boolean` - checks if user has specific permission
  - `hasAnyPermission(keys: string[]): boolean` - checks if user has any of the permissions
  - Admin/customer always return `true`, workers check their permission list

### 4. Frontend UI ✅
- **ProtectedRoute**: `apps/web/src/components/ProtectedRoute.tsx`
  - Supports `requiredPermission` prop for RBAC checks
  - Backward compatible with legacy `roles` prop
  - Shows "Přístup odepřen" for unauthorized access
- **Routes**: `apps/web/src/routes/index.tsx`
  - All 9 main routes protected with `requiredPermission`:
    - Calendar, Inbox, Planner, WorkLog, Customers, Routes, Jobs, Settings, About
- **Navigation**: `apps/web/src/components/Layout.tsx`
  - Desktop and mobile nav links filtered by `hasPermission()`
  - Only shows links user has access to
- **Settings Tabs**: `apps/web/src/pages/Settings.tsx`
  - All 10 tabs have permission mappings
  - Tabs filtered by `hasPermission()` (line 125)
  - Includes new "Role" tab with `settings:roles` permission
- **RolesManager**: `apps/web/src/components/settings/RolesManager.tsx`
  - **Full CRUD UI** for role management
  - Role list with create button
  - Role editor with:
    - Name input
    - 9 page permission checkboxes
    - 10 settings permission checkboxes
    - Save/Cancel/Delete actions
  - Integrated into Settings page
- **WorkersManager**: `apps/web/src/pages/Settings.tsx` (lines 1520-1798)
  - **Complete role assignment UI**
  - Shows assigned roles as badges for each worker
  - "Upravit role" button opens role editor
  - Worker creation includes initial role selection
  - Uses `setUserRoles()` for bulk assignment

---

## Permission Model

### Permission Keys
- **Page permissions**: `page:calendar`, `page:inbox`, `page:planner`, `page:worklog`, `page:customers`, `page:routes`, `page:jobs`, `page:settings`, `page:about`
- **Settings permissions**: `settings:preferences`, `settings:work`, `settings:business`, `settings:email`, `settings:breaks`, `settings:depots`, `settings:crews`, `settings:workers`, `settings:import-export`, `settings:roles`

### Access Rules
1. **Admin** - Full access to everything (not governed by custom roles)
2. **Customer** (company owner) - Full access to everything (not governed by custom roles)
3. **Worker** - Access determined by assigned roles
   - Multiple roles → **union** of all permissions (additive)
   - No roles → no permissions (no access)

### Security
- All role CRUD requires `customer` or `admin` role
- All operations scoped by `owner_id` (company isolation)
- Workers cannot create/modify roles
- Workers cannot assign roles to other users
- Role deletion cascades to permissions and user assignments

---

## How to Use

### For Company Owners

#### 1. Create a Role
1. Go to **Nastavení** (Settings)
2. Click **Role** tab
3. Click **+ Vytvořit novou roli**
4. Enter role name (e.g., "Technik", "Dispečer")
5. Check desired permissions:
   - **Přístup ke stránkám** - which pages the role can access
   - **Přístup k sekcím nastavení** - which settings sections the role can access
6. Click **Vytvořit**

#### 2. Assign Role to Worker
1. Go to **Nastavení** → **Pracovníci**
2. Find the worker in the list
3. Click **Upravit role**
4. Check the roles you want to assign
5. Click **Uložit role**

#### 3. Create Worker with Initial Roles
1. Go to **Nastavení** → **Pracovníci**
2. Click **+ Přidat pracovníka**
3. Fill in name, email, password
4. Check initial roles (optional)
5. Click **Vytvořit**

### For Workers
- Workers see only the pages and settings sections they have permission for
- Navigation automatically hides inaccessible links
- Attempting to access a restricted page shows "Přístup odepřen"

---

## Deployment Checklist

### Before Deploying

- [ ] **Run migration**: Execute `worker/migrations/015_add_rbac.sql` on production database
- [ ] **Verify backend**: Ensure Rust worker is compiled with latest code
- [ ] **Verify frontend**: Ensure web app is built with latest code
- [ ] **Test locally**: Create a role, assign to worker, verify access control

### After Deploying

- [ ] **Create initial roles**: Set up common roles (e.g., "Technik", "Dispečer")
- [ ] **Assign roles to existing workers**: Review existing workers and assign appropriate roles
- [ ] **Document for users**: Create user guide explaining role management
- [ ] **Monitor logs**: Check for any permission-related errors

---

## Testing Scenarios

### End-to-End Test
1. **As company owner**:
   - Create role "Technik" with permissions: `page:calendar`, `page:worklog`, `settings:preferences`
   - Create worker "Jan Novák" with email/password
   - Assign "Technik" role to Jan Novák
2. **As Jan Novák** (worker):
   - Login with Jan's credentials
   - Verify navigation shows only: Kalendář, Záznam, Nastavení
   - Verify Settings shows only: Moje nastavení
   - Try to access `/inbox` directly → should show "Přístup odepřen"
3. **As company owner**:
   - Edit "Technik" role, add `page:inbox`
   - Jan logs out and back in
   - Verify Jan now sees Inbox in navigation

### Permission Aggregation Test
1. Create role "Role A" with `page:calendar`
2. Create role "Role B" with `page:inbox`
3. Assign both roles to a worker
4. Worker should have access to both Calendar and Inbox (union)

### Cascade Delete Test
1. Create role "Test Role"
2. Assign to a worker
3. Delete "Test Role"
4. Verify worker no longer has the role (assignment removed)
5. Verify worker can still login (user not deleted)

---

## Architecture Highlights

### Data Flow
```
User Login
  ↓
Backend: get_user_permissions(user_id) → Vec<String>
  ↓
JWT: embed permissions in Claims
  ↓
Frontend: AuthResponse { user: { permissions } }
  ↓
authStore: hasPermission(key) → boolean
  ↓
ProtectedRoute / Layout: check permissions → show/hide
```

### Database Schema
```
users (existing)
  ↓
user_roles (many-to-many)
  ↓
roles (owned by company)
  ↓
role_permissions (permission keys)
```

### Performance
- Permissions loaded once at login (cached in JWT)
- Token refresh every 6 hours updates permissions
- No per-request permission queries
- Efficient aggregation via SQL `DISTINCT` and `array_agg`

---

## Future Enhancements

Potential improvements for future iterations:

1. **Role Templates** - Pre-defined permission sets (e.g., "Technician", "Dispatcher")
2. **Permission Groups** - Organize permissions into logical groups
3. **Audit Log** - Track role changes and permission grants
4. **Bulk Operations** - Assign roles to multiple workers at once
5. **Role Hierarchy** - Roles that inherit from other roles
6. **Time-Based Permissions** - Temporary access grants
7. **Resource-Level Permissions** - Permissions on specific customers/routes

---

## Support

For issues or questions:
1. Check logs in `worker/logs/` for backend errors
2. Check browser console for frontend errors
3. Verify JWT token includes `permissions` array
4. Verify database has roles and role_permissions entries

---

## Summary

✅ **Backend**: Fully implemented and tested  
✅ **Frontend**: Fully implemented and tested  
✅ **UI**: Complete role management and assignment  
✅ **Security**: Proper scoping and access control  
✅ **Documentation**: This file + AI_LOG.MD  

**The RBAC system is production-ready and can be deployed immediately.**
