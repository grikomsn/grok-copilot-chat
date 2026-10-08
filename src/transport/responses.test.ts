import assert from "node:assert/strict";
import test from "node:test";
import {
  buildResponsesFunctionTool,
  buildResponsesRequest,
  ResponsesStreamParser,
} from "./responses";
import { createPromptCacheKey } from "../provider/prompt-cache";

test("builds a Responses request with native web search and client tools", () => {
  const body = buildResponsesRequest(
    "grok-4.6",
    [{ type: "message", role: "user", content: "Find the latest xAI release." }],
    [
      { type: "web_search" },
      buildResponsesFunctionTool({
        name: "save_note",
        description: "Save a note",
        inputSchema: { type: "object", properties: { text: { type: "string" } } },
      }),
    ],
    "high",
    4096,
  );

  assert.deepEqual(body, {
    model: "grok-4.6",
    input: [{ type: "message", role: "user", content: "Find the latest xAI release." }],
    prompt_cache_key: createPromptCacheKey({
      model: "grok-4.6",
      input: [{ type: "message", role: "user", content: "Find the latest xAI release." }],
      tools: [
        { type: "web_search" },
        {
          type: "function",
          name: "save_note",
          description: "Save a note",
          parameters: { type: "object", properties: { text: { type: "string" } } },
        },
      ],
    }),
    stream: true,
    store: false,
    max_output_tokens: 4096,
    tools: [
      { type: "web_search" },
      {
        type: "function",
        name: "save_note",
        description: "Save a note",
        parameters: { type: "object", properties: { text: { type: "string" } } },
      },
    ],
    tool_choice: "auto",
    parallel_tool_calls: true,
    reasoning: { effort: "high" },
  });
});

test("preserves a required tool mode for Responses requests", () => {
  const body = buildResponsesRequest(
    "grok-4.6",
    [{ type: "message", role: "user", content: "Search this." }],
    [{ type: "web_search" }],
    undefined,
    1024,
    "required",
  );

  assert.equal(body.tool_choice, "required");
});

test("parses fragmented Responses text and client function calls", () => {
  const parser = new ResponsesStreamParser();
  const events = [
    ...parser.push('event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"hel"}\n'),
    ...parser.push('\nevent: response.output_item.added\ndata: {"type":"response.output_item.added","item":{"type":"function_call","id":"item-1","call_id":"call-1","name":"read_file","arguments":""}}\n\n'),
    ...parser.push('event: response.function_call_arguments.delta\ndata: {"type":"response.function_call_arguments.delta","item_id":"item-1","delta":"{\\"path\\":\\"README"}\n\n'),
    ...parser.push('event: response.function_call_arguments.done\ndata: {"type":"response.function_call_arguments.done","item_id":"item-1","call_id":"call-1","name":"read_file","arguments":"{\\"path\\":\\"README.md\\"}"}\n\n'),
    ...parser.push('event: response.output_item.done\ndata: {"type":"response.output_item.done","item":{"type":"function_call","id":"item-1","call_id":"call-1","name":"read_file","arguments":"{\\"path\\":\\"README.md\\"}"}}\n\n'),
    ...parser.push('event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"lo"}\n\n'),
    ...parser.push('event: response.done\ndata: {"type":"response.done","response":{"status":"completed","usage":{"input_tokens":10,"output_tokens":4}}}\n\n'),
    ...parser.finish(),
  ];

  assert.equal(events[0]?.text, "hel");
  assert.equal(events.find((event) => event.toolCalls)?.toolCalls?.[0]?.id, "call-1");
  assert.equal(events.find((event) => event.toolCalls)?.toolCalls?.[0]?.name, "read_file");
  assert.equal(events.find((event) => event.toolCalls)?.toolCalls?.[0]?.arguments, '{"path":"README.md"}');
  assert.equal(events.some((event) => event.text === "lo"), true);
  assert.equal(events.at(-1)?.finishReason, "stop");
  assert.equal(events.at(-1)?.usage?.input_tokens, 10);
  assert.equal(parser.finishReason, "stop");
});

test("preserves Responses cache and reasoning usage details", () => {
  const parser = new ResponsesStreamParser();
  const events = parser.push('event: response.done\ndata: {"type":"response.done","response":{"status":"completed","usage":{"input_tokens":125,"output_tokens":48,"total_tokens":173,"input_tokens_details":{"cached_tokens":98},"output_tokens_details":{"reasoning_tokens":12}}}}\n\n');

  assert.deepEqual(events[0]?.usage, {
    input_tokens: 125,
    output_tokens: 48,
    total_tokens: 173,
    input_tokens_details: { cached_tokens: 98 },
    output_tokens_details: { reasoning_tokens: 12 },
  });
});

test("does not expose server-side tool activity as a VS Code client tool call", () => {
  const parser = new ResponsesStreamParser();
  const events = [
    ...parser.push('event: response.output_item.added\ndata: {"type":"response.output_item.added","item":{"type":"web_search_call","id":"search-1"}}\n\n'),
    ...parser.push('event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"answer"}\n\n'),
    ...parser.push('event: response.done\ndata: {"type":"response.done","response":{"status":"completed"}}\n\n'),
  ];

  assert.deepEqual(events.flatMap((event) => event.toolCalls ?? []), []);
  assert.equal(events.some((event) => event.text === "answer"), true);
});

test("recovers completed response text only when text deltas are absent", () => {
  const recovered = new ResponsesStreamParser();
  const recoveredEvents = recovered.push('event: response.done\ndata: {"type":"response.done","response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"recovered"}]}]}}\n\n');
  assert.equal(recoveredEvents[0].text, "recovered");

  const streamed = new ResponsesStreamParser();
  const streamedEvents = streamed.push([
    'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"answer"}',
    'event: response.done\ndata: {"type":"response.done","response":{"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":"answer"}]}]}}',
  ].join("\n\n") + "\n\n");
  assert.equal(streamedEvents.filter((event) => event.text).length, 1);
});

function responseFrame(type: string, value: Record<string, unknown>): string {
  return `event: ${type}\r\ndata: ${JSON.stringify({ type, ...value })}\r\n\r\n`;
}

test("joins numeric output indices to item and canonical call IDs", () => {
  const parser = new ResponsesStreamParser();
  const events = [
    responseFrame("response.function_call_arguments.delta", { output_index: 0, delta: '{"path":' }),
    responseFrame("response.output_item.added", { output_index: 0, item: { id: "item", call_id: "call", type: "function_call", name: "read" } }),
    responseFrame("response.function_call_arguments.delta", { item_id: "item", delta: '"one"}' }),
    responseFrame("response.output_item.done", { output_index: 0, item: { id: "item", call_id: "call", type: "function_call", name: "read" } }),
    responseFrame("response.function_call_arguments.done", { output_index: 0, name: "read", arguments: '{"path":"one"}' }),
    responseFrame("response.done", { response: { status: "completed" } }),
  ].flatMap((frame) => parser.push(frame));
  assert.deepEqual(events.flatMap((event) => event.toolCalls ?? []), [{ id: "call", name: "read", arguments: '{"path":"one"}' }]);
});

test("an unnamed arguments-done waits for its owning item and leaves siblings pending", () => {
  const parser = new ResponsesStreamParser();
  const events = [
    responseFrame("response.function_call_arguments.delta", { output_index: 0, delta: '{"a":1}' }),
    responseFrame("response.function_call_arguments.delta", { output_index: 1, delta: '{"b":' }),
    responseFrame("response.function_call_arguments.done", { output_index: 0, arguments: '{"a":1}' }),
    responseFrame("response.output_item.done", { output_index: 0, item: { id: "item-a", call_id: "call-a", type: "function_call", name: "first" } }),
    responseFrame("response.output_item.added", { output_index: 1, item: { id: "item-b", call_id: "call-b", type: "function_call", name: "second" } }),
    responseFrame("response.function_call_arguments.delta", { item_id: "item-b", delta: '2}' }),
    responseFrame("response.output_item.done", { output_index: 1, item: { id: "item-b", call_id: "call-b", type: "function_call", name: "second" } }),
  ].flatMap((frame) => parser.push(frame));
  assert.deepEqual(events.flatMap((event) => event.toolCalls ?? []), [
    { id: "call-a", name: "first", arguments: '{"a":1}' },
    { id: "call-b", name: "second", arguments: '{"b":2}' },
  ]);
  assert.deepEqual(parser.finish(), []);
});

test("keeps incomplete per-call completion pending and rejects truncated EOF", () => {
  const parser = new ResponsesStreamParser();
  assert.deepEqual(parser.push(responseFrame("response.function_call_arguments.done", { output_index: 0, name: "read", arguments: "{" })), []);
  assert.throws(() => parser.finish(), /incomplete arguments/);
});

test("recovers completed snapshot calls once and ignores late arguments-done duplicates", () => {
  const parser = new ResponsesStreamParser();
  const item = { id: "item", call_id: "call", type: "function_call", name: "read", arguments: "{}" };
  const events = [
    responseFrame("response.done", { response: { status: "completed", output: [item] } }),
    responseFrame("response.function_call_arguments.done", { item_id: "item", call_id: "call", name: "read", arguments: "{}" }),
    responseFrame("response.output_item.done", { item }),
  ].flatMap((frame) => parser.push(frame));
  assert.equal(events.flatMap((event) => event.toolCalls ?? []).length, 1);
});

test("reassembles CRLF split inside event names and terminal delimiters", () => {
  const frame = responseFrame("response.output_text.delta", { delta: "answer" });
  for (let position = 1; position < frame.length; position++) {
    const parser = new ResponsesStreamParser();
    const events = [...parser.push(frame.slice(0, position)), ...parser.push(frame.slice(position)), ...parser.finish()];
    assert.equal(events.length, 1);
    assert.equal(events[0].text, "answer");
  }
});

test("recognizes standalone incomplete terminal events", () => {
  const parser = new ResponsesStreamParser();
  parser.push(responseFrame("response.incomplete", { response: { status: "incomplete" } }));
  assert.equal(parser.finishReason, "length");
});

test("waits for a canonical call ID when indexed arguments finish before the item", () => {
  const parser = new ResponsesStreamParser();
  assert.deepEqual(parser.push(responseFrame("response.function_call_arguments.done", { output_index: 0, name: "read", arguments: "{}" })), []);
  const events = parser.push(responseFrame("response.output_item.done", { output_index: 0, item: { type: "function_call", id: "item", call_id: "canonical", name: "read" } }));
  assert.deepEqual(events.flatMap((event) => event.toolCalls ?? []), [{ id: "canonical", name: "read", arguments: "{}" }]);
});
