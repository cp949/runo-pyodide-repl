export interface HistoryOptions {
  /** false면 localStorage에 저장·복원하지 않는다. 기본값은 true(원본 동작). */
  persist?: boolean;
}

export class History {
  public entries: string[] = [];
  public maxEntries: number;
  public cursor = -1;
  private readonly persist: boolean;

  constructor(maxEntries: number, options: HistoryOptions = {}) {
    this.maxEntries = maxEntries;
    this.persist = options.persist ?? true;
  }

  public saveToLocalStorage() {
    if (!this.persist) return;
    const localStorage = window?.localStorage;
    if (localStorage !== undefined) {
      localStorage.setItem("history", JSON.stringify(this.entries));
    }
  }

  public restoreFromLocalStorage() {
    if (!this.persist) return;
    const localStorage = window?.localStorage;
    if (localStorage !== undefined) {
      const historyJson = localStorage.getItem("history");
      if (historyJson === undefined || historyJson === null) {
        return;
      }
      try {
        const historyEntries: string[] = JSON.parse(historyJson);
        if (
          !Array.isArray(historyEntries) ||
          historyEntries.find((it) => typeof it !== "string") !== undefined
        ) {
          this.entries = [];
          localStorage.setItem("history", "[]");
        } else {
          this.entries = historyEntries;
        }
      } catch (e) {
        this.entries = [];
        localStorage.setItem("history", "[]");
      }
    }
  }

  public append(text: string) {
    this.resetCursor();
    if (!this.entries.includes(text)) {
      this.entries.unshift(text);
    } else {
      this.entries.splice(this.entries.indexOf(text), 1);
      this.entries.unshift(text);
    }
    if (this.entries.length > this.maxEntries) {
      this.entries.pop();
    }
    this.saveToLocalStorage();
  }

  public resetCursor() {
    this.cursor = -1;
  }

  public next(): string | undefined {
    if (this.cursor === -1) {
      return undefined;
    } else {
      this.cursor -= 1;
    }

    return this.entries[this.cursor];
  }

  public prev(): string | undefined {
    if (this.cursor + 1 >= this.entries.length) {
      return undefined;
    } else {
      this.cursor += 1;
    }

    return this.entries[this.cursor];
  }
}
