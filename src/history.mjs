export class ProjectHistory {
  constructor(limit = 80) {
    this.limit = limit;
    this.entries = [];
    this.index = -1;
    this.savedSignature = "";
  }

  snapshot(project, selection) {
    const value = structuredClone({ project, selection });
    return { value, signature: JSON.stringify(value.project) };
  }

  reset(project, selection) {
    const entry = this.snapshot(project, selection);
    this.entries = [entry];
    this.index = 0;
    this.savedSignature = entry.signature;
  }

  record(project, selection) {
    const entry = this.snapshot(project, selection);
    if (this.entries[this.index]?.signature === entry.signature) return false;
    this.entries.splice(this.index + 1);
    this.entries.push(entry);
    if (this.entries.length > this.limit + 1) this.entries.shift();
    this.index = this.entries.length - 1;
    return true;
  }

  get canUndo() {
    return this.index > 0;
  }

  get canRedo() {
    return this.index >= 0 && this.index < this.entries.length - 1;
  }

  undo() {
    if (!this.canUndo) return null;
    return structuredClone(this.entries[--this.index].value);
  }

  redo() {
    if (!this.canRedo) return null;
    return structuredClone(this.entries[++this.index].value);
  }

  markSaved(project) {
    this.savedSignature = JSON.stringify(project);
  }

  isDirty(project) {
    return this.index >= 0 && JSON.stringify(project) !== this.savedSignature;
  }
}
