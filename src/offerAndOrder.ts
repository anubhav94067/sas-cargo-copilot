// Connector for the SAS Cargo Offer'n'Order (Mercator) API — live rates and order lookup.
// UAT only; credentials come from env. TLS verification can be relaxed via MERCATOR_INSECURE_TLS.

import https from 'https';
import { URL, URLSearchParams } from 'url';

const BASE = process.env.MERCATOR_BASE_URL || 'https://uatonosk.mercator.com';
const BASIC = process.env.MERCATOR_BASIC || '';
const USER = process.env.MERCATOR_USER || '';
const PASS = process.env.MERCATOR_PASS || '';
const APP_ID = process.env.MERCATOR_APP_ID || 'SK-B2B-INTEG';
const IATA = process.env.MERCATOR_IATA || '17475308001';
const INSECURE = process.env.MERCATOR_INSECURE_TLS === 'true';

export const offerOrderConfigured = Boolean(BASIC && USER && PASS);

export interface LiveOffer {
  offerId?: string;
  route?: string;
  carrier?: string;
  flightNumber?: string;
  journeyTime?: string;
  chargeableWeightKg?: number;
  currency?: string;
  shipByDate: string;
}

interface HttpResult {
  status: number;
  text: string;
}

function request(method: string, url: string, headers: Record<string, string>, body?: string): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        method,
        hostname: u.hostname,
        path: u.pathname + u.search,
        port: 443,
        headers,
        rejectUnauthorized: !INSECURE,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode || 0, text: data }));
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function deepFind(o: unknown, key: string): unknown {
  if (o && typeof o === 'object') {
    if (Array.isArray(o)) {
      for (const item of o) {
        const v = deepFind(item, key);
        if (v !== undefined) return v;
      }
    } else {
      const rec = o as Record<string, unknown>;
      if (key in rec) return rec[key];
      for (const k of Object.keys(rec)) {
        const v = deepFind(rec[k], key);
        if (v !== undefined) return v;
      }
    }
  }
  return undefined;
}

let tokenCache: { token: string; exp: number } | null = null;

async function getToken(): Promise<string> {
  if (tokenCache && tokenCache.exp - Date.now() > 60_000) return tokenCache.token;
  const form = new URLSearchParams({ grant_type: 'password', username: USER, password: PASS }).toString();
  const r = await request(
    'POST',
    `${BASE}/api/uaa/oauth/token`,
    {
      Authorization: `Basic ${BASIC}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Referer: BASE,
      'Content-Length': String(Buffer.byteLength(form)),
    },
    form,
  );
  if (r.status !== 200) throw new Error(`Mercator auth failed: ${r.status}`);
  const j = JSON.parse(r.text) as { access_token: string; expires_in?: number };
  tokenCache = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return j.access_token;
}

function offerBody(p: OfferParams, shipByDate: string): string {
  return JSON.stringify({
    offerFilter: {
      airCapacityFilter: {
        documentInfo: { documentType: 'AWB', documentPrefix: '117', documentNumber: 'UNK' },
        routeInfo: { originInfo: { code: p.origin }, destinationInfo: { code: p.destination } },
        cargoInfo: {
          useAllotment: false,
          quantity: {
            weight: { unit: { code: 'K' }, value: p.weightKg },
            volume: { unit: { code: 'CM' }, value: p.volumeCbm },
            piece: String(p.pieces),
          },
          cargoType: 'F',
          commodityCode: 'E000',
          goodsDescription: (p.commodity || 'GENERAL CARGO').toUpperCase(),
        },
        participantInfo: [{ type: 'AGT', account: [{ type: 'IATA', number: IATA }] }],
        productInfo: { product: { code: 'GEN' } },
        chargeDeclarationInfo: {
          currency: 'DKK',
          mop: { chargeCode: 'PP', weightValuation: 'P', otherCharges: 'P' },
          declaredValue: { carriage: { amount: 0, currency: 'DKK' } },
        },
        scheduleInfo: { shipByDate },
      },
    },
    sortRequest: { sortBy: '1', sortOrder: 'DESC' },
    pageRequest: { page: 1, pageSize: '15' },
  });
}

export interface OfferParams {
  origin: string;
  destination: string;
  weightKg: number;
  volumeCbm: number;
  pieces: number;
  commodity?: string;
  shipByDate?: string;
}

function shipDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const iso = d.toISOString().slice(0, 10);
  return `${iso} 00:00:00`;
}

// Returns the top live offer, retrying nearby ship dates when the schedule has no itineraries.
export async function searchOffers(p: OfferParams): Promise<LiveOffer | null> {
  if (!offerOrderConfigured) return null;
  const token = await getToken();
  const dates = p.shipByDate ? [p.shipByDate] : [shipDate(2), shipDate(3), shipDate(5), shipDate(7)];

  for (const shipByDate of dates) {
    const body = offerBody(p, shipByDate);
    const r = await request(
      'POST',
      `${BASE}/api/offer/services/cargo/v1/offers`,
      {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'app-id': APP_ID,
        'Content-Length': String(Buffer.byteLength(body)),
      },
      body,
    );
    if (r.status !== 200) continue;
    const d = JSON.parse(r.text) as { data?: { offers?: { offer?: unknown[] } } };
    const offers = d.data?.offers?.offer;
    if (!Array.isArray(offers) || offers.length === 0) continue;

    const first = offers[0];
    const itin = deepFind(first, 'itinerary') as Array<{ transportInfo?: { carrier?: string; number?: string } }> | undefined;
    const transport = Array.isArray(itin) ? itin[0]?.transportInfo : undefined;
    const cw = deepFind(first, 'chargeableWeight') as { value?: number } | undefined;
    const journey = deepFind(first, 'journeyTime');

    return {
      offerId: deepFind(first, 'offerId') as string | undefined,
      route: deepFind(first, 'route') as string | undefined,
      carrier: transport?.carrier,
      flightNumber: transport?.number,
      journeyTime: typeof journey === 'string' ? journey.trim() : undefined,
      chargeableWeightKg: typeof cw?.value === 'number' ? cw.value : undefined,
      currency: 'DKK',
      shipByDate,
    };
  }
  return null;
}

export async function fetchOrder(orderId: string): Promise<unknown | null> {
  if (!offerOrderConfigured) return null;
  const token = await getToken();
  const r = await request('GET', `${BASE}/api/order/services/cargo/v1/orders/${encodeURIComponent(orderId)}`, {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'app-id': APP_ID,
  });
  if (r.status !== 200) return null;
  return JSON.parse(r.text);
}

export interface OrderRef {
  orderId: string;
  orderNumber?: string;
  bookingReferenceNumber?: string;
  jobReferenceNumber?: string;
  documentNumber?: string;
  route?: string;
  movementStatus?: string;
}

// Maps an AWB to its order references (replicates the SAS Cargo customer app shipment search).
export async function searchOrderByAwb(awb: string): Promise<OrderRef | null> {
  if (!offerOrderConfigured) return null;
  const token = await getToken();
  const docNo = (awb || '').replace(/[^0-9]/g, '');
  if (!docNo) return null;
  const body = JSON.stringify({
    orderFilter: { airCapacity: { documentNumbers: [docNo], includeItinerary: false } },
    pageRequest: { page: 1, pageSize: 10 },
  });
  const r = await request(
    'POST',
    `${BASE}/api/order/services/cargo/v1/orders/actions/search?view=summary`,
    {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'app-id': APP_ID,
      'Content-Length': String(Buffer.byteLength(body)),
    },
    body,
  );
  if (r.status !== 200) return null;
  const d = JSON.parse(r.text);
  const bref = deepFind(d, 'bookingReferenceNumber');
  if (!bref) return null;
  const ms = deepFind(d, 'movementStatus') as { code?: string } | string | undefined;
  return {
    orderId: `b${bref}`,
    orderNumber: deepFind(d, 'orderNumber') as string | undefined,
    bookingReferenceNumber: String(bref),
    jobReferenceNumber: deepFind(d, 'jobReferenceNumber') as string | undefined,
    documentNumber: deepFind(d, 'documentNumber') as string | undefined,
    route: deepFind(d, 'route') as string | undefined,
    movementStatus: typeof ms === 'object' ? ms?.code : ms,
  };
}
