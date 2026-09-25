// Loads the cargo shipment dataset (pipe-delimited) and looks up live tracking by AWB.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = process.env.CARGO_DATA_PATH || path.join(moduleDir, '../data/cargo_data.txt');

export interface Shipment {
  awb: string;
  airline: string;
  flightNumber: string;
  origin: string;
  destination: string;
  bookingStatus: string;
  movementStatus: string;
  pieces: number;
  weightKg: number;
  expectedOrActualArrival: string;
  lat: string;
  toa: string;
  bookedAmount: number;
  specialHandling: string;
  customerName: string;
  customerCountry: string;
  irregularityCount: number;
  irregularityCodes: string;
  cancelReasonCode: string;
  cancelRemark: string;
  lastDepartureStation: string;
}

export interface ShipmentException {
  flagged: boolean;
  severity: 'high' | 'medium' | 'low';
  codes: string;
  description: string;
  remark?: string;
}

const IRR_DESC: Record<string, string> = {
  DIMNOTCAPT: 'Dimensions not captured',
  AWBSBHRIRR: 'Shipment handling irregularity',
  EUCSTMHOLD: 'EU customs hold',
  CWTMISMTCH: 'Chargeable weight mismatch',
};

const CNCL_DESC: Record<string, string> = {
  MX: 'Administrative update',
  CT: 'Cargo rebooked (not on the planned flight)',
};

const MILESTONE: Record<string, string> = {
  BKD: 'Booked',
  RCS: 'Received from Shipper',
  RCF: 'Received from Flight (transfer)',
  DEP: 'Departed',
  ARR: 'Arrived',
  DLV: 'Delivered',
};

let index: Map<string, Shipment> | null = null;

export function normalizeAwb(awb: string): string {
  return (awb || '').replace(/[^0-9]/g, '');
}

function load(): Map<string, Shipment> {
  if (index) return index;
  index = new Map();
  try {
    const text = fs.readFileSync(DATA_PATH, 'utf8');
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const headers = lines[0].split('|');
    const col = (name: string) => headers.indexOf(name);
    const idx = {
      awb: col('airwaybill_no'),
      airline: col('airline'),
      flight: col('flight_number'),
      origin: col('origin'),
      destination: col('destination'),
      booking: col('booking_status'),
      movement: col('movement_status_code'),
      pieces: col('pieces'),
      weight: col('cargo_weight'),
      arrival: col('expected_or_actual_arrival'),
      lat: col('LAT'),
      toa: col('TOA'),
      amount: col('booked_amount'),
      special: col('SpecialHandlingCode'),
      customer: col('customer_name'),
      country: col('customer_country'),
      irrCount: col('irregularity_count'),
      irrCodes: col('irregularity_codes'),
      cnclCode: col('CNCL_RSN_CODE'),
      cnclRmk: col('CNCL_RMK'),
      lastDep: col('LastDepartureStationCode'),
    };
    for (let i = 1; i < lines.length; i++) {
      const f = lines[i].split('|');
      const awb = f[idx.awb];
      if (!awb) continue;
      index.set(normalizeAwb(awb), {
        awb,
        airline: f[idx.airline],
        flightNumber: f[idx.flight],
        origin: f[idx.origin],
        destination: f[idx.destination],
        bookingStatus: f[idx.booking],
        movementStatus: f[idx.movement],
        pieces: Number(f[idx.pieces]) || 0,
        weightKg: Number(f[idx.weight]) || 0,
        expectedOrActualArrival: f[idx.arrival],
        lat: f[idx.lat],
        toa: f[idx.toa],
        bookedAmount: Number(f[idx.amount]) || 0,
        specialHandling: f[idx.special],
        customerName: f[idx.customer],
        customerCountry: f[idx.country],
        irregularityCount: Number(f[idx.irrCount]) || 0,
        irregularityCodes: f[idx.irrCodes] === 'NULL' ? '' : f[idx.irrCodes],
        cancelReasonCode: f[idx.cnclCode] === 'NULL' ? '' : f[idx.cnclCode],
        cancelRemark: f[idx.cnclRmk] === 'NULL' ? '' : f[idx.cnclRmk],
        lastDepartureStation: f[idx.lastDep],
      });
    }
    console.log(`Loaded ${index.size} shipments from cargo dataset.`);
  } catch (error) {
    console.error('Failed to load cargo dataset:', error);
  }
  return index;
}

export const cargoDataConfigured = fs.existsSync(DATA_PATH);

export function lookupShipment(awb: string): Shipment | null {
  return load().get(normalizeAwb(awb)) || null;
}

export function extractAwb(text: string): string | null {
  const m = (text || '').match(/117-?\d{8}/);
  return m ? m[0] : null;
}

// Detects a shipment exception (irregularity or rebooking/cancellation) for red-flag alerts.
export function shipmentException(s: Shipment): ShipmentException | null {
  const irrCodes = s.irregularityCount > 0 && s.irregularityCodes
    ? s.irregularityCodes.split(/[,;]/).map((c) => c.trim()).filter(Boolean)
    : [];
  const hasCancel = Boolean(s.cancelReasonCode);
  if (irrCodes.length === 0 && !hasCancel) return null;

  const parts = irrCodes.map((c) => IRR_DESC[c] || c);
  if (s.cancelReasonCode) parts.push(CNCL_DESC[s.cancelReasonCode] || s.cancelReasonCode);

  const high = irrCodes.some((c) => c === 'EUCSTMHOLD' || c === 'AWBSBHRIRR') || s.cancelReasonCode === 'CT';
  const severity: ShipmentException['severity'] = high ? 'high' : irrCodes.length ? 'medium' : 'low';

  return {
    flagged: true,
    severity,
    codes: [s.irregularityCodes, s.cancelReasonCode].filter((c) => c).join(', '),
    description: parts.join('; ') || 'Exception on shipment',
    remark: s.cancelRemark || undefined,
  };
}

// Grounding line fed to the agent as INTERNAL CMS DATA.
export function shipmentSummary(s: Shipment): string {
  const milestone = MILESTONE[s.movementStatus] || s.movementStatus;
  const exc = shipmentException(s);
  const irr = exc ? ` EXCEPTION (${exc.severity}): ${exc.description}${exc.remark ? ' — ' + exc.remark : ''}.` : '';
  return (
    `CMS tracking for AWB ${s.awb}: ${s.origin}-${s.destination} on ${s.airline}${s.flightNumber}, ` +
    `${s.pieces} pcs / ${s.weightKg} kg. Latest milestone ${s.movementStatus} (${milestone}); ` +
    `last departure station ${s.lastDepartureStation}. LAT ${s.lat}, TOA ${s.toa}. ` +
    `Customer ${s.customerName} (${s.customerCountry}), special handling ${s.specialHandling || 'none'}.${irr}`
  );
}
