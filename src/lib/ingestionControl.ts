export class IngestionPending extends Error {
  constructor() {
    super('Completed pages saved. Continue indexing to process the next batch.')
    this.name = 'IngestionPending'
  }
}
export class DuplicateDocument extends Error {
  constructor(public documentId: number) {
    super('This PDF is already indexed in this folder.')
    this.name = 'DuplicateDocument'
  }
}
