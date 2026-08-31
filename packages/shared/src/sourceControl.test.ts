import { describe, expect, it } from "vite-plus/test";

import {
  changeRequestHasInAppReview,
  detectSourceControlProviderFromRemoteUrl,
  getChangeRequestTerminologyForKind,
  isForgejoOrGiteaPullRequestPath,
  isForgejoOrGiteaPullRequestUrl,
  isSshRemoteUrl,
  resolveChangeRequestPresentation,
} from "./sourceControl.ts";

describe("source control presentation", () => {
  it("uses merge request terminology for GitLab", () => {
    expect(getChangeRequestTerminologyForKind("gitlab")).toEqual({
      shortLabel: "MR",
      singular: "merge request",
    });
  });

  it("uses pull request terminology for GitHub-compatible providers", () => {
    expect(getChangeRequestTerminologyForKind("github")).toEqual({
      shortLabel: "PR",
      singular: "pull request",
    });
    expect(getChangeRequestTerminologyForKind("azure-devops")).toEqual({
      shortLabel: "PR",
      singular: "pull request",
    });
    expect(getChangeRequestTerminologyForKind("bitbucket")).toEqual({
      shortLabel: "PR",
      singular: "pull request",
    });
    expect(getChangeRequestTerminologyForKind("forgejo")).toEqual({
      shortLabel: "PR",
      singular: "pull request",
    });
    expect(getChangeRequestTerminologyForKind("gitea")).toEqual({
      shortLabel: "PR",
      singular: "pull request",
    });
  });

  it("falls back to generic change request copy for unknown providers", () => {
    expect(
      resolveChangeRequestPresentation({ kind: "unknown", name: "forge", baseUrl: "" }),
    ).toEqual(
      expect.objectContaining({
        shortName: "change request",
        longName: "change request",
      }),
    );
  });
});

describe("detectSourceControlProviderFromRemoteUrl", () => {
  it("detects common source control hosts", () => {
    expect(detectSourceControlProviderFromRemoteUrl("git@github.com:owner/repo.git")?.kind).toBe(
      "github",
    );
    expect(
      detectSourceControlProviderFromRemoteUrl("https://gitlab.com/group/repo.git")?.kind,
    ).toBe("gitlab");
    expect(
      detectSourceControlProviderFromRemoteUrl("https://dev.azure.com/org/project/_git/repo")?.kind,
    ).toBe("azure-devops");
    expect(
      detectSourceControlProviderFromRemoteUrl("git@bitbucket.org:workspace/repo.git")?.kind,
    ).toBe("bitbucket");
  });

  it("detects Azure DevOps SSH remotes", () => {
    // The default Azure DevOps SSH clone URL uses the ssh.dev.azure.com host.
    expect(
      detectSourceControlProviderFromRemoteUrl("git@ssh.dev.azure.com:v3/org/project/repo")?.kind,
    ).toBe("azure-devops");
    expect(
      detectSourceControlProviderFromRemoteUrl("ssh://git@ssh.dev.azure.com:22/v3/org/project/repo")
        ?.kind,
    ).toBe("azure-devops");
    // Legacy visualstudio.com SSH host stays classified too.
    expect(
      detectSourceControlProviderFromRemoteUrl("git@vs-ssh.visualstudio.com:v3/org/project/repo")
        ?.kind,
    ).toBe("azure-devops");
  });

  it("preserves ports while classifying by hostname", () => {
    expect(
      detectSourceControlProviderFromRemoteUrl("https://gitlab.com:8443/group/repo.git"),
    ).toEqual({
      kind: "gitlab",
      name: "GitLab",
      baseUrl: "https://gitlab.com:8443",
    });
    expect(
      detectSourceControlProviderFromRemoteUrl(
        "https://self-hosted.example.test:8443/group/repo.git",
      ),
    ).toEqual({
      kind: "unknown",
      name: "self-hosted.example.test:8443",
      baseUrl: "https://self-hosted.example.test:8443",
    });
  });

  it("matches self-hosted providers by complete DNS labels", () => {
    expect(
      detectSourceControlProviderFromRemoteUrl("https://github.example.com/owner/repo.git")?.kind,
    ).toBe("github");
    expect(
      detectSourceControlProviderFromRemoteUrl("https://gitlab.example.com/group/repo.git")?.kind,
    ).toBe("gitlab");
    expect(
      detectSourceControlProviderFromRemoteUrl("https://bitbucket.example.com/workspace/repo.git")
        ?.kind,
    ).toBe("bitbucket");
  });

  it("does not match provider names embedded in unrelated DNS labels", () => {
    expect(
      detectSourceControlProviderFromRemoteUrl("https://notgithub.example.com/owner/repo.git")
        ?.kind,
    ).toBe("unknown");
    expect(
      detectSourceControlProviderFromRemoteUrl("https://notgitlab.example.com/group/repo.git")
        ?.kind,
    ).toBe("unknown");
    expect(
      detectSourceControlProviderFromRemoteUrl(
        "https://notbitbucket.example.com/workspace/repo.git",
      )?.kind,
    ).toBe("unknown");
  });

  it("detects SSH remotes with non-git SSH users (e.g. gitlab@, deploy@)", () => {
    expect(
      detectSourceControlProviderFromRemoteUrl("gitlab@gitlab.example.com:group/project.git")?.kind,
    ).toBe("gitlab");
    expect(
      detectSourceControlProviderFromRemoteUrl("gitlab@gitlab.example.com:group/project.git")
        ?.baseUrl,
    ).toBe("https://gitlab.example.com");
    expect(detectSourceControlProviderFromRemoteUrl("deploy@github.com:owner/repo.git")?.kind).toBe(
      "github",
    );
    expect(
      detectSourceControlProviderFromRemoteUrl("git@bitbucket.org:workspace/repo.git")?.kind,
    ).toBe("bitbucket");
  });
});

describe("isSshRemoteUrl", () => {
  it("recognises SCP-like SSH URLs with any SSH user prefix", () => {
    expect(isSshRemoteUrl("git@github.com:owner/repo.git")).toBe(true);
    expect(isSshRemoteUrl("gitlab@gitlab.example.com:group/project.git")).toBe(true);
    expect(isSshRemoteUrl("deploy@bitbucket.org:workspace/repo.git")).toBe(true);
  });

  it("recognises ssh:// URLs with any case", () => {
    expect(isSshRemoteUrl("ssh://git@gitlab.example.com/group/project.git")).toBe(true);
    expect(isSshRemoteUrl("ssh://git@gitlab.example.com:22/group/project.git")).toBe(true);
    expect(isSshRemoteUrl("SSH://git@gitlab.example.com/group/project.git")).toBe(true);
    expect(isSshRemoteUrl("SsH://git@gitlab.example.com/group/project.git")).toBe(true);
  });

  it("returns false for HTTPS, local paths, and SCP-like paths without a colon", () => {
    expect(isSshRemoteUrl("https://gitlab.example.com/group/project.git")).toBe(false);
    expect(isSshRemoteUrl("/home/user/repos/project")).toBe(false);
    expect(isSshRemoteUrl("")).toBe(false);
    expect(isSshRemoteUrl("deploy@github.com/project/repo")).toBe(false);
  });
});

describe("forgejo and gitea support", () => {
  it("resolves Forgejo presentation", () => {
    const presentation = resolveChangeRequestPresentation({
      kind: "forgejo",
      name: "Forgejo",
      baseUrl: "https://codeberg.org",
    });
    expect(presentation.icon).toBe("forgejo");
    expect(presentation.providerName).toBe("Forgejo");
    expect(presentation.shortName).toBe("PR");
  });

  it("resolves Gitea presentation", () => {
    const presentation = resolveChangeRequestPresentation({
      kind: "gitea",
      name: "Gitea",
      baseUrl: "https://gitea.com",
    });
    expect(presentation.icon).toBe("gitea");
    expect(presentation.providerName).toBe("Gitea");
    expect(presentation.shortName).toBe("PR");
  });

  it("detects Codeberg, Gitea, and Forgejo hosts", () => {
    expect(detectSourceControlProviderFromRemoteUrl("git@codeberg.org:owner/repo.git")).toEqual({
      kind: "forgejo",
      name: "Codeberg",
      baseUrl: "https://codeberg.org",
    });
    expect(detectSourceControlProviderFromRemoteUrl("https://gitea.com/owner/repo.git")).toEqual({
      kind: "gitea",
      name: "Gitea",
      baseUrl: "https://gitea.com",
    });
    expect(
      detectSourceControlProviderFromRemoteUrl("https://forgejo.example.org/owner/repo.git")?.kind,
    ).toBe("forgejo");
    expect(
      detectSourceControlProviderFromRemoteUrl("https://gitea.example.org/owner/repo.git")?.kind,
    ).toBe("gitea");
  });

  it("leaves an arbitrary self-hosted host as unknown (refined later via fj)", () => {
    expect(
      detectSourceControlProviderFromRemoteUrl("https://git.example.org/owner/repo.git")?.kind,
    ).toBe("unknown");
  });

  it("does not match forgejo or gitea names embedded in unrelated DNS labels", () => {
    expect(
      detectSourceControlProviderFromRemoteUrl("https://notforgejo.example.com/owner/repo.git")
        ?.kind,
    ).toBe("unknown");
    expect(
      detectSourceControlProviderFromRemoteUrl("https://notgitea.example.com/owner/repo.git")?.kind,
    ).toBe("unknown");
  });
});

describe("changeRequestHasInAppReview", () => {
  it("keeps the in-app review panel for hosts that implement it", () => {
    expect(changeRequestHasInAppReview("github")).toBe(true);
    expect(changeRequestHasInAppReview("gitlab")).toBe(true);
    expect(changeRequestHasInAppReview("azure-devops")).toBe(true);
    expect(changeRequestHasInAppReview("bitbucket")).toBe(true);
    expect(changeRequestHasInAppReview(undefined)).toBe(true);
    expect(changeRequestHasInAppReview(null)).toBe(true);
  });

  it("sends Forgejo, Gitea, and unknown providers to the host instead", () => {
    expect(changeRequestHasInAppReview("forgejo")).toBe(false);
    expect(changeRequestHasInAppReview("gitea")).toBe(false);
    expect(changeRequestHasInAppReview("unknown")).toBe(false);
  });
});

describe("isForgejoOrGiteaPullRequestPath", () => {
  it("recognises owner/repo/pulls/{n} including trailing segments", () => {
    expect(isForgejoOrGiteaPullRequestPath("/owner/repo/pulls/8")).toBe(true);
    expect(isForgejoOrGiteaPullRequestPath("/owner/repo/pulls/8/files")).toBe(true);
    expect(isForgejoOrGiteaPullRequestPath("/owner/repo/pulls/8/")).toBe(true);
  });

  it("does not claim GitHub, GitLab, or list pages", () => {
    expect(isForgejoOrGiteaPullRequestPath("/owner/repo/pull/8")).toBe(false);
    expect(isForgejoOrGiteaPullRequestPath("/owner/repo/pulls")).toBe(false);
    expect(isForgejoOrGiteaPullRequestPath("/group/project/-/merge_requests/8")).toBe(false);
    expect(isForgejoOrGiteaPullRequestPath("/workspace/repo/pull-requests/8")).toBe(false);
  });
});

describe("isForgejoOrGiteaPullRequestUrl", () => {
  it("accepts http(s) Forgejo and Gitea pull request URLs", () => {
    expect(isForgejoOrGiteaPullRequestUrl("https://codeberg.org/owner/repo/pulls/8")).toBe(true);
    expect(isForgejoOrGiteaPullRequestUrl("http://git.example.org/owner/repo/pulls/8/files")).toBe(
      true,
    );
  });

  it("rejects GitHub pull URLs, non-web schemes, and malformed strings", () => {
    expect(isForgejoOrGiteaPullRequestUrl("https://github.com/owner/repo/pull/8")).toBe(false);
    expect(isForgejoOrGiteaPullRequestUrl("mailto:owner@example.com")).toBe(false);
    expect(isForgejoOrGiteaPullRequestUrl("not a url")).toBe(false);
  });
});
