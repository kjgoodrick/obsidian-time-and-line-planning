/** Shared, serialized frontmatter transactions. Undo survives view re-renders and switches. */
export type Frontmatter = Record<string, any>;
export type ProcessFile = (file: any, mutate: (fm: Frontmatter) => void) => Promise<void>;
export class EditHistory {
  private stack: { file: any; before: Frontmatter; after: Frontmatter; undoCreation?: () => Promise<void> }[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private process: ProcessFile) {}
  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run);
    this.queue = next.catch(() => {});
    return next;
  }
  patch(file: any, values: Frontmatter, expected?: Frontmatter): Promise<void> {
    return this.enqueue(async () => {
      const before: Frontmatter = {}, after: Frontmatter = {};
      await this.process(file, fm => {
        if (expected) for (const key of Object.keys(expected)) {
          if (JSON.stringify(fm[key]) !== JSON.stringify(expected[key])) throw new Error('Task changed since it was opened. Reopen it before saving.');
        }
        for (const key of Object.keys(values)) {
          before[key] = fm[key] === undefined ? undefined : JSON.parse(JSON.stringify(fm[key]));
          after[key] = values[key];
          if (values[key] === undefined) delete fm[key]; else fm[key] = values[key];
        }
      });
      if (JSON.stringify(before) !== JSON.stringify(after)) this.stack.push({ file, before, after });
      if (this.stack.length > 100) this.stack.shift();
    });
  }
  recordCreation(file: any, content: string, read: (file: any) => Promise<string>, trash: (file: any) => Promise<void>): void {
    this.stack.push({ file, before: {}, after: {}, undoCreation: async () => {
      if (await read(file) !== content) throw new Error('Cannot undo creation: the new task was modified.');
      await trash(file);
    } });
  }
  get canUndo(): boolean { return this.stack.length > 0; }
  undo(): Promise<boolean> {
    return this.enqueue(async () => {
      const edit = this.stack[this.stack.length - 1];
      if (!edit) return false;
      if (edit.undoCreation) { await edit.undoCreation(); this.stack.pop(); return true; }
      await this.process(edit.file, fm => {
        for (const key of Object.keys(edit.after)) {
          if (JSON.stringify(fm[key]) !== JSON.stringify(edit.after[key])) throw new Error('Cannot undo: this task has changed since the edit.');
        }
        for (const key of Object.keys(edit.before)) {
          if (edit.before[key] === undefined) delete fm[key]; else fm[key] = edit.before[key];
        }
      });
      this.stack.pop();
      return true;
    });
  }
}
