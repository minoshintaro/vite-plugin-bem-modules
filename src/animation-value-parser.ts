const CSS_WIDE_KEYWORDS = new Set([
  "initial",
  "inherit",
  "unset",
  "revert",
  "revert-layer",
]);

const ANIMATION_KEYWORDS = new Set([
  "none",
  "normal",
  "reverse",
  "alternate",
  "alternate-reverse",
  "forwards",
  "backwards",
  "both",
  "running",
  "paused",
  "infinite",
  "ease",
  "ease-in",
  "ease-out",
  "ease-in-out",
  "linear",
  "step-start",
  "step-end",
]);

type Token = {
  type: "space" | "comma" | "word" | "function" | "string" | "punctuation";
  raw: string;
  value?: string;
};

function consumeQuoted(input: string, start: number): number {
  const quote = input[start];
  let index = start + 1;
  while (index < input.length) {
    if (input[index] === "\\") {
      index += 2;
      continue;
    }
    if (input[index] === quote) return index + 1;
    index += 1;
  }
  return input.length;
}

function consumeFunction(input: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let index = start; index < input.length; index += 1) {
    const char = input[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return input.length;
}

function isIdentStart(char: string | undefined): boolean {
  return /[A-Za-z_-]/.test(char ?? "");
}

function isTokenBoundary(char: string | undefined): boolean {
  return char === undefined || /[\s,()]/.test(char);
}

function tokenize(value: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < value.length) {
    const start = index;
    const char = value[index];
    if (/\s/.test(char!)) {
      index += 1;
      while (index < value.length && /\s/.test(value[index]!)) index += 1;
      tokens.push({ type: "space", raw: value.slice(start, index) });
      continue;
    }
    if (char === ",") {
      tokens.push({ type: "comma", raw: char });
      index += 1;
      continue;
    }
    if (char === "\"" || char === "'") {
      index = consumeQuoted(value, index);
      tokens.push({ type: "string", raw: value.slice(start, index) });
      continue;
    }
    if (isIdentStart(char) || /[0-9.+]/.test(char!)) {
      index += 1;
      while (index < value.length && !isTokenBoundary(value[index])) index += 1;
      const raw = value.slice(start, index);
      if (value[index] === "(") {
        index = consumeFunction(value, index);
        tokens.push({ type: "function", raw: value.slice(start, index) });
      } else {
        tokens.push({ type: "word", raw, value: raw });
      }
      continue;
    }
    index += 1;
    tokens.push({ type: "punctuation", raw: char! });
  }
  return tokens;
}

function isTime(value: string): boolean {
  return /^\d*\.?\d+(?:ms|s)$/i.test(value);
}

function isNumber(value: string): boolean {
  return /^\d*\.?\d+$/.test(value);
}

function isAnimationNameCandidate(token: Token): boolean {
  if (token.type !== "word" || token.value === undefined) return false;
  const value = token.value.toLowerCase();
  if (CSS_WIDE_KEYWORDS.has(value) || ANIMATION_KEYWORDS.has(value)) return false;
  if (isTime(value) || isNumber(value) || value.startsWith("--")) return false;
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(token.value);
}

function splitGroups(tokens: readonly Token[]): Token[][] {
  const groups: Token[][] = [[]];
  for (const token of tokens) {
    if (token.type === "comma") groups.push([]);
    else groups.at(-1)!.push(token);
  }
  return groups;
}

/** Wrap only statically identifiable animation names in Vite's global marker. */
export function globalizeAnimationValue(value: string, property: string): string {
  const tokens = tokenize(value);
  for (const group of splitGroups(tokens)) {
    const candidates = group.filter(isAnimationNameCandidate);
    const targets = property === "animation-name" ? candidates : candidates.slice(0, 1);
    for (const token of targets) token.raw = `global(${token.value})`;
  }
  return tokens.map((token) => token.raw).join("");
}
