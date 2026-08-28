import * as NodeOS from "node:os";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { parse as parseYamlDocument } from "yaml";
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";

export interface TeaCredential {
  readonly host: string;
  readonly type: string;
  readonly name: string;
  readonly token: string;
}

export interface TeaLoginStoreShape {
  readonly listHosts: Effect.Effect<ReadonlyArray<string>>;
  readonly getCredential: (host: string) => Effect.Effect<TeaCredential | null>;
  readonly authHeader: (credential: TeaCredential) => readonly [string, string];
}

export class TeaLoginStore extends Context.Service<TeaLoginStore, TeaLoginStoreShape>()(
  "t3/sourceControl/TeaLoginStore",
) {}

export const defaultConfigPaths = Effect.fn("defaultTeaConfigPaths")(function* () {
  const { join } = yield* Path.Path;
  const platform = yield* HostProcessPlatform;
  const env = yield* HostProcessEnvironment;
  const home = NodeOS.homedir();
  const paths: Array<string> = [];
  if (platform === "darwin") {
    paths.push(join(home, "Library", "Application Support", "tea", "config.yml"));
  } else if (platform === "win32") {
    const base = env["APPDATA"] ?? join(home, "AppData", "Roaming");
    paths.push(join(base, "tea", "config.yml"));
  } else {
    const configHome = env["XDG_CONFIG_HOME"] ?? join(home, ".config");
    paths.push(join(configHome, "tea", "config.yml"));
  }
  paths.push(join(home, ".tea", "tea.yml"));
  return paths;
});

function hostFromLoginUrl(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed.length === 0) return null;
  try {
    return new URL(trimmed).host.toLowerCase();
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseTeaConfig(content: string): Map<string, TeaCredential> {
  const store = new Map<string, TeaCredential>();
  let parsed: unknown;
  try {
    parsed = parseYamlDocument(content);
  } catch {
    return store;
  }
  const logins = isRecord(parsed) ? parsed.logins : undefined;
  if (!Array.isArray(logins)) return store;
  for (const rawLogin of logins) {
    if (!isRecord(rawLogin)) continue;
    const token = typeof rawLogin.token === "string" ? rawLogin.token.trim() : "";
    if (token.length === 0) continue;
    const url = typeof rawLogin.url === "string" ? rawLogin.url : "";
    const host = hostFromLoginUrl(url);
    if (host === null) continue;
    const user = typeof rawLogin.user === "string" ? rawLogin.user : "";
    const loginName = typeof rawLogin.name === "string" ? rawLogin.name : "";
    const authMethod = typeof rawLogin.auth_method === "string" ? rawLogin.auth_method : "";
    if (!store.has(host)) {
      store.set(host, {
        host,
        token,
        type: authMethod,
        name: user || loginName,
      });
    }
  }
  return store;
}

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const overridePath = yield* Config.string("T3CODE_TEA_CONFIG_PATH").pipe(Config.option);
  const configPaths = Option.isSome(overridePath)
    ? [overridePath.value]
    : yield* defaultConfigPaths();

  const readStore = Effect.gen(function* () {
    for (const configPath of configPaths) {
      const contents = yield* fileSystem.readFileString(configPath).pipe(Effect.option);
      if (Option.isSome(contents)) {
        return parseTeaConfig(contents.value);
      }
    }
    return new Map<string, TeaCredential>();
  });

  return TeaLoginStore.of({
    listHosts: readStore.pipe(Effect.map((store) => Array.from(store.keys()))),
    getCredential: (host) =>
      readStore.pipe(
        Effect.map((store) => {
          const wanted = host.trim().toLowerCase();
          return store.get(wanted) ?? store.get(wanted.replace(/:\d+$/u, "")) ?? null;
        }),
      ),
    authHeader: (credential) =>
      /oauth/iu.test(credential.type)
        ? (["Authorization", `Bearer ${credential.token}`] as const)
        : (["Authorization", `token ${credential.token}`] as const),
  });
});

export const layer = Layer.effect(TeaLoginStore, make);
