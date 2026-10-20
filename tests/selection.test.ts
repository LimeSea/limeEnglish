import { describe, expect, it } from "vitest";
import { sentenceCovering, surroundingContext } from "../src/content/selection";

describe("sentence segmentation", () => {
  it("returns the sentence covering a UTF-16 target and joins a common abbreviation", () => {
    const text = "Earlier sentence. Dr. Lee sat on the bank and watched the river flow. Final sentence.";
    const start = text.indexOf("bank");
    const bounds = sentenceCovering(text, start, start + "bank".length);
    expect(bounds).toBeDefined();
    expect(text.slice(bounds?.start, bounds?.end)).toBe("Dr. Lee sat on the bank and watched the river flow.");
    const sentence = text.slice(bounds?.start, bounds?.end);
    const spanStart = start - bounds!.start;
    expect(sentence.slice(spanStart, spanStart + 4)).toBe("bank");
  });

  it("keeps bounded text before and after the target sentence as separate context", () => {
    const before = "a".repeat(2_100);
    const sentence = "She sat on the bank.";
    const after = "b".repeat(2_100);
    const context = surroundingContext(`${before}${sentence}${after}`, before.length, before.length + sentence.length);
    expect(context.contextBefore).toBe("a".repeat(2_000));
    expect(context.contextAfter).toBe("b".repeat(2_000));
  });
});
