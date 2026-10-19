export function messageOf(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError") return "Request cancelled or timed out";
    return error.message;
  }
  return String(error);
}
