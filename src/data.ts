export interface ShipmentRecord {
  awb: string;
  customerName: string;
  airline: string;
  orig: string;
  dest: string;
  flightNumber: string;
  status: 'BKD' | 'RCF' | 'DEP' | 'ARR' | 'DLV';
  droppedUtc: string;
  etaUtc: string;
  weightKg: number;
  bookedAmount: number;
  currency: string;
  position: string;
}

export const HACKATHON_SHIPMENTS: Record<string, ShipmentRecord> = {
  "117-39000001": {
    awb: "117-39000001",
    customerName: "12093USATLBR1",
    airline: "SK",
    orig: "ATL",
    dest: "MMX",
    flightNumber: "SK5001",
    status: "BKD",
    droppedUtc: "2026-09-01 08:20",
    etaUtc: "2026-09-02 03:20",
    weightKg: 103.5,
    bookedAmount: 398.25,
    currency: "NOK",
    position: "MMX"
  },
  "117-39000002": {
    awb: "117-39000002",
    customerName: "JETLHNOOSLBR1",
    airline: "LH",
    orig: "ARN",
    dest: "CPH",
    flightNumber: "LH702",
    status: "RCF",
    droppedUtc: "2026-09-01 08:40",
    etaUtc: "2026-09-02 04:40",
    weightKg: 127.0,
    bookedAmount: 546.50,
    currency: "SEK",
    position: "CPH"
  },
  "117-39000006": {
    awb: "117-39000006",
    customerName: "11336SESTOBR1",
    airline: "SK",
    orig: "ARN",
    dest: "ATL",
    flightNumber: "SK5006",
    status: "BKD",
    droppedUtc: "2026-09-01 10:00",
    etaUtc: "2026-09-02 10:00",
    weightKg: 221.0,
    bookedAmount: 1139.50,
    currency: "SEK",
    position: "ATL"
  },
  "117-39000011": {
    awb: "117-39000011",
    customerName: "14032DESTRBR1",
    airline: "SK",
    orig: "ARN",
    dest: "EWR",
    flightNumber: "SK5011",
    status: "BKD",
    droppedUtc: "2026-09-01 11:40",
    etaUtc: "2026-09-02 16:40",
    weightKg: 333.5,
    bookedAmount: 1802.00,
    currency: "EUR",
    position: "EWR"
  }
};