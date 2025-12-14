/**
 * Format observation keys for display in StateViewer
 */
export function formatObservationKey(
  sectionId: string,
  key: string,
  pcToInstr: Map<number, string>,
): string {
  if (sectionId === "obsMem") {
    const m = key.match(/^(\d+):(.*)$/);
    if (!m) return key;
    const pc = Number(m[1]);
    const addr = m[2];
    const instr = pcToInstr.get(pc);
    if (instr && instr.length > 0) {
      return `${pc}: ${instr} [addr=${addr}]`;
    }
    return `pc=${pc} addr=${addr}`;
  }

  if (sectionId === "obsCtrl") {
    const m = key.match(/^(\d+)(?::target:(.*))?$/);
    if (!m) return key;
    const pc = Number(m[1]);
    const extra = m[2];
    const instr = pcToInstr.get(pc);
    if (instr && instr.length > 0) {
      return extra ? `${pc}: ${instr} [target=${extra}]` : `${pc}: ${instr}`;
    }
    return extra ? `pc=${pc} target=${extra}` : `pc=${pc}`;
  }

  return key;
}
