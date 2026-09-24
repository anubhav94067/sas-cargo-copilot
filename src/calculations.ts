// Mock of the SAS Cargo contribution-model /calculations API.
// Chargeable weight mirrors the real rule (cargo-contribution-model calculation.controller.ts).
// Cost/margin figures are PLACEHOLDER rates — swap in the real API via CALCULATIONS_API_URL.

export interface CalcInput {
  weightKg: number;
  volumeCbm: number;
  ratePerKg?: number | null;
  currency?: string;
  rfs?: boolean;
}

export interface CalcResult {
  source: 'mock' | 'api';
  chargeableWeightKg: number;
  currency: string;
  estimatedCosts: { fuelAndSecurity: number; handling: number; trucking: number; total: number };
  suggestedMinRatePerKg: number;
  approvalMarginPct: number;
  quote?: {
    ratePerKg: number;
    revenue: number;
    contribution: number;
    contributionMarginPct: number;
    approved: boolean;
  };
  note: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

const APPROVAL_MARGIN = Number(process.env.CALC_APPROVAL_MARGIN || 0.15);
const FUEL_SEC_PER_KG = Number(process.env.CALC_FUEL_SEC_PER_KG || 0.25);
const HANDLING_PER_KG = Number(process.env.CALC_HANDLING_PER_KG || 0.2);
const HANDLING_MIN = Number(process.env.CALC_HANDLING_MIN || 100);
const RFS_PER_KG = Number(process.env.CALC_RFS_PER_KG || 0.15);

// Real SAS Cargo volumetric rule: light/bulky uses volume x 166.66 (floor 167), else actual weight.
export function chargeableWeight(weightKg: number, volumeCbm: number): number {
  if (volumeCbm <= 0) return weightKg;
  if (weightKg / volumeCbm < 166.66) {
    const cw = volumeCbm * 166.66;
    return cw < 167 ? 167 : cw;
  }
  return weightKg;
}

export function mockCalculate(input: CalcInput): CalcResult {
  const cw = round2(chargeableWeight(input.weightKg, input.volumeCbm));
  const currency = input.currency || 'EUR';

  const fuelAndSecurity = round2(cw * FUEL_SEC_PER_KG);
  const handling = round2(Math.max(cw * HANDLING_PER_KG, HANDLING_MIN));
  const trucking = input.rfs ? round2(cw * RFS_PER_KG) : 0;
  const total = round2(fuelAndSecurity + handling + trucking);

  // Rate so that (revenue - cost) / revenue >= APPROVAL_MARGIN, revenue = cw * rate.
  const suggestedMinRatePerKg = round2(total / (cw * (1 - APPROVAL_MARGIN)));

  const result: CalcResult = {
    source: 'mock',
    chargeableWeightKg: cw,
    currency,
    estimatedCosts: { fuelAndSecurity, handling, trucking, total },
    suggestedMinRatePerKg,
    approvalMarginPct: APPROVAL_MARGIN,
    note: 'MOCK contribution engine (not the production /calculations API). Chargeable weight uses the real 166.66 volumetric rule; cost rates are placeholders.',
  };

  if (input.ratePerKg != null && input.ratePerKg > 0) {
    const revenue = round2(cw * input.ratePerKg);
    const contribution = round2(revenue - total);
    const contributionMarginPct = revenue > 0 ? round4(contribution / revenue) : 0;
    result.quote = {
      ratePerKg: input.ratePerKg,
      revenue,
      contribution,
      contributionMarginPct,
      approved: contributionMarginPct >= APPROVAL_MARGIN,
    };
  }

  return result;
}

// Calls the real API when CALCULATIONS_API_URL is set; otherwise returns the mock.
export async function getCalculation(input: CalcInput): Promise<CalcResult> {
  const apiUrl = process.env.CALCULATIONS_API_URL;
  if (apiUrl) {
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.CALCULATIONS_API_KEY ? { 'api-key': process.env.CALCULATIONS_API_KEY } : {}),
        },
        body: JSON.stringify({
          weightInKgs: input.weightKg,
          volume: input.volumeCbm,
          ratePerKg: input.ratePerKg ?? undefined,
          providedCurrency: input.currency || 'EUR',
          outputCurrency: input.currency || 'EUR',
          ULD: 'No',
          numberOfUnits: 0,
        }),
      });
      if (response.ok) {
        const data = (await response.json()) as Partial<CalcResult>;
        return { ...mockCalculate(input), ...data, source: 'api' };
      }
      console.error('Calculations API error:', response.status);
    } catch (error) {
      console.error('Calculations API failed, using mock:', error);
    }
  }
  return mockCalculate(input);
}
