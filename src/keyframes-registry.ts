export type KeyframesConflict = {
  name: string;
  files: readonly string[];
};

/** Bidirectional current-state index for global keyframes names. */
export class KeyframesRegistry {
  readonly fileToNames = new Map<string, Set<string>>();
  readonly nameToFiles = new Map<string, Set<string>>();

  replace(file: string, names: Iterable<string>): void {
    this.remove(file);
    const currentNames = new Set(names);
    if (currentNames.size === 0) return;
    this.fileToNames.set(file, currentNames);
    for (const name of currentNames) {
      const files = this.nameToFiles.get(name) ?? new Set<string>();
      files.add(file);
      this.nameToFiles.set(name, files);
    }
  }

  remove(file: string): void {
    const previousNames = this.fileToNames.get(file);
    if (!previousNames) return;
    this.fileToNames.delete(file);
    for (const name of previousNames) {
      const files = this.nameToFiles.get(name);
      if (!files) continue;
      files.delete(file);
      if (files.size === 0) this.nameToFiles.delete(name);
    }
  }

  conflicts(): KeyframesConflict[] {
    return [...this.nameToFiles.entries()]
      .filter(([, files]) => files.size > 1)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, files]) => ({ name, files: [...files].sort() }));
  }
}
