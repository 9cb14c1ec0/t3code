import { assert, it, vi } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ConfigProvider from "effect/ConfigProvider";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { ChildProcessSpawner } from "effect/unstable/process";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";

import * as GiteaApi from "./GiteaApi.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import type * as VcsDriver from "../vcs/VcsDriver.ts";

const pullRequest = {
  number: 42,
  title: "Add Gitea provider",
  state: "open",
  merged: false,
  html_url: "https://git.example.org/owner/repo/pulls/42",
  updated_at: "2026-01-02T00:00:00.000Z",
  base: {
    ref: "main",
    repo: { full_name: "owner/repo" },
  },
  head: {
    ref: "feature/gitea",
    repo: { full_name: "owner/repo" },
  },
};

function authorizationHeader(request: HttpClientRequest.HttpClientRequest): string | undefined {
  const headers = request.headers as { readonly authorization?: string };
  return headers.authorization;
}

function makeLayer(input: {
  readonly teaConfig: string;
  readonly helperStdout?: string;
  readonly helperExitCode?: number;
}) {
  const execute = vi.fn((request: HttpClientRequest.HttpClientRequest) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(pullRequest))),
  );
  const helper = vi.fn(() =>
    Effect.succeed({
      exitCode: ChildProcessSpawner.ExitCode(input.helperExitCode ?? 0),
      stdout: input.helperStdout ?? "",
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
    } satisfies VcsProcess.VcsProcessOutput),
  );
  const driver = {
    listRemotes: () =>
      Effect.succeed({
        remotes: [
          {
            name: "origin",
            url: "git@git.example.org:owner/repo.git",
            pushUrl: Option.none(),
            isPrimary: true,
          },
        ],
        freshness: {
          source: "live-local" as const,
          observedAt: DateTime.makeUnsafe("1970-01-01T00:00:00.000Z"),
          expiresAt: Option.none(),
        },
      }),
  } satisfies Partial<VcsDriver.VcsDriver["Service"]>;

  const layerEffect = Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const configPath = yield* fileSystem.makeTempFileScoped({ prefix: "tea-config-" });
    yield* fileSystem.writeFileString(configPath, input.teaConfig);

    return GiteaApi.layer.pipe(
      Layer.provide(
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) => execute(request)),
        ),
      ),
      Layer.provide(
        Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({
          resolve: () =>
            Effect.succeed({
              kind: "git",
              repository: {
                kind: "git",
                rootPath: "/repo",
                metadataPath: null,
                freshness: {
                  source: "live-local" as const,
                  observedAt: DateTime.makeUnsafe("1970-01-01T00:00:00.000Z"),
                  expiresAt: Option.none(),
                },
              },
              driver: driver as unknown as VcsDriver.VcsDriver["Service"],
            }),
        }),
      ),
      Layer.provide(Layer.mock(GitVcsDriver.GitVcsDriver)({})),
      Layer.provide(Layer.mock(VcsProcess.VcsProcess)({ run: helper })),
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromEnv({ env: { T3CODE_TEA_CONFIG_PATH: configPath } }),
        ),
      ),
      Layer.provide(ServerSettingsService.layerTest()),
      Layer.provideMerge(NodeServices.layer),
    );
  });

  return { execute, helper, layerEffect };
}

it.effect("uses tea login helper get when the YAML login has no token", () =>
  Effect.gen(function* () {
    const { execute, helper, layerEffect } = makeLayer({
      teaConfig: `
logins:
  - name: git.example.org
    url: https://git.example.org
    user: bob
    auth_method: oauth
`,
      helperStdout:
        "protocol=https\nhost=git.example.org\nusername=bob\npassword=oauth-from-helper\n",
    });

    const layer = yield* layerEffect;
    yield* Effect.gen(function* () {
      const gitea = yield* GiteaApi.GiteaApi;
      yield* gitea.getPullRequest({ cwd: "/repo", reference: "#42" });
      assert.strictEqual(helper.mock.calls.length, 1);
      assert.strictEqual(
        authorizationHeader(execute.mock.calls[0]![0]),
        "Bearer oauth-from-helper",
      );
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect("does not send an unauthenticated Gitea request when no token can be resolved", () =>
  Effect.gen(function* () {
    const { execute, layerEffect } = makeLayer({
      teaConfig: `
logins:
  - name: git.example.org
    url: https://git.example.org
    user: bob
    auth_method: oauth
`,
      helperExitCode: 1,
      helperStdout: "",
    });

    const layer = yield* layerEffect;
    yield* Effect.gen(function* () {
      const gitea = yield* GiteaApi.GiteaApi;
      const error = yield* gitea
        .listPullRequests({
          cwd: "/repo",
          headSelector: "feature/gitea",
          state: "open",
        })
        .pipe(Effect.flip);
      assert.strictEqual(error._tag, "GiteaApiError");
      assert.match(error.detail, /No Gitea access token for git\.example\.org/);
      assert.strictEqual(execute.mock.calls.length, 0);
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);
