import { access, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export const GENERATED_DECLARATION_MARKER = "/* vite-plugin-bem-modules: generated */";

export function declarationPathFor(sourcePath) {
  return `${sourcePath}.d.ts`;
}

export function renderClassDeclaration(classMap) {
  const lines = [GENERATED_DECLARATION_MARKER, "declare const styles: {"];
  for (const key of [...classMap.keys()].sort()) {
    lines.push(`  readonly ${key}: string;`);
  }
  lines.push("};", "export default styles;", "");
  return lines.join("\n");
}

function isOwnedDeclaration(contents) {
  return contents.startsWith(`${GENERATED_DECLARATION_MARKER}\n`);
}

export async function writeClassDeclaration(sourcePath, classMap) {
  const declarationPath = declarationPathFor(sourcePath);
  const contents = renderClassDeclaration(classMap);
  try {
    const current = await readFile(declarationPath, "utf8");
    if (!isOwnedDeclaration(current)) return { status: "protected", declarationPath };
    if (current === contents) return { status: "unchanged", declarationPath };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await writeFile(declarationPath, contents);
  return { status: "written", declarationPath };
}

export async function removeOwnedDeclaration(sourcePath) {
  const declarationPath = declarationPathFor(sourcePath);
  try {
    const current = await readFile(declarationPath, "utf8");
    if (!isOwnedDeclaration(current)) return { status: "protected", declarationPath };
    await unlink(declarationPath);
    return { status: "removed", declarationPath };
  } catch (error) {
    if (error.code === "ENOENT") return { status: "missing", declarationPath };
    throw error;
  }
}

export function isCssModulePath(file) {
  return path.isAbsolute(file) && /\.module\.(?:css|scss)$/.test(file);
}

export async function declarationExists(sourcePath) {
  try {
    await access(declarationPathFor(sourcePath));
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
