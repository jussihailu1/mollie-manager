export const DASHBOARD_REFRESH_EVENT = "dashboard:refresh";

// An open workspace can refresh its own data without replacing the route tree.
export function refreshDashboardView(refreshRoute: () => void, target: EventTarget = window) {
  if (target.dispatchEvent(new Event(DASHBOARD_REFRESH_EVENT, { cancelable: true }))) {
    refreshRoute();
  }
}
