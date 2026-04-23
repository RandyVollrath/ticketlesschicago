import { useCallback, useEffect, useRef, useState } from 'react';

export interface AddressComponents {
  street: string;
  city: string;
  state: string;
  zip: string;
  formatted: string;
  lat: number | null;
  lng: number | null;
  place_id: string;
}

interface Prediction {
  place_id: string;
  description: string;
  structured_formatting?: {
    main_text: string;
    secondary_text: string;
  };
}

export interface AddressAutocompleteProps {
  value: string;
  onChange: (raw: string) => void;
  onSelect: (address: AddressComponents) => void;
  placeholder?: string;
  biasChicago?: boolean;
  disabled?: boolean;
  style?: React.CSSProperties;
  className?: string;
  inputRef?: React.Ref<HTMLInputElement>;
  onBlur?: () => void;
  autoComplete?: string;
  id?: string;
  name?: string;
  // Allow the parent to style the dropdown container
  dropdownStyle?: React.CSSProperties;
  // If true, pressing Enter when no suggestion is highlighted falls through
  // to the parent's submit handler
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

function newSessionToken(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  placeholder,
  biasChicago = true,
  disabled = false,
  style,
  className,
  inputRef,
  onBlur,
  autoComplete = 'off',
  id,
  name,
  dropdownStyle,
  onKeyDown,
}: AddressAutocompleteProps) {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [loading, setLoading] = useState(false);
  const sessionRef = useRef<string>(newSessionToken());
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const justSelectedRef = useRef(false);

  // Fetch predictions (debounced)
  const fetchPredictions = useCallback(
    async (q: string) => {
      if (!q || q.trim().length < 3) {
        setPredictions([]);
        setOpen(false);
        return;
      }
      setLoading(true);
      try {
        const params = new URLSearchParams({
          input: q,
          session: sessionRef.current,
        });
        if (biasChicago) params.set('bias', 'chicago');
        const res = await fetch(`/api/google/places-autocomplete?${params.toString()}`);
        if (!res.ok) {
          setPredictions([]);
          setOpen(false);
          return;
        }
        const data = await res.json();
        const list: Prediction[] = Array.isArray(data.predictions) ? data.predictions : [];
        setPredictions(list);
        setOpen(list.length > 0);
        setActiveIdx(-1);
      } finally {
        setLoading(false);
      }
    },
    [biasChicago],
  );

  // Debounce the user's typing
  useEffect(() => {
    if (justSelectedRef.current) {
      justSelectedRef.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchPredictions(value);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, fetchPredictions]);

  // Outside-click closes the dropdown
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selectPrediction = useCallback(
    async (p: Prediction) => {
      setOpen(false);
      setPredictions([]);
      setActiveIdx(-1);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      try {
        const params = new URLSearchParams({
          place_id: p.place_id,
          session: sessionRef.current,
        });
        const res = await fetch(`/api/google/places-details?${params.toString()}`);
        if (!res.ok) return;
        const data = (await res.json()) as AddressComponents;
        justSelectedRef.current = true;
        onChange(data.street || p.description);
        onSelect(data);
      } catch {
        // Swallow — user can retype and try again
      } finally {
        // New session for the next address lookup
        sessionRef.current = newSessionToken();
      }
    },
    [onChange, onSelect],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (open && predictions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, predictions.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, -1));
        return;
      }
      if (e.key === 'Enter' && activeIdx >= 0) {
        e.preventDefault();
        selectPrediction(predictions[activeIdx]);
        return;
      }
      if (e.key === 'Escape') {
        setOpen(false);
        return;
      }
    }
    onKeyDown?.(e);
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }} className={className}>
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          if (predictions.length > 0) setOpen(true);
        }}
        onBlur={() => {
          // Delay so click on a suggestion can fire first
          setTimeout(() => onBlur?.(), 120);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete={autoComplete}
        style={style}
      />
      {open && predictions.length > 0 && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            boxShadow: '0 10px 20px rgba(0,0,0,0.08)',
            zIndex: 50,
            maxHeight: 280,
            overflowY: 'auto',
            ...dropdownStyle,
          }}
        >
          {predictions.map((p, i) => {
            const active = i === activeIdx;
            const main = p.structured_formatting?.main_text || p.description;
            const secondary = p.structured_formatting?.secondary_text || '';
            return (
              <button
                key={p.place_id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus on input
                  selectPrediction(p);
                }}
                onMouseEnter={() => setActiveIdx(i)}
                role="option"
                aria-selected={active}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 14px',
                  background: active ? '#f1f5f9' : '#fff',
                  border: 'none',
                  borderBottom: '1px solid #f1f5f9',
                  cursor: 'pointer',
                  fontSize: 14,
                  fontFamily: 'inherit',
                  color: '#111827',
                }}
              >
                <div style={{ fontWeight: 500 }}>{main}</div>
                {secondary && (
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{secondary}</div>
                )}
              </button>
            );
          })}
        </div>
      )}
      {loading && predictions.length === 0 && value.trim().length >= 3 && (
        <div
          style={{
            position: 'absolute',
            right: 12,
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: 12,
            color: '#9ca3af',
            pointerEvents: 'none',
          }}
        >
          …
        </div>
      )}
    </div>
  );
}
