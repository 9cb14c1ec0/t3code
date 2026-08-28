import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";

import * as TeaLoginStore from "./TeaLoginStore.ts";

function layerWithConfigFile(contents: string) {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const configPath = yield* fileSystem.makeTempFileScoped({ prefix: "tea-config-" });
    yield* fileSystem.writeFileString(configPath, contents);
    return TeaLoginStore.layer.pipe(
      Layer.provide(
        ConfigProvider.layer(
          ConfigProvider.fromEnv({ env: { T3CODE_TEA_CONFIG_PATH: configPath } }),
        ),
      ),
      Layer.provideMerge(NodeServices.layer),
    );
  });
}

const sampleConfig = `
logins:
  - name: gitea.com
    url: https://gitea.com
    token: gitea-token
    user: alice
    default: true
  - name: git.example.org
    url: https://git.example.org
    token: self-hosted-token
    user: bob
    auth_method: oauth
`;

it.effect("lists hosts and returns credentials from tea config.yml", () =>
  Effect.gen(function* () {
    const layer = yield* layerWithConfigFile(sampleConfig);
    yield* Effect.gen(function* () {
      const store = yield* TeaLoginStore.TeaLoginStore;
      const hosts = yield* store.listHosts;
      assert.deepStrictEqual([...hosts].toSorted(), ["git.example.org", "gitea.com"]);

      const gitea = yield* store.getCredential("gitea.com");
      assert.ok(gitea);
      assert.deepStrictEqual(store.authHeader(gitea), ["Authorization", "token gitea-token"]);
      assert.strictEqual(gitea.name, "alice");

      const oauth = yield* store.getCredential("git.example.org");
      assert.ok(oauth);
      assert.deepStrictEqual(store.authHeader(oauth), [
        "Authorization",
        "Bearer self-hosted-token",
      ]);
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect("matches a bare-hostname credential when the lookup host carries a port", () =>
  Effect.gen(function* () {
    const layer = yield* layerWithConfigFile(sampleConfig);
    yield* Effect.gen(function* () {
      const store = yield* TeaLoginStore.TeaLoginStore;
      const credential = yield* store.getCredential("git.example.org:3000");
      assert.ok(credential);
      assert.strictEqual(credential.token, "self-hosted-token");
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);

it.effect("degrades to an empty store on malformed YAML", () =>
  Effect.gen(function* () {
    const layer = yield* layerWithConfigFile("logins: [");
    yield* Effect.gen(function* () {
      const store = yield* TeaLoginStore.TeaLoginStore;
      assert.deepStrictEqual(yield* store.listHosts, []);
    }).pipe(Effect.provide(layer));
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);
