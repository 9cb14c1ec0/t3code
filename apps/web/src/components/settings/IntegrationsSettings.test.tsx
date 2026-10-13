import {
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_UNIFIED_SETTINGS,
  type DeviceServiceState,
} from "@t3tools/contracts";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, StrictMode, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { listBrowserImportSources } = vi.hoisted(() => ({
  listBrowserImportSources: vi.fn().mockResolvedValue([]),
}));

vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ render, children }: { render: ReactNode; children: ReactNode }) => (
    <>
      {render}
      {children}
    </>
  ),
  TooltipPopup: () => null,
}));
vi.mock("../preview/previewBridge", () => ({
  previewBridge: { listBrowserImportSources },
}));
vi.mock("../../env", () => ({ isElectron: true }));
vi.mock("../../state/environments", () => ({
  useEnvironments: () => ({ environments: [], isReady: true }),
  usePrimaryEnvironment: () => null,
  // Settings rows resolve the primary grant before rendering server controls.
  usePrimaryEnvironmentId: () => null,
}));
vi.mock("../../hooks/useSettings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../hooks/useSettings")>()),
  PRIMARY_SETTINGS_UNAVAILABLE_MESSAGE: "Connect to an environment",
  useClientSettings: (selector?: (settings: typeof DEFAULT_CLIENT_SETTINGS) => unknown) =>
    selector ? selector(DEFAULT_CLIENT_SETTINGS) : DEFAULT_CLIENT_SETTINGS,
  useClientSettingsHydrated: () => true,
  usePrimarySettingsAvailable: () => true,
  usePrimarySettings: () => DEFAULT_UNIFIED_SETTINGS,
  useUpdatePrimarySettings: () => vi.fn(),
}));
vi.mock("./settingsLayout", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./settingsLayout")>()),
  SettingsPageContainer: ({ children }: { children: ReactNode }) => children,
}));
// The scoped agent-access rows need the settings layout's scope provider;
// this test covers the device-local browser sections only.
vi.mock("./ProjectDefaultsSettings", () => ({ ProjectDefaultsSettings: () => null }));
vi.mock("./SettingsScopeContext", () => ({
  useSettingsScope: () => ({
    scope: { kind: "all", environmentIds: [] },
    search: {},
    environment: null,
    environments: [],
    target: null,
    connectedEnvironments: [],
    targets: [],
  }),
  useOptionalSettingsScope: () => null,
}));

import { IntegrationsSettingsPanel } from "./IntegrationsSettings";
import { platformSetupStatus } from "../device/DeviceSetup";

let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  listBrowserImportSources.mockClear();
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});

async function openSettings() {
  const router = createRouter({
    routeTree: createRootRoute({ component: IntegrationsSettingsPanel }),
    history: createMemoryHistory(),
  });
  await router.load();
  await act(() => {
    renderer = create(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>,
    );
  });
  expect(renderer!.root.findByType(IntegrationsSettingsPanel)).toBeDefined();
}

describe("Integrations browser discovery", () => {
  it("does not scan browser files when entering or revisiting settings", async () => {
    await openSettings();
    expect(listBrowserImportSources).not.toHaveBeenCalled();

    await act(() => renderer?.unmount());
    await openSettings();
    expect(listBrowserImportSources).not.toHaveBeenCalled();
  });

  it("places device settings directly after browser settings", async () => {
    await openSettings();
    const sections = renderer!.root
      .findAll((node) => node.type === "section")
      .map((node) => node.props.id)
      .filter(Boolean);
    expect(sections.indexOf("devices")).toBeGreaterThan(sections.indexOf("browser"));
  });
});

const deviceState = (overrides: Partial<DeviceServiceState> = {}): DeviceServiceState => ({
  hosts: [
    {
      id: "local",
      kind: "local",
      label: "This machine",
      hubInstalled: false,
      agentDeviceInstalled: false,
      platforms: [
        { platform: "ios", available: true },
        { platform: "android", available: true },
      ],
    },
  ],
  hostStatus: "ready",
  hostStatuses: {},
  devices: [],
  sessions: [],
  onboardingCompleted: false,
  agentAccessEnabled: false,
  hubBasePath: "/api/device-hub",
  revision: 0,
  ...overrides,
});

describe("device setup guidance", () => {
  it("directs users to install an iOS runtime or connect an Android device", () => {
    expect(platformSetupStatus(deviceState(), "ios").message).toContain("Xcode Settings");
    const android = platformSetupStatus(deviceState(), "android").message;
    expect(android).toContain("USB debugging");
    expect(android).toContain("Device Manager");
  });

  it("treats a connected Android device as ready without an emulator", () => {
    const state = deviceState({
      devices: [
        {
          hostId: "local",
          id: "R58N123ABC",
          platform: "android",
          name: "Pixel 7",
          version: "Android",
          booted: true,
          physical: true,
        },
      ],
    });
    expect(platformSetupStatus(state, "android")).toEqual({
      ready: true,
      message: "Android devices are available.",
    });
  });

  it("preserves a specific missing-tool explanation from the server", () => {
    const state = deviceState({
      hosts: [
        {
          ...deviceState().hosts[0]!,
          platforms: [
            { platform: "ios", available: true },
            { platform: "android", available: false, reason: "Android Emulator is missing." },
          ],
        },
      ],
    });
    expect(platformSetupStatus(state, "android").message).toBe("Android Emulator is missing.");
  });
});
