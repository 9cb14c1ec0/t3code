/**
 * Converts assistant-message markdown into text suitable for a TTS engine.
 * Formatting markers are dropped rather than read aloud; code blocks collapse
 * into a short spoken placeholder because dictating source line-by-line is
 * useless at listening speed.
 */
export function markdownToSpeechText(markdown: string): string {
  let text = markdown;

  // Fenced code blocks first so their contents never hit the inline rules.
  text = text.replace(/```[\s\S]*?(?:```|$)/g, " Code block. ");

  // Review-comment context and any other embedded tags are visual affordances.
  text = text.replace(/<\/?[a-zA-Z][^>]*>/g, " ");

  // Images speak their alt text; links speak their label.
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

  // Table separator rows are pure decoration; pipes become pauses.
  text = text
    .split("\n")
    .filter((line) => !/^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line))
    .map((line) => line.replace(/\s*\|\s*/g, ", ").replace(/^,\s*|,\s*$/g, ""))
    .join("\n");

  // Headings, blockquotes, list markers.
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  text = text.replace(/^\s{0,3}>\s?/gm, "");
  text = text.replace(/^\s*[-*+]\s+/gm, "");
  text = text.replace(/^\s*\d+\.\s+/gm, "");

  // Inline emphasis, strikethrough, inline code keep their contents.
  text = text.replace(/(\*\*|__)(.*?)\1/g, "$2");
  text = text.replace(/(\*|_)(.*?)\1/g, "$2");
  text = text.replace(/~~(.*?)~~/g, "$1");
  text = text.replace(/`([^`]*)`/g, "$1");

  // Horizontal rules say nothing.
  text = text.replace(/^\s*([-*_]\s*){3,}$/gm, "");

  return text
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}
