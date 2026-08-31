import { assert, describe, it } from "@effect/vitest";
import { ChildProcessSpawner } from "effect/unstable/process";

import { discovery, parseTeaLoginHosts } from "./GiteaSourceControlProvider.ts";

const authOutput = JSON.stringify([
  { name: "gitea.com", url: "https://gitea.com", user: "alice" },
  { name: "git.example.org", url: "https://git.example.org", user: "bob" },
]);

describe("Gitea discovery", () => {
  it("parses `tea login list --output json` logins", () => {
    assert.deepStrictEqual(parseTeaLoginHosts(authOutput), [
      { account: "alice", host: "gitea.com" },
      { account: "bob", host: "git.example.org" },
    ]);
  });

  it("refines an unknown remote whose host is logged in", () => {
    const refined = discovery.refineUnknownRemote!({
      cwd: "/repo",
      context: {
        provider: { kind: "unknown", name: "git.example.org", baseUrl: "https://git.example.org" },
        remoteName: "origin",
        remoteUrl: "git@git.example.org:owner/repo.git",
      },
      auth: { stdout: authOutput, stderr: "", exitCode: ChildProcessSpawner.ExitCode(0) },
    });
    assert.deepStrictEqual(refined, {
      kind: "gitea",
      name: "Gitea",
      baseUrl: "https://git.example.org",
    });
  });

  it("does not refine a host that is not logged in", () => {
    const refined = discovery.refineUnknownRemote!({
      cwd: "/repo",
      context: {
        provider: { kind: "unknown", name: "git.other.org", baseUrl: "https://git.other.org" },
        remoteName: "origin",
        remoteUrl: "git@git.other.org:owner/repo.git",
      },
      auth: { stdout: authOutput, stderr: "", exitCode: ChildProcessSpawner.ExitCode(0) },
    });
    assert.strictEqual(refined, null);
  });

  it("reports authenticated status from tea login list", () => {
    const auth = discovery.parseAuth({
      stdout: authOutput,
      stderr: "",
      exitCode: ChildProcessSpawner.ExitCode(0),
    });
    assert.strictEqual(auth.status, "authenticated");
  });
});
