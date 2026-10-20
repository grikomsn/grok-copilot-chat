/** Preserve the underlying failure while making context rejections actionable. */
export function withContextOverflowHint(error: unknown): unknown {
  if (!(error instanceof Error) || error.message.includes("/compact")) return error;
  if (!/context[_ ](?:length|window)[_ ]exceeded|maximum context length|context (?:window|length).{0,100}(?:exceed|limit)|prompt (?:is )?too long|too many (?:input|prompt) tokens|exceed.{0,60}(?:context window|context length)/i.test(error.message)) return error;
  return new Error(`${error.message} Run /compact in Copilot Chat, reduce attachments or tool output, or start a new chat.`, { cause: error });
}
