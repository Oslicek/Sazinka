---
name: "Mobile Inbox: List + Bottom Sheet"
overview: "Replace the 3-tab mobile layout (List / Map / Detail) in PlanningInbox with a primary List view and a slide-up bottom sheet for candidate detail. The Map becomes a toggle overlay. This eliminates tab-switching friction and keeps the list always visible as context."
todos:
  - id: bottom-sheet-component
    content: "Create reusable BottomSheet component with drag-to-snap, backdrop, swipe-to-dismiss, and body scroll lock"
    status: pending
  - id: replace-mobile-layout
    content: "Replace 3-tab mobile layout with always-visible list + BottomSheet for detail"
    status: pending
  - id: map-overlay
    content: "Add floating map button (FAB) and full-screen map overlay to replace the Map tab"
    status: pending
  - id: mobile-css
    content: "Update PlanningInbox.module.css for new mobile layout (remove tab styles, add FAB/overlay styles)"
    status: pending
  - id: selection-flow
    content: "Adjust candidate selection/deselection flow for sheet open/close instead of tab switching"
    status: pending
  - id: cleanup
    content: "Remove unused MobileTabBar usage, activePanel state, and tab-related code from PlanningInbox"
    status: pending
---

# Mobile Inbox: List + Bottom Sheet

## Current state

The mobile PlanningInbox (<=1023px) uses a `MobileTabBar` with three tabs: **List**, **Map**, **Detail**. Only one panel is visible at a time. Tapping a candidate in the list auto-switches to the Detail tab, forcing the user to manually navigate back to List for the next candidate. The Map tab is fully isolated.

## Target UX

```
+----------------------------+
| Planovaci inbox            |  <-- page header (always visible)
+----------------------------+
| Vse | Akutni | Do 7 dnu ...|  <-- filters (always visible)
| Poradi: Standard  42 Reset |
+----------------------------+
|  [Candidate row]           |  <-- scrollable list (always visible)
|  [Candidate row]  *        |      * = selected
|  [Candidate row]           |
|  [Candidate row]           |
+============================+  <-- bottom sheet (slides up on selection)
| -- drag handle --          |
| Novak Jan          [close] |  <-- sheet header
| +420 777 ...   Due: 15.3.  |  <-- sheet content (scrollable)
| [Schedule] [Add to route]  |
| Devices, timeline, ...     |
+----------------------------+
```

- **List** is always the primary view, filling the screen
- **Bottom sheet** slides up when a candidate is selected; half-screen by default, draggable to full-screen or dismissable by swiping down
- **Map** becomes a floating toggle button (bottom-right corner) that expands the map as a full-screen overlay on top of the list; closing the overlay returns to the list
- **MobileTabBar** is removed from the mobile inbox layout entirely

## Implementation steps

### Step 1: Create `BottomSheet` common component

Create a reusable `BottomSheet` component at `apps/web/src/components/common/BottomSheet.tsx` with accompanying CSS module.

**Props:**

```typescript
interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  /** Initial snap point: 'half' (50vh) or 'full' (90vh). Default: 'half' */
  initialSnap?: 'half' | 'full';
}
```

**Behavior:**
- Fixed position overlay at the bottom of the viewport
- Semi-transparent backdrop that closes the sheet on tap
- Drag handle at the top for swipe gestures
- Two snap points: half-screen (~50dvh) and full-screen (~90dvh)
- Swipe down past threshold dismisses (calls `onClose`)
- Swipe up from half snaps to full
- Content area scrolls independently when sheet is at a snap point
- `slideUp` / `slideDown` CSS animation (0.25s ease-out)
- Body scroll lock when open (prevent background list from scrolling)
- Close on Escape key

**CSS patterns to follow:** Use the existing `slideUp` animation from `apps/web/src/components/settings/DeleteAccountDialog.module.css` as a starting point, but animate from `translateY(100%)` instead of `translateY(20px)`.

**Touch drag implementation:** Use `onTouchStart` / `onTouchMove` / `onTouchEnd` on the header/handle area. Track delta-Y and update `transform: translateY()` in real-time. On touch end, snap to nearest point or dismiss if past threshold.

Export from `apps/web/src/components/common/index.ts`.

### Step 2: Replace mobile layout in PlanningInbox

In `apps/web/src/pages/PlanningInbox.tsx`, replace the `if (isMobileUi)` block (lines 2914-2936):

**Remove:**
- `MobileTabBar` from the mobile render
- The `activePanel` / `setPanel` / `panel` URL search param logic (lines 146-151) -- only used for mobile tabs
- The auto-switch `useEffect` that navigates to the detail tab (lines 218-223)

**New mobile layout:**

```
.pageMobile
  pageHeader
  breakWarningBanner
  .mobilePanel (flex: 1, contains the list)
    renderInboxList()
  BottomSheet (isOpen={!!selectedCandidateId}, onClose={clearSelection})
    renderDetailPanel() content
  MapFAB (bottom-right floating button, toggles map overlay)
  MapOverlay (conditional full-screen map)
```

- The list is ALWAYS rendered (no conditional `activePanel === 'list'`)
- `BottomSheet` wraps the detail content; opens when `selectedCandidateId` is truthy
- Closing the sheet clears `selectedCandidateId` (deselects the candidate)
- The selected row stays highlighted in the list behind the sheet

### Step 3: Map as toggle overlay

Instead of a Map tab, add a floating action button (FAB) in the bottom-right corner of the mobile list view. Tapping it toggles a full-screen map overlay.

**New state:** `const [isMapOpen, setIsMapOpen] = useState(false)`

**MapOverlay:** A fixed-position full-screen div containing `renderMapPanel()` content, with a close button in the top-right corner. Simple `opacity` + `translateY` transition.

When the map overlay is open AND a candidate is selected, the bottom sheet should close (or the map should render on top of everything). Simplest approach: the map overlay has higher z-index than the bottom sheet.

### Step 4: Update mobile CSS

In `apps/web/src/pages/PlanningInbox.module.css`:

- Remove or repurpose `.mobilePanel` styles (it now only holds the list, not three conditional panels)
- Remove tab-related mobile styles if any
- Add `.mapFab` styles (fixed position button, bottom-right, above bottom sheet)
- Add `.mapOverlay` styles (fixed, full-screen, high z-index)
- Adjust `.inboxPanel` mobile override -- it is now the sole content of `.mobilePanel`

### Step 5: Adjust candidate selection flow

In `apps/web/src/pages/PlanningInbox.tsx`:

- `handleCandidateSelect` stays mostly the same -- it sets `selectedCandidateId`, which now opens the bottom sheet instead of switching tabs
- Add `handleSheetClose` that clears `selectedCandidateId` and removes the sessionStorage entry
- After scheduling confirmation is dismissed (`handleDismissConfirmation`), auto-close the sheet and optionally scroll to the next candidate in the list
- When `onRemoveFromRoute` or `onAddToRoute` completes, keep the sheet open (user may want to continue reviewing)

### Step 6: Clean up unused code

- Remove `MobileTabBar` import from PlanningInbox (it is still used by other pages, so do not delete the component)
- Remove `activePanel` / `setPanel` / panel search param if no longer needed
- Remove the `tab_list`, `tab_map`, `tab_detail` i18n keys if only used here (check other pages first)

## Out of scope

- Desktop layout: unchanged (three-panel ThreePanelLayout)
- The `BottomSheet` component is generic and reusable, but we only wire it into PlanningInbox for now
- Advanced gestures (e.g., swipe between candidates in the sheet) -- can be added later
- Map overlay interactions (tapping a pin to select a candidate) -- preserve existing behavior

## Testing

- Verify the list renders correctly behind the bottom sheet on narrow viewports
- Verify the sheet opens on candidate tap, closes on swipe-down / backdrop tap / Escape
- Verify scheduling and "add to route" actions work from within the sheet
- Verify the map FAB toggles the map overlay on/off
- Verify desktop layout is completely unaffected
