// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import type { DashboardSummary } from "@paperclipai/shared";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudAccessGate } from "../components/CloudAccessGate";
import { DialogProvider, useDialogActions, useDialogState } from "../context/DialogContext";
import { queryKeys } from "../lib/queryKeys";
import { AuthPage } from "./Auth";
import { Dashboard } from "./Dashboard";

const state = vi.hoisted(() => ({ signedIn: false, boardAccess: true }));
const agentsList = vi.hoisted(() => vi.fn());
const signIn = vi.hoisted(() => vi.fn());
const breadcrumbs = vi.hoisted(() => vi.fn());
const company = vi.hoisted(() => ({ id: "company-1", issuePrefix: "NOV", name: "NOverhead" }));

vi.mock("../api/auth", () => ({ authApi: {
  getSession: async () => state.signedIn ? { user: { id: "owner-1", email: "owner@example.test" } } : null,
  signInEmail: signIn,
} }));
vi.mock("../api/health", () => ({ healthApi: { get: async () => ({ status: "ok", deploymentMode: "authenticated", deploymentExposure: "private", bootstrapStatus: "ready" }) } }));
vi.mock("../api/access", () => ({ accessApi: {
  getCurrentBoardAccess: async () => ({ isInstanceAdmin: false, companyIds: state.boardAccess ? [company.id] : [] }),
  listUserDirectory: async () => ({ users: [] }),
} }));
vi.mock("../api/agents", () => ({ agentsApi: { list: agentsList } }));
vi.mock("../api/dashboard", () => ({ dashboardApi: { summary: async () => ({
  companyId: company.id,
  agents: { active: 0, running: 0, paused: 0, error: 0 },
  tasks: { open: 0, inProgress: 0, blocked: 0, done: 0 },
  costs: { monthSpendCents: 0, monthBudgetCents: 0, monthUtilizationPercent: 0 },
  budgets: { activeIncidents: 0, pendingApprovals: 0, pausedAgents: 0, pausedProjects: 0 },
  pendingApprovals: 0,
  runActivity: [],
} satisfies DashboardSummary) } }));
vi.mock("../api/activity", () => ({ activityApi: { list: async () => [] } }));
vi.mock("../api/issues", () => ({ issuesApi: { list: async () => [] } }));
vi.mock("../api/projects", () => ({ projectsApi: { list: async () => [] } }));
vi.mock("../context/CompanyContext", () => ({ useCompany: () => ({ selectedCompany: company, selectedCompanyId: company.id, companies: [company], loading: false }) }));
vi.mock("../context/BreadcrumbContext", () => ({ useBreadcrumbs: () => ({ setBreadcrumbs: breadcrumbs }) }));
vi.mock("../context/DesignSandboxContext", () => ({ useDesignSandbox: () => false }));
vi.mock("../hooks/useSharedPolling", () => ({ useSharedPollingQuery: () => undefined, usePublishSharedQueryData: () => {} }));
vi.mock("../components/ActiveAgentsPanel", () => ({ ActiveAgentsPanel: () => <section aria-label="Agent activity" /> }));
vi.mock("../components/AsciiArtAnimation", () => ({ AsciiArtAnimation: () => null }));
vi.mock("../components/ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("../components/SmokeLabDashboardCard", () => ({ SmokeLabDashboardCard: () => null }));
vi.mock("@/plugins/slots", () => ({ PluginSlotOutlet: () => null }));
vi.mock("../components/ActivityCharts", () => ({
  ChartCard: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  RunActivityChart: () => null,
  PriorityChart: () => null,
  IssueStatusChart: () => null,
  SuccessRateChart: () => null,
}));

function ObserveDialogs() {
  const location = useLocation();
  const { onboardingOpen, onboardingOptions } = useDialogState();
  const { closeOnboarding } = useDialogActions();
  return <>
    <output data-testid="route">{location.pathname}</output>
    <output data-testid="onboarding">{JSON.stringify({ open: onboardingOpen, options: onboardingOptions })}</output>
    {onboardingOpen && <button onClick={closeOnboarding}>Close setup</button>}
  </>;
}

describe("authenticated dashboard without agents", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let client: QueryClient;

  beforeEach(() => {
    state.signedIn = false;
    state.boardAccess = true;
    agentsList.mockReset().mockResolvedValue([]);
    signIn.mockReset().mockImplementation(async () => { state.signedIn = true; });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  });

  async function mount() {
    await act(async () => root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/NOV/dashboard"]}>
          <DialogProvider>
            <Routes>
              <Route path="/auth" element={<AuthPage />} />
              <Route element={<CloudAccessGate />}>
                <Route path="/NOV/dashboard" element={<Dashboard />} />
              </Route>
            </Routes>
            <ObserveDialogs />
          </DialogProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    ));
  }

  const dialogState = () => JSON.parse(container.querySelector('[data-testid="onboarding"]')!.textContent!);
  async function waitForDashboard() {
    await vi.waitFor(() => expect(container.textContent).toContain("You have no agents."));
    expect(container.textContent).toContain("Agents Enabled");
    expect(container.textContent).toContain("0 running");
    expect(container.querySelector('[data-testid="route"]')?.textContent).toBe("/NOV/dashboard");
    expect(dialogState().open).toBe(false);
  }

  it("signs an existing owner in and keeps the zero-agent dashboard after refetch and remount", async () => {
    await mount();
    await vi.waitFor(() => expect(container.querySelector('input[name="email"]')).not.toBeNull());
    expect(container.querySelector('[aria-label="Agent activity"]')).toBeNull();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      for (const [name, value] of [["email", "owner@example.test"], ["password", "test-password"]]) {
        const input = container.querySelector(`input[name="${name}"]`)!;
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await waitForDashboard();
    expect(signIn).toHaveBeenCalledOnce();
    await act(async () => { await client.invalidateQueries({ queryKey: queryKeys.agents.list(company.id) }); });
    await waitForDashboard();
    expect(agentsList.mock.calls.length).toBeGreaterThanOrEqual(2);
    await act(async () => root.unmount());
    root = createRoot(container);
    await mount();
    await waitForDashboard();
  });

  it("opens setup only on request for the existing organization and stays closed after dismissal", async () => {
    state.signedIn = true;
    await mount();
    await waitForDashboard();
    const setup = [...container.querySelectorAll("button")].find(button => button.textContent === "Create one here")!;
    await act(async () => setup.click());
    expect(dialogState()).toEqual({ open: true, options: { initialStep: 3, companyId: company.id } });
    await act(async () => { [...container.querySelectorAll("button")].find(button => button.textContent === "Close setup")!.click(); });
    await act(async () => { await client.invalidateQueries({ queryKey: queryKeys.agents.list(company.id) }); });
    await waitForDashboard();
  });

  it("still denies the board to an authenticated user without organization access", async () => {
    state.signedIn = true;
    state.boardAccess = false;
    await mount();
    await vi.waitFor(() => expect(container.textContent).toContain("No organization access"));
    expect(agentsList).not.toHaveBeenCalled();
    expect(container.querySelector('[aria-label="Agent activity"]')).toBeNull();
  });
});
