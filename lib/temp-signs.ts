export interface TempSignPermit {
  id: string;
  applicationNumber: string;
  name: string | null;
  workType: string | null;
  status: string | null;
  startDate: string;
  endDate: string;
  streetNumberFrom: number | null;
  streetNumberTo: number | null;
  direction: string | null;
  streetName: string | null;
  suffix: string | null;
  ward: string | null;
  latitude: number;
  longitude: number;
  streetClosure: string | null;
  meterBagging: boolean;
  comments: string | null;
}

export function isActive(p: TempSignPermit, nowMs: number = Date.now()): boolean {
  const start = new Date(p.startDate).getTime();
  const end = new Date(p.endDate).getTime();
  return nowMs >= start && nowMs <= end;
}

export function addressLine(p: TempSignPermit): string {
  const range =
    p.streetNumberFrom && p.streetNumberTo && p.streetNumberFrom !== p.streetNumberTo
      ? `${p.streetNumberFrom}–${p.streetNumberTo}`
      : p.streetNumberFrom?.toString() || '';
  const parts = [range, p.direction, p.streetName, p.suffix].filter(Boolean);
  return parts.join(' ').trim() || 'Chicago';
}
