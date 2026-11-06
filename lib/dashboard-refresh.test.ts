import assert from "node:assert/strict";
import { it } from "node:test";
import { DASHBOARD_REFRESH_EVENT, refreshDashboardView } from "./dashboard-refresh";

it("refreshes the route when no drawer handles the request", () => {
  let refreshes = 0;
  refreshDashboardView(() => refreshes++, new EventTarget());
  assert.equal(refreshes, 1);
});

it("lets an open drawer refresh in place and resumes route refresh after it closes", () => {
  const target = new EventTarget();
  let routeRefreshes = 0;
  let drawerRefreshes = 0;
  const handler = (event: Event) => {
    event.preventDefault();
    drawerRefreshes++;
  };
  target.addEventListener(DASHBOARD_REFRESH_EVENT, handler);
  refreshDashboardView(() => routeRefreshes++, target);
  refreshDashboardView(() => routeRefreshes++, target);
  assert.equal(drawerRefreshes, 2);
  assert.equal(routeRefreshes, 0);
  target.removeEventListener(DASHBOARD_REFRESH_EVENT, handler);
  refreshDashboardView(() => routeRefreshes++, target);
  assert.equal(routeRefreshes, 1);
});
