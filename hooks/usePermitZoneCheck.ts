import { useState, useCallback } from 'react';

export interface PermitZone {
  zone: string;
  status: string;
  addressRange: string;
  ward: string;
}

export interface PermitZoneCheckResult {
  hasPermitZone: boolean;
  zones: PermitZone[];
  parsedAddress: {
    number: number;
    direction: string | null;
    name: string;
    type: string | null;
  } | null;
  error?: string;
}

export function usePermitZoneCheck() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PermitZoneCheckResult | null>(null);

  const checkAddress = useCallback(async (address: string) => {
    if (!address || address.trim().length === 0) {
      setResult(null);
      return null;
    }

    setLoading(true);

    try {
      const response = await fetch(`/api/check-permit-zone?address=${encodeURIComponent(address)}`);

      if (!response.ok) {
        throw new Error('Failed to check permit zone');
      }

      const data: PermitZoneCheckResult = await response.json();
      setResult(data);
      return data;

    } catch (error: any) {
      console.error('Error checking permit zone:', error);
      const errorResult: PermitZoneCheckResult = {
        hasPermitZone: false,
        zones: [],
        parsedAddress: null,
        error: error.message
      };
      setResult(errorResult);
      return errorResult;

    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setResult(null);
  }, []);

  return {
    checkAddress,
    clear,
    loading,
    result,
    hasPermitZone: result?.hasPermitZone || false,
    zones: result?.zones || []
  };
}
