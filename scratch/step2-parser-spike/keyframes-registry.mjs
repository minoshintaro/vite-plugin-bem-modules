export class KeyframesRegistry {
  constructor() {
    this.fileToNames = new Map();
    this.nameToFiles = new Map();
  }

  replace(file, names) {
    this.remove(file);
    const currentNames = new Set(names);
    if (currentNames.size === 0) return;
    this.fileToNames.set(file, currentNames);
    for (const name of currentNames) {
      const files = this.nameToFiles.get(name) ?? new Set();
      files.add(file);
      this.nameToFiles.set(name, files);
    }
  }

  remove(file) {
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

  conflicts() {
    return [...this.nameToFiles.entries()]
      .filter(([, files]) => files.size > 1)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, files]) => ({ name, files: [...files].sort() }));
  }
}
