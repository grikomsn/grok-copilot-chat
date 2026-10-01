/** Preserve surrogate pairs split across text parts without changing real newlines. */
export function joinTextParts(parts: readonly string[]): string {
  let text = "";
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index];
    const splitPair = /[\uD800-\uDBFF]$/.test(text) && /^[\uDC00-\uDFFF]/.test(part);
    text += (index && !splitPair ? "\n" : "") + part;
  }
  return wellFormedText(text);
}

function wellFormedText(text: string): string {
  return text.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g,
    (match) => match.length === 2 ? match : "\uFFFD");
}

/** Normalize JSON strings before encoding, including nested tool inputs and schema keys. */
export function stringifyWellFormedJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === "string") return wellFormedText(item);
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      const entries = Object.entries(item);
      if (entries.some(([key]) => key !== wellFormedText(key))) {
        return Object.fromEntries(entries.map(([key, child]) => [wellFormedText(key), child]));
      }
    }
    return item;
  });
}
