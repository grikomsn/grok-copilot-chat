import * as vscode from "vscode";

export interface ChatFunctionTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export function buildChatFunctionTool(tool: vscode.LanguageModelChatTool): ChatFunctionTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: sanitizeSchema(tool.inputSchema),
    },
  };
}

export function toolMode(mode: vscode.LanguageModelChatToolMode | undefined): "auto" | "required" {
  return mode === vscode.LanguageModelChatToolMode.Required ? "required" : "auto";
}

function sanitizeSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { type: "object", properties: {} };
  }
  return schema as Record<string, unknown>;
}
