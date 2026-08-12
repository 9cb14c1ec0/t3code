import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import * as Speech from "expo-speech";
import { useEffect, useRef } from "react";
import type { TurnId } from "@t3tools/contracts";

import { markdownToSpeechText } from "../../lib/speechText";
import type { ThreadFeedEntry } from "../../lib/threadActivity";
import { mobilePreferencesAtom } from "../../state/preferences";

/**
 * Speaks agent replies as they complete while the thread is open
 * (Settings → General → Read Replies Aloud). Only messages that finish after
 * mount are spoken: opening a thread must not narrate its history, and
 * enabling the preference must not dump the backlog.
 */
export function useAutoReadAgentReplies(input: {
  readonly feed: ReadonlyArray<ThreadFeedEntry>;
  readonly terminalAssistantMessageIds: ReadonlySet<string>;
  readonly unsettledTurnId: TurnId | null;
}) {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const enabled = AsyncResult.isSuccess(preferencesResult)
    ? (preferencesResult.value.autoReadAgentRepliesEnabled ?? false)
    : false;

  const handledIdsRef = useRef<Set<string> | null>(null);
  const spokeRef = useRef(false);

  useEffect(() => {
    const ready: Array<{ readonly id: string; readonly text: string }> = [];
    for (const entry of input.feed) {
      if (entry.type !== "message") continue;
      const { message } = entry;
      if (
        message.role !== "assistant" ||
        message.streaming ||
        !input.terminalAssistantMessageIds.has(message.id) ||
        (input.unsettledTurnId !== null && message.turnId === input.unsettledTurnId) ||
        message.text.trim().length === 0
      ) {
        continue;
      }
      ready.push({ id: message.id, text: message.text });
    }

    if (handledIdsRef.current === null) {
      handledIdsRef.current = new Set(ready.map((message) => message.id));
      return;
    }

    const handled = handledIdsRef.current;
    for (const message of ready) {
      if (handled.has(message.id)) continue;
      handled.add(message.id);
      if (enabled) {
        spokeRef.current = true;
        // Multiple completions queue in the platform engine in feed order.
        Speech.speak(markdownToSpeechText(message.text));
      }
    }
  }, [enabled, input.feed, input.terminalAssistantMessageIds, input.unsettledTurnId]);

  // Leaving the thread must not leave the narration running.
  useEffect(
    () => () => {
      if (spokeRef.current) {
        void Speech.stop();
      }
    },
    [],
  );
}
