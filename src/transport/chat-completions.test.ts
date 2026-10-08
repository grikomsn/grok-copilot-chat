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

test("rejects incomplete tool arguments and normalizes complete empty arguments", () => {
  const incomplete = new ChatCompletionStreamParser();
  assert.throws(
    () => incomplete.push('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"lookup","arguments":"{"}}]},"finish_reason":"tool_calls"}]}\n\n'),
    /incomplete arguments for tool lookup/,
  );

  const empty = new ChatCompletionStreamParser();
  const events = empty.push('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"now","arguments":""}}]},"finish_reason":"tool_calls"}]}\n\n');
  assert.equal(events[0].toolCalls?.[0].arguments, "{}");
});

function chatFrame(delta: Record<string, unknown>, finishReason?: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta, ...(finishReason ? { finish_reason: finishReason } : {}) }] })}\r\n\r\n`;
}

test("retains aliases across indexed and ID-only parallel fragments", () => {
  const parser = new ChatCompletionStreamParser();
  const frames = [
    chatFrame({ tool_calls: [{ index: 0, id: "first", function: { name: "read", arguments: '{"path":' } }, { index: 1, id: "second", function: { name: "read", arguments: '{"path":' } }] }),
    chatFrame({ tool_calls: [{ id: "second", function: { arguments: '"two"}' } }, { id: "first", function: { arguments: '"one"}' } }] }),
    chatFrame({}, "tool_calls"),
  ];
  const calls = frames.flatMap((frame) => parser.push(frame)).flatMap((event) => event.toolCalls ?? []);
  assert.deepEqual(calls, [
    { id: "first", name: "read", arguments: '{"path":"one"}' },
    { id: "second", name: "read", arguments: '{"path":"two"}' },
  ]);
});

test("reassembles CRLF boundaries split at every transport position", () => {
  const frame = chatFrame({ content: "answer" }, "stop");
  for (let position = 1; position < frame.length; position++) {
    const parser = new ChatCompletionStreamParser();
    const events = [...parser.push(frame.slice(0, position)), ...parser.push(frame.slice(position)), ...parser.finish()];
    assert.equal(events.length, 1);
    assert.equal(events[0].text, "answer");
  }
});

test("ignores non-object SSE payloads without disrupting following frames", () => {
  const parser = new ChatCompletionStreamParser();
  assert.deepEqual(parser.push("data: null\n\ndata: []\n\ndata: 42\n\n"), []);
  assert.equal(parser.push(chatFrame({ content: "answer" }, "stop"))[0].text, "answer");
});
