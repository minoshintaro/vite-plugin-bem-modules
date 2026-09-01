export type BemDiagnosticCode =
  | "BEM001"
  | "BEM002"
  | "BEM003"
  | "BEM004"
  | "BEM005"
  | "BEM006"
  | "BEM007"
  | "BEM008"
  | "BEM009";

export type BemDiagnostic = {
  code: BemDiagnosticCode;
  file?: string;
  message: string;
  details: string[];
};

export type BemDiagnosticError = Error & {
  diagnostic: BemDiagnostic;
};

export function createBemDiagnosticError(
  code: BemDiagnosticCode,
  message: string,
  context: { file?: string; details?: string[] } = {}
): BemDiagnosticError {
  const details = [...(context.details ?? [])];
  if (context.file) details.push(`file: ${context.file}`);
  const suffix = details.length > 0 ? `\n${details.map((detail) => `- ${detail}`).join("\n")}` : "";
  const error = new Error(`[vite-plugin-bem-modules:${code}] ${message}${suffix}`) as BemDiagnosticError;
  error.diagnostic = {
    code,
    file: context.file,
    message,
    details,
  };
  return error;
}

export function unsupportedCssModuleQueryError(
  importer: string,
  query: "raw" | "inline" | "url",
): BemDiagnosticError {
  return createBemDiagnosticError("BEM008", "CSS Module query is not supported for BEM modules.", {
    file: importer,
    details: [
      `query: ?${query}`,
      "remove the query or use a CSS Module without an @block declaration.",
    ],
  });
}

export function cssModuleOutputMismatchError(
  file: string,
  details: string[],
): BemDiagnosticError {
  return createBemDiagnosticError("BEM009", "Vite CSS Module output does not match the BEM schema.", {
    file,
    details,
  });
}
