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
