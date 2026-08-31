import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { SourceControlProviderError, type ChangeRequest } from "@t3tools/contracts";

import * as GiteaApi from "./GiteaApi.ts";
import * as ForgejoPullRequests from "./forgejoPullRequests.ts";
import * as SourceControlProvider from "./SourceControlProvider.ts";
import * as SourceControlProviderDiscovery from "./SourceControlProviderDiscovery.ts";

function providerError(input: {
  readonly operation: string;
  readonly cwd: string;
  readonly reference?: string;
  readonly repository?: string;
  readonly cause: GiteaApi.GiteaApiError;
}): SourceControlProviderError {
  return new SourceControlProviderError({
    provider: "gitea",
    operation: input.operation,
    cwd: input.cwd,
    ...(input.reference !== undefined
      ? { reference: SourceControlProvider.transportSafeSourceControlErrorValue(input.reference) }
      : {}),
    ...(input.repository !== undefined
      ? { repository: SourceControlProvider.transportSafeSourceControlErrorValue(input.repository) }
      : {}),
    detail: input.cause.detail,
    cause: input.cause,
  });
}

function toChangeRequest(
  summary: ForgejoPullRequests.NormalizedForgejoPullRequestRecord,
): ChangeRequest {
  return {
    provider: "gitea",
    number: summary.number,
    title: summary.title,
    url: summary.url,
    baseRefName: summary.baseRefName,
    headRefName: summary.headRefName,
    state: summary.state,
    updatedAt: summary.updatedAt ?? Option.none(),
    ...(summary.isCrossRepository !== undefined
      ? { isCrossRepository: summary.isCrossRepository }
      : {}),
    ...(summary.headRepositoryNameWithOwner !== undefined
      ? { headRepositoryNameWithOwner: summary.headRepositoryNameWithOwner }
      : {}),
    ...(summary.headRepositoryOwnerLogin !== undefined
      ? { headRepositoryOwnerLogin: summary.headRepositoryOwnerLogin }
      : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

function loginField(login: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = login[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

/** Parse `tea login list --output json` (array of login objects with url/user/name). */
export function parseTeaLoginHosts(
  output: string,
): ReadonlyArray<{ readonly account: string; readonly host: string }> {
  const trimmed = output.trim();
  if (trimmed.length === 0) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const logins = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.logins)
        ? parsed.logins
        : [];
    const entries: Array<{ account: string; host: string }> = [];
    for (const raw of logins) {
      if (!isRecord(raw)) continue;
      const url = loginField(raw, "url", "URL", "Url");
      const host = hostFromUrl(url);
      if (host === null) continue;
      const account = loginField(raw, "user", "User", "name", "Name") || host;
      entries.push({ account, host });
    }
    return entries;
  } catch {
    return [];
  }
}

function parseGiteaAuth(input: SourceControlProviderDiscovery.SourceControlAuthProbeInput) {
  const output = SourceControlProviderDiscovery.combinedAuthOutput(input);
  const hosts = parseTeaLoginHosts(output);
  const first = hosts[0];
  if (first) {
    return SourceControlProviderDiscovery.providerAuth({
      status: "authenticated",
      account: first.account,
      host: first.host,
    });
  }
  if (input.exitCode !== 0) {
    return SourceControlProviderDiscovery.providerAuth({
      status: "unauthenticated",
      detail:
        SourceControlProviderDiscovery.firstSafeAuthLine(output) ??
        "Run `tea login add` to authenticate the Gitea CLI.",
    });
  }
  return SourceControlProviderDiscovery.providerAuth({
    status: "unknown",
    detail:
      SourceControlProviderDiscovery.firstSafeAuthLine(output) ??
      "Gitea CLI auth status could not be parsed.",
  });
}

function refineUnknownGiteaRemote(
  input: SourceControlProviderDiscovery.SourceControlUnknownRemoteRefinementInput,
) {
  const host = input.context.provider.name.toLowerCase();
  const authenticated = parseTeaLoginHosts(
    SourceControlProviderDiscovery.combinedAuthOutput(input.auth),
  ).some((entry) => GiteaApi.forgejoHostsMatch(entry.host, host));
  if (!authenticated) return null;
  return {
    kind: "gitea",
    name: "Gitea",
    baseUrl: input.context.provider.baseUrl,
  } as const;
}

export const discovery = {
  type: "cli",
  kind: "gitea",
  label: "Gitea",
  executable: "tea",
  versionArgs: ["--version"],
  authArgs: ["login", "list", "--output", "json"],
  parseAuth: parseGiteaAuth,
  refineUnknownRemote: refineUnknownGiteaRemote,
  installHint:
    "Install the Gitea CLI (`tea`) from https://gitea.com/gitea/tea and run `tea login add`.",
} satisfies SourceControlProviderDiscovery.SourceControlCliDiscoverySpec;

export const make = Effect.gen(function* () {
  const gitea = yield* GiteaApi.GiteaApi;

  return SourceControlProvider.SourceControlProvider.of({
    kind: "gitea",
    listChangeRequests: (input) => {
      const source = SourceControlProvider.sourceControlRefFromInput(input);
      return gitea
        .listPullRequests({
          cwd: input.cwd,
          ...(input.context ? { context: input.context } : {}),
          headSelector: input.headSelector,
          ...(source ? { source } : {}),
          state: input.state,
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
        })
        .pipe(
          Effect.map((items) => items.map(toChangeRequest)),
          Effect.mapError((error) =>
            providerError({
              operation: "listChangeRequests",
              cwd: input.cwd,
              reference: input.headSelector,
              cause: error,
            }),
          ),
        );
    },
    getChangeRequest: (input) =>
      gitea.getPullRequest(input).pipe(
        Effect.map(toChangeRequest),
        Effect.mapError((error) =>
          providerError({
            operation: "getChangeRequest",
            cwd: input.cwd,
            reference: input.reference,
            cause: error,
          }),
        ),
      ),
    createChangeRequest: (input) => {
      const source = SourceControlProvider.sourceControlRefFromInput(input);
      return gitea
        .createPullRequest({
          cwd: input.cwd,
          ...(input.context ? { context: input.context } : {}),
          baseBranch: input.baseRefName,
          headSelector: input.headSelector,
          ...(source ? { source } : {}),
          ...(input.target ? { target: input.target } : {}),
          title: input.title,
          bodyFile: input.bodyFile,
        })
        .pipe(
          Effect.mapError((error) =>
            providerError({
              operation: "createChangeRequest",
              cwd: input.cwd,
              reference: input.headSelector,
              cause: error,
            }),
          ),
        );
    },
    getRepositoryCloneUrls: (input) =>
      gitea.getRepositoryCloneUrls(input).pipe(
        Effect.mapError((error) =>
          providerError({
            operation: "getRepositoryCloneUrls",
            cwd: input.cwd,
            repository: input.repository,
            cause: error,
          }),
        ),
      ),
    createRepository: (input) =>
      gitea.createRepository(input).pipe(
        Effect.mapError((error) =>
          providerError({
            operation: "createRepository",
            cwd: input.cwd,
            repository: input.repository,
            cause: error,
          }),
        ),
      ),
    getDefaultBranch: (input) =>
      gitea
        .getDefaultBranch({
          cwd: input.cwd,
          ...(input.context ? { context: input.context } : {}),
        })
        .pipe(
          Effect.mapError((error) =>
            providerError({ operation: "getDefaultBranch", cwd: input.cwd, cause: error }),
          ),
        ),
    checkoutChangeRequest: (input) =>
      gitea
        .checkoutPullRequest({
          cwd: input.cwd,
          ...(input.context ? { context: input.context } : {}),
          reference: input.reference,
          ...(input.force !== undefined ? { force: input.force } : {}),
        })
        .pipe(
          Effect.mapError((error) =>
            providerError({
              operation: "checkoutChangeRequest",
              cwd: input.cwd,
              reference: input.reference,
              cause: error,
            }),
          ),
        ),
  });
});

export const layer = Layer.effect(SourceControlProvider.SourceControlProvider, make);
