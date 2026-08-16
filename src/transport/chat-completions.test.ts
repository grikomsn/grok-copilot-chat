import assert from "node:assert/strict";
import test from "node:test";
import { ChatCompletionStreamParser, validateStreamCompletion } from "./chat-completions";

test("parses fragmented text, reasoning, usage, and tool calls", () => {
  const parser = new ChatCompletionStreamParser();
  const events = [
    ...parser.push('data: {"choices":[{"delta":{"content":"hel","reasoning_content":"think"}}]}\n'),
    ...parser.push('\ndata: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"read_","arguments":"{\\"p\\":"}}]}}]}\n\n'),
    ...parser.push('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"file","arguments":"\\"x\\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":10,"completion_tokens":2}}\n\n'),
    ...parser.push("data: [DONE]\n\n"),
    ...parser.finish(),
  ];
  assert.equal(events[0].text, "hel");
  assert.equal(events[0].reasoning, "think");
  assert.equal(events[1].toolCalls?.[0].name, "read_file");
  assert.deepEqual(JSON.parse(events[1].toolCalls?.[0].arguments ?? ""), { p: "x" });
  assert.equal(events[1].usage?.prompt_tokens, 10);
  assert.equal(events[1].finishReason, "tool_calls");
  assert.equal(events[2].done, true);
  assert.equal(parser.finishReason, "tool_calls");
});

test("rejects a stream that closes without a terminal finish reason", () => {
  const parser = new ChatCompletionStreamParser();
  parser.push('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n');
  parser.push("data: [DONE]\n\n");
  assert.throws(
    () => validateStreamCompletion(parser.finishReason),
    /ended before a completion reason/,
  );
});

test("distinguishes successful and incomplete terminal reasons", () => {
  assert.doesNotThrow(() => validateStreamCompletion("stop"));
  assert.doesNotThrow(() => validateStreamCompletion("tool_calls"));
  assert.throws(() => validateStreamCompletion("length"), /output token limit/);
  assert.throws(() => validateStreamCompletion("content_filter"), /content filter/);
});
