import * as Speech from "expo-speech";
import { memo, useEffect, useRef, useState } from "react";
import { Pressable, type ColorValue } from "react-native";

import { markdownToSpeechText } from "../lib/speechText";
import { SymbolView } from "./AppSymbol";

// Only one utterance plays at a time; starting a new one stops the previous
// button. Module state (not context) because buttons live inside a virtualized
// feed and must not depend on a shared provider re-rendering the list.
let activeStop: (() => void) | null = null;

export const SpeakTextButton = memo(function SpeakTextButton(props: {
  readonly text: string;
  readonly tintColor: ColorValue;
  readonly iconSize?: number;
  readonly buttonSize?: number;
}) {
  const [speaking, setSpeaking] = useState(false);
  const speakingRef = useRef(false);

  const stop = () => {
    if (speakingRef.current) {
      speakingRef.current = false;
      activeStop = null;
      setSpeaking(false);
      void Speech.stop();
    }
  };
  const stopRef = useRef(stop);
  stopRef.current = stop;

  // Unmount while speaking (navigation away, feed recycling) must not leave
  // the engine talking with no visible way to stop it.
  useEffect(() => () => stopRef.current(), []);

  const onPress = () => {
    if (speakingRef.current) {
      stop();
      return;
    }
    activeStop?.();
    const settle = () => {
      if (speakingRef.current) {
        speakingRef.current = false;
        activeStop = null;
        setSpeaking(false);
      }
    };
    speakingRef.current = true;
    activeStop = () => stopRef.current();
    setSpeaking(true);
    Speech.speak(markdownToSpeechText(props.text), {
      onDone: settle,
      onStopped: settle,
      onError: settle,
    });
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={speaking ? "Stop reading" : "Read aloud"}
      disabled={props.text.trim().length === 0}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => ({
        width: props.buttonSize ?? 30,
        height: props.buttonSize ?? 30,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 9,
        opacity: pressed ? 0.52 : 1,
      })}
    >
      <SymbolView
        name={speaking ? "stop.fill" : "speaker.wave.2"}
        size={props.iconSize ?? 13}
        tintColor={props.tintColor}
        type="monochrome"
      />
    </Pressable>
  );
});
