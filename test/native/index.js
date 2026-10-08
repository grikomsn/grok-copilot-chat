const assert = require("node:assert/strict");
const vscode = require("vscode");
const { GrokProvider } = require("../../out/provider");
const { XaiOAuth, XAI_SESSION_SECRET } = require("../../out/auth/oauth");
const { StreamResponseReporter } = require("../../out/provider/response");

async function run() {
  const source = new vscode.CancellationTokenSource();
  const values = new Map();
  const store = { keys: async () => [...values.keys()], get: async (key) => values.get(key),
    store: async (key, value) => { values.set(key, value); }, delete: async (key) => { values.delete(key); } };
  for (const profile of ["default", "work"]) await store.store(profile === "default" ? XAI_SESSION_SECRET : `${XAI_SESSION_SECRET}.${profile}`,
    JSON.stringify({ accessToken: `synthetic-${profile}`, refreshToken: "synthetic-refresh", expiresAt: Date.now() + 3600000 }));
  const oauth = new XaiOAuth(store, { fetch: async () => Response.json({ access_token: "synthetic-refreshed", refresh_token: "synthetic-refresh", expires_in: 3600 }) });
  const stateValues = new Map();
  const state = { get: (key) => stateValues.get(key), update: async (key, value) => { await new Promise((resolve) => setImmediate(resolve)); stateValues.set(key, value); } };
  const provider = new GrokProvider(oauth, { appendLine() {} }, {}, state);
  const previousFetch = globalThis.fetch;
  const requests = [];
  let fail401 = false;
  let partial = false;
  let stalled = false;
  let bodyCancelled = false;
  const frame = (value) => `data: ${JSON.stringify(value)}\r\n\r\n`;
  const responseFrame = (type, value) => frame({ type, ...value });
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("models.dev")) return Response.json({});
    if (String(url).endsWith("/models")) return Response.json({ data: [{ id: "grok-4.6", context_length: 500000 }] });
    requests.push({ headers: new Headers(init.headers), body: JSON.parse(init.body) });
    if (fail401) { fail401 = false; return new Response("", { status: 401 }); }
    if (stalled) return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(frame({ choices: [{ delta: { reasoning_content: "synthetic plan" } }] }))); }, cancel() { bodyCancelled = true; } }));
    if (partial) return new Response(frame({ choices: [{ delta: { reasoning_content: "synthetic plan" } }] }));
    if (String(url).endsWith("/responses")) return new Response([
      responseFrame("response.reasoning_summary_text.delta", { delta: "synthetic plan" }),
      responseFrame("response.function_call_arguments.delta", { output_index: 0, delta: '{"value":0}' }),
      responseFrame("response.function_call_arguments.delta", { output_index: 1, delta: '{"value":' }),
      responseFrame("response.function_call_arguments.done", { output_index: 0, arguments: '{"value":0}' }),
      responseFrame("response.output_item.done", { output_index: 0, item: { type: "function_call", id: "item-a", call_id: "call-a", name: "probe" } }),
      responseFrame("response.output_item.added", { output_index: 1, item: { type: "function_call", id: "item-b", call_id: "call-b", name: "probe" } }),
      responseFrame("response.function_call_arguments.delta", { item_id: "item-b", delta: '1}' }),
      responseFrame("response.output_item.done", { output_index: 1, item: { type: "function_call", id: "item-b", call_id: "call-b", name: "probe" } }),
      responseFrame("response.function_call_arguments.done", { item_id: "item-a", call_id: "call-a", name: "probe", arguments: '{"value":0}' }),
      responseFrame("response.completed", { response: { status: "completed", usage: { input_tokens: 10, output_tokens: 5 } } }),
    ].join(""));
    return new Response([
      frame({ choices: [{ delta: { reasoning_content: "synthetic plan" } }] }),
      frame({ choices: [{ delta: { tool_calls: [0, 1, 2].map((index) => ({ index, id: `call-${index}`, function: { name: "probe", arguments: '{"value":' } })) } }] }),
      frame({ choices: [{ delta: { tool_calls: [2, 1, 0].map((index) => ({ id: `call-${index}`, function: { arguments: `${index}}` } })) } }] }),
      frame({ choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 5 } }),
      "data: [DONE]\r\n\r\n",
    ].join(""));
  };
  try {
    const prepare = async (profile) => (await provider.provideLanguageModelChatInformation({ silent: true, configuration: { profile } }, source.token))[0];
    const [personal, work] = await Promise.all([prepare("default"), prepare("work")]);
    assert.equal(personal.id, "default::grok-4.6");
    assert.equal(work.id, "work::grok-4.6");
    assert.deepEqual(await oauth.listProfiles(), ["default", "work"]);
    assert.deepEqual(await provider.reconcileAccounts(), { entriesWithoutSessions: [], accountsWithoutObservedEntries: [] });
    const options = { requestInitiator: "native-test", tools: [{ name: "probe", description: "Synthetic probe", inputSchema: { type: "object" } }] };
    let lastCalls;
    for (const model of [personal, work]) {
      const output = [];
      await provider.provideLanguageModelChatResponse(model, [vscode.LanguageModelChatMessage.User("synthetic prompt")], options, { report: (part) => output.push(part) }, source.token);
      assert.equal(requests.at(-1).headers.get("Authorization"), `Bearer synthetic-${model.profile}`);
      lastCalls = output.filter((part) => part instanceof vscode.LanguageModelToolCallPart);
      assert.equal(lastCalls.length, 3);
      assert.equal(new Set(lastCalls.map((part) => part.callId)).size, 3);
      assert.deepEqual(lastCalls.map((part) => part.input.value), [0, 1, 2]);
      assert.equal(output[1].metadata.vscode_reasoning_done, true);
    }
    const followup = [vscode.LanguageModelChatMessage.User("synthetic prompt"), vscode.LanguageModelChatMessage.Assistant(lastCalls),
      vscode.LanguageModelChatMessage.User(lastCalls.map((call) => new vscode.LanguageModelToolResultPart(call.callId, [new vscode.LanguageModelTextPart("synthetic result")])) )];
    await provider.provideLanguageModelChatResponse(work, followup, options, { report() {} }, source.token);
    assert.equal(requests.at(-1).body.messages.filter((message) => message.role === "tool").length, 3);
    const responseParts = [];
    await provider.provideLanguageModelChatResponse(work, followup, { ...options, modelConfiguration: { webSearch: true } }, { report: (part) => responseParts.push(part) }, source.token);
    assert.equal(requests.at(-1).body.store, false);
    assert.equal(responseParts.filter((part) => part instanceof vscode.LanguageModelToolCallPart).length, 2);
    assert.equal(responseParts[1].metadata.vscode_reasoning_done, true);
    fail401 = true;
    const before = requests.length;
    await provider.provideLanguageModelChatResponse(work, [], options, { report() {} }, source.token);
    assert.equal(requests.length - before, 2);
    assert.equal(requests.at(-1).headers.get("Authorization"), "Bearer synthetic-refreshed");
    partial = true;
    const partialParts = [];
    await assert.rejects(provider.provideLanguageModelChatResponse(work, [], options, { report: (part) => partialParts.push(part) }, source.token), /completion reason/);
    assert.equal(partialParts.at(-1).metadata.vscode_reasoning_done, true);
    partial = false;
    stalled = true;
    const cancel = new vscode.CancellationTokenSource();
    const cancellationParts = [];
    const pending = provider.provideLanguageModelChatResponse(work, [], options, { report: (part) => { cancellationParts.push(part); cancel.cancel(); } }, cancel.token);
    await Promise.race([pending, new Promise((_, reject) => setTimeout(() => reject(new Error("Native cancellation failed")), 2000))]);
    assert.equal(bodyCancelled, true);
    assert.equal(cancellationParts.at(-1).metadata.vscode_reasoning_done, true);
    cancel.dispose();
    await oauth.signOut("work");
    provider.clearModelCache();
    assert.equal((await provider.provideLanguageModelChatInformation({ silent: true, configuration: { profile: "work" } }, source.token)).length, 0);
    assert.deepEqual(await provider.reconcileAccounts(), { entriesWithoutSessions: ["work"], accountsWithoutObservedEntries: [] });
    const generated = [];
    const reporter = new StreamResponseReporter({ report: (part) => generated.push(part) }, vscode, "native");
    reporter.report({ toolCalls: [{ id: "", name: "probe", arguments: "{}" }, { id: "", name: "probe", arguments: "{}" }] });
    assert.equal(new Set(generated.map((part) => part.callId)).size, 2);
  } finally { globalThis.fetch = previousFetch; source.dispose(); }
  console.log(JSON.stringify({ provider: "grok", nativeChecks: "parallel tools in both protocols, follow-up, reasoning closure, cancellation, EOF error, 401 refresh, two profiles, reconciliation", passed: true }));
}
module.exports = { run };
