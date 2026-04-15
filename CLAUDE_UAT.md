# FindAPillar — User Acceptance Tests

Run these tests using Playwright (browser_navigate, browser_take_screenshot, browser_console_messages) after every deployment to verify the app works correctly. Report any failures before finishing.

---

## Test 1: Initial Load
1. Navigate to the production URL
2. **Verify**: Page title is "FindAPillar"
3. **Verify**: Logo shows two pillars (not a house/church icon)
4. **Verify**: 15–25 church cards load within 5 seconds
5. **Verify**: Map renders with OpenStreetMap tiles (not blank)
6. **Verify**: Map pins appear on the map
7. **Verify**: No errors in console (`browser_console_messages` level error)

---

## Test 2: Search
1. Type "Chicago" in the search box
2. **Verify**: Results filter to Chicago-area churches
3. **Verify**: Count bar updates (e.g. "2 churches")
4. Clear the search (click ×)
5. **Verify**: All churches return

---

## Test 3: Filters — Open & Apply
1. Click the **Filters** button
2. **Verify**: Filter drawer slides open from the right
3. Select a denomination (e.g. "Roman Catholic")
4. **Verify**: Incompatible denominations disappear (e.g. Lutheran, Baptist chips gone)
5. Click **Apply filters**
6. **Verify**: Drawer closes
7. **Verify**: Filter pill in header shows denomination **name** (e.g. "Roman Catholic"), NOT a UUID
8. **Verify**: Church list shows only matching churches

---

## Test 4: Map Drawing
1. Click the **Draw area** button on the map (top-right of map panel)
2. **Verify**: Cursor changes to crosshair; hint text appears ("Click to add points")
3. Click 4–5 points on the map to draw a region (e.g. around the northeast US)
4. **Verify**: A dashed polyline connects the drawn points
5. Click **Finish polygon**
6. **Verify**: A dashed polygon shape appears on the map
7. **Verify**: Church list updates to show only churches within the polygon
8. **Verify**: Count bar says "N churches in drawn area"
9. Click **Clear area**
10. **Verify**: Polygon disappears; all churches return

---

## Test 5: Church Detail Page
1. Click on any church card
2. **Verify**: Navigates to `/church/[slug]`
3. **Verify**: Church name, denomination, address, service times appear
4. **Verify**: Back button (top-left) returns to search
5. **Verify**: "Open in Google Maps" link is present if church has location

---

## Test 6: Map ↔ List Interaction
1. Hover over a church card
2. **Verify**: Corresponding map pin highlights (darker/larger)
3. Click a map pin
4. **Verify**: A preview card appears at the bottom of the map
5. **Verify**: The church card in the list scrolls into view and gets selected styling
6. Click **Dismiss** on the map preview
7. **Verify**: Preview card disappears

---

## Test 7: Responsive / Mobile
1. Resize viewport to 375×812 (iPhone)
2. **Verify**: Map is hidden on mobile (list takes full width)
3. **Verify**: Search input, Filters button, and logo are visible
4. **Verify**: Church cards are readable

---

## Pass Criteria
All 7 tests must pass before a deployment is considered stable. If any test fails, fix the issue and re-run the failing test before deploying again.
