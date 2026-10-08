// Small formatting helpers shared by /shipped's sponsor desk, refund policy, admin card and the Worker.
// (Printed receipts themselves are "Shipped in <year>" receipts: lib/shipped-year.ts.)

export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
