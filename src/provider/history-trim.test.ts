import assert from "node:assert/strict";
import test from "node:test";
import {
  estimateChatMessageTokens,
  estimateResponsesItemTokens,
  trimChatHistoryToFit,
  trimResponsesInputToFit,
} from "./history-trim";
import type { ChatMessage } from "./messages";
import type { ResponsesInputItem } from "../transport/responses";

function userMessage(text: string): ChatMessage {
  return { role: "user", content: text };
}

function toolCallMessage(callId: string): ChatMessage {
  return {
    role: "assistant",
    content: null,
    tool_calls: [{ id: callId, type: "function", function: { name: "run", arguments: "{}" } }],
  };
}

function toolResultMessage(callId: string, content: string): ChatMessage {
  return { role: "tool", tool_call_id: callId, content };
}

function userItem(text: string): ResponsesInputItem {
  return { type: "message", role: "user", content: text };
}

function callItem(callId: string): ResponsesInputItem {
  return { type: "function_call", call_id: callId, name: "run", arguments: "{}" };
}

function outputItem(callId: string, output: string): ResponsesInputItem {
  return { type: "function_call_output", call_id: callId, output };
}

test("keeps chat history that already fits the budget", () => {
  const messages = [userMessage("hello"), userMessage("more")];
  const result = trimChatHistoryToFit(messages, 10_000);

  assert.equal(result.removedItems, 0);
  assert.equal(result.items, messages);
});

test("drops the oldest chat turns until the estimated payload fits", () => {
  const messages = [
    userMessage("a".repeat(400)),
    userMessage("b".repeat(400)),
    userMessage("c".repeat(400)),
    userMessage("d".repeat(400)),
    userMessage("e".repeat(400)),
  ];
  const result = trimChatHistoryToFit(messages, 250);

  assert.equal(result.removedItems, 3);
  assert.deepEqual(result.items, [messages[0], messages[4]]);
  assert.ok(result.estimatedTokens <= 250);
});

test("keeps chat tool calls and their results in one dropped unit", () => {
  const messages = [
    userMessage("a".repeat(400)),
    userMessage("b".repeat(400)),
    toolCallMessage("call-1"),
    toolResultMessage("call-1", "done"),
    userMessage("c".repeat(400)),
    userMessage("d".repeat(400)),
  ];
  const result = trimChatHistoryToFit(messages, 310);

  assert.equal(result.removedItems, 3);
  assert.deepEqual(result.items, [messages[0], messages[4], messages[5]]);
});

test("does not split a pending chat tool call from its result", () => {
  const messages = [
    userMessage("a".repeat(400)),
    userMessage("b".repeat(400)),
    toolCallMessage("call-1"),
    userMessage("please continue"),
    toolResultMessage("call-1", "done"),
    userMessage("c".repeat(400)),
    userMessage("d".repeat(400)),
  ];
  const result = trimChatHistoryToFit(messages, 310);

  assert.equal(result.removedItems, 4);
  assert.deepEqual(result.items, [messages[0], messages[5], messages[6]]);
});

test("keeps the chat anchor and current turn when nothing else fits", () => {
  const messages = [userMessage("anchor"), userMessage("x".repeat(4000)), userMessage("current")];
  const result = trimChatHistoryToFit(messages, 10);

  assert.equal(result.removedItems, 1);
  assert.deepEqual(result.items, [messages[0], messages[2]]);
});

test("never trims single-message chat history and ignores non-positive budgets", () => {
  assert.equal(trimChatHistoryToFit([], 100).removedItems, 0);
  assert.equal(trimChatHistoryToFit([userMessage("only turn ".repeat(100))], 1).removedItems, 0);
  const messages = [userMessage("a"), userMessage("b"), userMessage("c")];
  const result = trimChatHistoryToFit(messages, 0);
  assert.equal(result.removedItems, 0);
  assert.equal(result.items, messages);
});

test("keeps Responses input that already fits the budget", () => {
  const items = [userItem("hello"), userItem("more")];
  const result = trimResponsesInputToFit(items, 10_000);

  assert.equal(result.removedItems, 0);
  assert.equal(result.items, items);
});

test("drops the oldest Responses turns until the estimated payload fits", () => {
  const items = [
    userItem("a".repeat(400)),
    userItem("b".repeat(400)),
    userItem("c".repeat(400)),
    userItem("d".repeat(400)),
    userItem("e".repeat(400)),
  ];
  const result = trimResponsesInputToFit(items, 250);

  assert.equal(result.removedItems, 3);
  assert.deepEqual(result.items, [items[0], items[4]]);
  assert.ok(result.estimatedTokens <= 250);
});

test("does not split a pending Responses tool call from its output", () => {
  const items = [
    userItem("a".repeat(400)),
    userItem("b".repeat(400)),
    callItem("call-1"),
    userItem("please continue"),
    outputItem("call-1", "done"),
    userItem("c".repeat(400)),
    userItem("d".repeat(400)),
  ];
  const result = trimResponsesInputToFit(items, 310);

  assert.equal(result.removedItems, 4);
  assert.deepEqual(result.items, [items[0], items[5], items[6]]);
});

test("estimates chat messages and Responses items with fixed image weights", () => {
  assert.equal(estimateChatMessageTokens(userMessage("x".repeat(40))), 10);
  assert.equal(estimateChatMessageTokens({ role: "assistant", content: null }), 1);
  assert.equal(estimateChatMessageTokens({ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] }), 1024);
  assert.equal(estimateChatMessageTokens(toolCallMessage("call-1")), Math.ceil("run{}".length / 4));
  assert.equal(estimateResponsesItemTokens(callItem("call-1")), Math.ceil("run{}".length / 4));
  assert.equal(estimateResponsesItemTokens(outputItem("call-1", "ok")), 1);
  assert.equal(estimateResponsesItemTokens(userItem("x".repeat(40))), 10);
  assert.equal(estimateResponsesItemTokens({ type: "message", role: "user", content: [{ type: "input_image", image_url: "data:image/png;base64,AAAA" }] }), 1024);
});
