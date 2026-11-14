/** UI response ordering only. The server/database remain the access authority. */
export type OwnerStatusTicket = { id: number; generation: number; mutation: boolean };
export class OwnerStatusGate {
  private generation = 0;
  private sequence = 0;
  private applied = 0;
  private mutations = new Set<number>();
  invalidate() { this.generation++; this.applied = 0; }
  reset() { this.invalidate(); this.mutations.clear(); }
  canRead() { return this.mutations.size === 0; }
  begin(mutation: boolean): OwnerStatusTicket {
    if (mutation) this.invalidate();
    const ticket = { id: ++this.sequence, generation: this.generation, mutation };
    if (mutation) this.mutations.add(ticket.id);
    return ticket;
  }
  current(ticket: OwnerStatusTicket) { return ticket.generation === this.generation && ticket.id >= this.applied; }
  accept(ticket: OwnerStatusTicket) {
    if (!this.current(ticket)) return false;
    this.applied = ticket.id; return true;
  }
  finish(ticket: OwnerStatusTicket) { this.mutations.delete(ticket.id); }
}
export class OwnerStatusSuperseded extends Error {
  constructor() { super("A newer owner control replaced this status response."); this.name = "OwnerStatusSuperseded"; }
}
