export interface PdfJournal {
  position: number;
  steps: string[];
}

export function journalKey(journal: PdfJournal): string {
  return journal.position === 0 ? "root" : (journal.steps[journal.position - 1] ?? "root");
}

export function isJournalDirty(journal: PdfJournal, savedKey: string): boolean {
  return journalKey(journal) !== savedKey;
}
