import type { ResponsesWebSearchTool } from "../transport/responses";

/** A server-executed xAI tool, distinct from caller-executed VS Code functions. */
export const XAI_WEB_SEARCH_TOOL: ResponsesWebSearchTool = { type: "web_search" };
