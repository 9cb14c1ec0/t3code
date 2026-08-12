import { describe, expect, it } from "vite-plus/test";

import { markdownToSpeechText } from "./speechText";

describe("markdownToSpeechText", () => {
  it("strips inline formatting but keeps the words", () => {
    expect(markdownToSpeechText("This is **bold**, *italic*, ~~gone~~, and `inline code`.")).toBe(
      "This is bold, italic, gone, and inline code.",
    );
  });

  it("collapses fenced code blocks into a spoken placeholder", () => {
    expect(markdownToSpeechText("Before.\n```ts\nconst x = 1;\n```\nAfter.")).toBe(
      "Before.\nCode block.\nAfter.",
    );
  });

  it("collapses an unterminated fence to the end of the message", () => {
    expect(markdownToSpeechText("Look:\n```\nstreaming...")).toBe("Look:\nCode block.");
  });

  it("speaks link labels and image alt text, not URLs", () => {
    expect(
      markdownToSpeechText("See [the docs](https://example.com) and ![a chart](img.png)."),
    ).toBe("See the docs and a chart.");
  });

  it("drops heading, blockquote, and list markers", () => {
    expect(markdownToSpeechText("## Title\n> quote\n- item one\n1. item two")).toBe(
      "Title\nquote\nitem one\nitem two",
    );
  });

  it("reads table cells with pauses and skips separator rows", () => {
    expect(markdownToSpeechText("| a | b |\n| --- | --- |\n| 1 | 2 |")).toBe("a, b\n1, 2");
  });

  it("removes embedded tags such as review comment context", () => {
    expect(markdownToSpeechText('<review_comment path="a.ts">Fix this</review_comment>')).toBe(
      "Fix this",
    );
  });
});
