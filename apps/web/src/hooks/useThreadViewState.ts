import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useCallback, useMemo } from "react";

import { readEnvironmentSupportsViewState, readThreadShell } from "../state/entities";
import { threadEnvironment } from "../state/threads";
import { useUiStateStore } from "../uiStateStore";
import { useAtomCommand } from "../state/use-atom-command";

function timestampCovers(timestamp: string | undefined, target: string): boolean {
  if (timestamp === undefined) return false;
  const timestampMs = Date.parse(timestamp);
  const targetMs = Date.parse(target);
  return Number.isFinite(timestampMs) && Number.isFinite(targetMs) && timestampMs >= targetMs;
}

/** Keeps the local compatibility marker and the server view marker in sync. */
export function useThreadViewState() {
  const markLocalViewed = useUiStateStore((state) => state.markThreadVisited);
  const markLocalUnread = useUiStateStore((state) => state.markThreadUnread);
  const viewThread = useAtomCommand(threadEnvironment.view, { reportFailure: false });
  const markUnreadOnServer = useAtomCommand(threadEnvironment.markUnread, {
    reportFailure: false,
  });

  const markViewed = useCallback(
    (threadRef: ScopedThreadRef, viewedThrough: string) => {
      markLocalViewed(scopedThreadKey(threadRef), viewedThrough);
      if (!readEnvironmentSupportsViewState(threadRef.environmentId)) return;
      const thread = readThreadShell(threadRef);
      if (timestampCovers(thread?.viewedAt, viewedThrough)) return;
      void viewThread({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId },
      });
    },
    [markLocalViewed, viewThread],
  );

  const markUnread = useCallback(
    (threadRef: ScopedThreadRef, latestTurnCompletedAt: string | null | undefined) => {
      markLocalUnread(scopedThreadKey(threadRef), latestTurnCompletedAt);
      if (
        latestTurnCompletedAt == null ||
        !readEnvironmentSupportsViewState(threadRef.environmentId)
      ) {
        return;
      }
      void markUnreadOnServer({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId },
      });
    },
    [markLocalUnread, markUnreadOnServer],
  );

  return useMemo(() => ({ markViewed, markUnread }), [markUnread, markViewed]);
}
