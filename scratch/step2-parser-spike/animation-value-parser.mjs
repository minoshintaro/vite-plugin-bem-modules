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

function isIdentStart(char) {
  return /[A-Za-z_-]/.test(char ?? "");
}

function isTokenBoundary(char) {
  return char === undefined || /[\s,()]/.test(char);
}

function consumeQuoted(input, start) {
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

function consumeFunction(input, start) {
  let depth = 0;
  let quote = null;
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

function tokenize(value) {
  const tokens = [];
  let index = 0;
  while (index < value.length) {
    const start = index;
    const char = value[index];
    if (/\s/.test(char)) {
      index += 1;
      while (index < value.length && /\s/.test(value[index])) index += 1;
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
    if (isIdentStart(char) || /[0-9.+]/.test(char)) {
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
    if (char === "(" || char === ")") {
      index += 1;
      tokens.push({ type: "punctuation", raw: char });
      continue;
    }
    index += 1;
    tokens.push({ type: "punctuation", raw: char });
  }
  return tokens;
}

function isTime(value) {
  return /^\d*\.?\d+(?:ms|s)$/i.test(value);
}

function isNumber(value) {
  return /^\d*\.?\d+$/.test(value);
}

function isAnimationNameCandidate(token) {
  if (token.type !== "word") return false;
  const value = token.value.toLowerCase();
  if (CSS_WIDE_KEYWORDS.has(value) || ANIMATION_KEYWORDS.has(value)) return false;
  if (isTime(value) || isNumber(value) || value.startsWith("--")) return false;
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(token.value);
}

function splitGroups(tokens) {
  const groups = [[]];
  for (const token of tokens) {
    if (token.type === "comma") groups.push([]);
    else groups.at(-1).push(token);
  }
  return groups;
}

function wrapAnimationNames(tokens, property) {
  const groups = splitGroups(tokens);
  for (const group of groups) {
    const candidates = group.filter(isAnimationNameCandidate);
    const targets = property === "animation-name" ? candidates : candidates.slice(0, 1);
    // Declaration values use the CSS Modules value grammar: global(...) is
    // a function, whereas selector scope uses :global(...).
    for (const token of targets) token.raw = `global(${token.value})`;
  }
  return tokens.map((token) => token.raw).join("");
}

export function globalizeAnimationValue(value, property) {
  return wrapAnimationNames(tokenize(value), property);
}
