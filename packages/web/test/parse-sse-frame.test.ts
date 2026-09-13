import { describe, expect, it } from "vitest";
import { parseSseFrame } from "../src/lib/sse/connect-stream";

describe("parseSseFrame", () => {
  it("returns null for empty or comment-only frames", () => {
    expect(parseSseFrame("")).toBeNull();
    expect(parseSseFrame(":ping")).toBeNull();
  });

  it("extracts the data payload", () => {
    const frame = "event: request.received\nid: 42\ndata: {\"seq\":1}";
    expect(parseSseFrame(frame)).toEqual({ data: '{"seq":1}' });
  });

  it("concatenates multi-line data fields with newlines", () => {
    const frame = "data: {\ndata: \"seq\":1,\ndata: \"a\":1}";
    const parsed = parseSseFrame(frame);
    expect(parsed).not.toBeNull();
    expect(parsed?.data).toContain('"seq":1');
    expect(parsed?.data).toContain('"a":1');
  });

  it("tolerates missing space after the colon", () => {
    const frame = "data:{\"seq\":7}";
    expect(parseSseFrame(frame)).toEqual({ data: '{"seq":7}' });
  });
});
