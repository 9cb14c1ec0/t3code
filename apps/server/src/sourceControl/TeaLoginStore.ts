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
  readonly url: string;
  readonly sshHost: string;
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

export function stripHostPort(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/u, "");
}

export function teaHostsMatch(a: string, b: string): boolean {
  const an = a.trim().toLowerCase();
  const bn = b.trim().toLowerCase();
  return an === bn || stripHostPort(an) === stripHostPort(bn);
}

function hostFromLoginUrl(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed.length === 0) return null;
  for (const candidate of [trimmed, `https://${trimmed}`]) {
    try {
      const host = new URL(candidate).host.toLowerCase();
      if (host.length > 0) return host;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

export function teaAuthHeader(credential: TeaCredential): readonly [string, string] {
  return /oauth/iu.test(credential.type) || credential.token.startsWith("eyJ")
    ? (["Authorization", `Bearer ${credential.token}`] as const)
    : (["Authorization", `token ${credential.token}`] as const);
}

export function parseGitCredentialHelperPassword(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith("password=")) {
      const password = line.slice("password=".length);
      return password.length > 0 ? password : null;
    }
  }
  return null;
}

export function findTeaCredential(
  store: Map<string, TeaCredential>,
  host: string,
): TeaCredential | null {
  const wanted = host.trim().toLowerCase();
  if (wanted.length === 0) return null;
  const direct = store.get(wanted) ?? store.get(stripHostPort(wanted));
  if (direct) return direct;
  const seen = new Set<TeaCredential>();
  for (const credential of store.values()) {
    if (seen.has(credential)) continue;
    seen.add(credential);
    if (teaHostsMatch(credential.host, wanted)) return credential;
    if (credential.sshHost.length > 0 && teaHostsMatch(credential.sshHost, wanted)) {
      return credential;
    }
  }
  return null;
}

function indexCredential(store: Map<string, TeaCredential>, credential: TeaCredential): void {
  const keys = [credential.host, stripHostPort(credential.host)];
  if (credential.sshHost.length > 0) {
    keys.push(credential.sshHost, stripHostPort(credential.sshHost));
  }
  for (const key of keys) {
    if (key.length > 0 && !store.has(key)) {
      store.set(key, credential);
    }
  }
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
    const url = stringField(rawLogin, "url", "URL", "Url");
    const host = hostFromLoginUrl(url);
    if (host === null) continue;
    const token = stringField(rawLogin, "token", "Token");
    const user = stringField(rawLogin, "user", "User");
    const loginName = stringField(rawLogin, "name", "Name");
    const authMethod = stringField(rawLogin, "auth_method", "AuthMethod");
    const sshHost = stringField(rawLogin, "ssh_host", "SSHHost", "sshHost").toLowerCase();
    indexCredential(store, {
      host,
      token,
      type: authMethod,
      name: user || loginName,
      url,
      sshHost,
    });
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
    listHosts: readStore.pipe(
      Effect.map((store) => [...new Set(Array.from(store.values()).map((entry) => entry.host))]),
    ),
    getCredential: (host) => readStore.pipe(Effect.map((store) => findTeaCredential(store, host))),
    authHeader: teaAuthHeader,
  });
});

export const layer = Layer.effect(TeaLoginStore, make);
