import { useState } from 'react';
import { CheckCircleIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline';

interface RegistrationForwardingSetupProps {
  forwardingEmail: string;
  /** Compact mode for embedding in /start funnel or /settings card */
  compact?: boolean;
}

const CITY_STICKER_SENDER = 'chicagovehiclestickers@sebis.com';
const PLATE_STICKER_SENDER = 'ecommerce@ilsos.gov';

type EmailProvider = 'gmail' | 'outlook' | 'yahoo' | 'apple' | null;

export default function RegistrationForwardingSetup({ forwardingEmail, compact }: RegistrationForwardingSetupProps) {
  const [copied, setCopied] = useState(false);
  const [provider, setProvider] = useState<EmailProvider>(null);

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(forwardingEmail);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const containerClass = compact
    ? ''
    : 'bg-white shadow sm:rounded-lg';

  const innerClass = compact
    ? ''
    : 'px-4 py-5 sm:p-6';

  return (
    <div className={containerClass}>
      <div className={innerClass}>
        {!compact && (
          <>
            <h3 className="text-lg font-medium leading-6 text-gray-900">Set Up Receipt Forwarding</h3>
            <div className="mt-2 max-w-xl text-sm text-gray-500">
              <p>
                Auto-forward your city sticker and plate sticker purchase emails so we have your receipt on file if you ever get ticketed.
              </p>
            </div>
          </>
        )}

        {/* Forwarding address + copy */}
        <div className={compact ? 'rounded-md bg-blue-50 p-3' : 'mt-5 rounded-md bg-blue-50 p-4'}>
          <div className="flex items-start gap-3">
            <CheckCircleIcon className="h-5 w-5 text-blue-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-blue-800">Your forwarding address</p>
              <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                <code className="rounded bg-blue-100 px-2 py-1 font-mono text-xs break-all text-blue-900">
                  {forwardingEmail}
                </code>
                <button
                  onClick={copyToClipboard}
                  className="inline-flex items-center rounded-md bg-blue-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm hover:bg-blue-500 flex-shrink-0"
                >
                  {copied ? (
                    <>
                      <CheckCircleIcon className="h-3.5 w-3.5 mr-1" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <ClipboardDocumentIcon className="h-3.5 w-3.5 mr-1" />
                      Copy
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Provider picker */}
        <div className={compact ? 'mt-4' : 'mt-6'}>
          <p className="text-sm font-semibold text-gray-900 mb-3">
            Choose your email provider for step-by-step instructions:
          </p>
          <div className="flex flex-wrap gap-2">
            {([
              { id: 'gmail' as const, label: 'Gmail', color: 'red' },
              { id: 'outlook' as const, label: 'Outlook', color: 'blue' },
              { id: 'yahoo' as const, label: 'Yahoo', color: 'purple' },
              { id: 'apple' as const, label: 'Apple Mail', color: 'gray' },
            ] as const).map(p => (
              <button
                key={p.id}
                onClick={() => setProvider(provider === p.id ? null : p.id)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${
                  provider === p.id
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400 hover:text-blue-600'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Provider-specific instructions */}
        {provider === 'gmail' && (
          <GmailInstructions forwardingEmail={forwardingEmail} />
        )}
        {provider === 'outlook' && (
          <OutlookInstructions forwardingEmail={forwardingEmail} />
        )}
        {provider === 'yahoo' && (
          <YahooInstructions forwardingEmail={forwardingEmail} />
        )}
        {provider === 'apple' && (
          <AppleMailInstructions forwardingEmail={forwardingEmail} />
        )}

        {/* Fallback option */}
        <div className={`${compact ? 'mt-4' : 'mt-6'} rounded-lg border border-amber-200 bg-amber-50 p-3`}>
          <p className="text-sm font-medium text-amber-900">
            Don&apos;t want to set up a filter right now?
          </p>
          <p className="mt-1 text-xs text-amber-800">
            No problem. If you ever get a sticker or plates ticket, we&apos;ll email you and ask you to forward the receipt then. The filter just saves you a step later.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── Gmail instructions ── */
function GmailInstructions({ forwardingEmail }: { forwardingEmail: string }) {
  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4 space-y-4">
      <h4 className="text-sm font-bold text-gray-900">Gmail — City Sticker Receipt Filter</h4>

      <div className="space-y-3">
        <Step n={1}>
          <p>Open Gmail and click the <strong>search bar</strong> at the top</p>
        </Step>
        <Step n={2}>
          <p>
            Type <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">from:{CITY_STICKER_SENDER}</code> and press Enter
          </p>
          <p className="text-xs text-gray-500 mt-1">
            This finds all your city sticker purchase emails
          </p>
        </Step>
        <Step n={3}>
          <p>
            Click the <strong>filter icon</strong> (small sliders/triangle) in the search bar, then click <strong>&quot;Create filter&quot;</strong> at the bottom
          </p>
        </Step>
        <Step n={4}>
          <p>
            Check <strong>&quot;Forward it to:&quot;</strong> and paste your forwarding address:
          </p>
          <code className="block mt-1 bg-blue-50 px-2 py-1 rounded text-xs font-mono text-blue-900 break-all">
            {forwardingEmail}
          </code>
          <p className="text-xs text-gray-500 mt-1">
            If the address isn&apos;t in the dropdown yet, click &quot;Add forwarding address&quot; and Gmail will send a verification email — we confirm it automatically.
          </p>
        </Step>
        <Step n={5}>
          <p>Click <strong>&quot;Create filter&quot;</strong> — done!</p>
        </Step>
      </div>

      <div className="border-t border-gray-100 pt-3">
        <p className="text-xs text-gray-600">
          <strong>Optional:</strong> Repeat for plate sticker emails from{' '}
          <code className="bg-gray-100 px-1 py-0.5 rounded">{PLATE_STICKER_SENDER}</code>
        </p>
      </div>
    </div>
  );
}

/* ── Outlook instructions ── */
function OutlookInstructions({ forwardingEmail }: { forwardingEmail: string }) {
  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4 space-y-4">
      <h4 className="text-sm font-bold text-gray-900">Outlook — City Sticker Receipt Rule</h4>

      <div className="space-y-3">
        <Step n={1}>
          <p>Open Outlook and go to <strong>Settings</strong> (gear icon) &rarr; <strong>Mail</strong> &rarr; <strong>Rules</strong></p>
        </Step>
        <Step n={2}>
          <p>Click <strong>&quot;Add new rule&quot;</strong></p>
        </Step>
        <Step n={3}>
          <p>
            Name it <strong>&quot;City Sticker Receipts&quot;</strong>
          </p>
        </Step>
        <Step n={4}>
          <p>
            Under condition, select <strong>&quot;From&quot;</strong> and enter:
          </p>
          <code className="block mt-1 bg-gray-100 px-2 py-1 rounded text-xs">{CITY_STICKER_SENDER}</code>
        </Step>
        <Step n={5}>
          <p>
            Under action, select <strong>&quot;Forward to&quot;</strong> and paste:
          </p>
          <code className="block mt-1 bg-blue-50 px-2 py-1 rounded text-xs font-mono text-blue-900 break-all">
            {forwardingEmail}
          </code>
        </Step>
        <Step n={6}>
          <p>Click <strong>&quot;Save&quot;</strong> — done!</p>
        </Step>
      </div>

      <div className="border-t border-gray-100 pt-3">
        <p className="text-xs text-gray-600">
          <strong>Optional:</strong> Create another rule for plate sticker emails from{' '}
          <code className="bg-gray-100 px-1 py-0.5 rounded">{PLATE_STICKER_SENDER}</code>
        </p>
      </div>
    </div>
  );
}

/* ── Yahoo instructions ── */
function YahooInstructions({ forwardingEmail }: { forwardingEmail: string }) {
  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4 space-y-4">
      <h4 className="text-sm font-bold text-gray-900">Yahoo Mail — City Sticker Receipt Filter</h4>

      <div className="space-y-3">
        <Step n={1}>
          <p>Open Yahoo Mail and click <strong>Settings</strong> (gear icon) &rarr; <strong>More Settings</strong></p>
        </Step>
        <Step n={2}>
          <p>Click <strong>&quot;Filters&quot;</strong> in the left menu, then <strong>&quot;Add new filters&quot;</strong></p>
        </Step>
        <Step n={3}>
          <p>
            Name it <strong>&quot;City Sticker Receipts&quot;</strong>
          </p>
        </Step>
        <Step n={4}>
          <p>
            Set <strong>&quot;From&quot;</strong> contains:
          </p>
          <code className="block mt-1 bg-gray-100 px-2 py-1 rounded text-xs">{CITY_STICKER_SENDER}</code>
        </Step>
        <Step n={5}>
          <p>
            Under &quot;Then move the email to&quot;, Yahoo doesn&apos;t support auto-forward via filters. Instead, set up <strong>full forwarding</strong>:
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Go to Settings &rarr; More Settings &rarr; Mailboxes &rarr; Your Yahoo account &rarr; Forwarding, and add your forwarding address. Then use the filter to label sticker emails for organization.
          </p>
          <p className="text-xs text-amber-700 mt-1 font-medium">
            Or simply forward the receipt email manually when we ask for it (we&apos;ll remind you if you get ticketed).
          </p>
        </Step>
      </div>
    </div>
  );
}

/* ── Apple Mail instructions ── */
function AppleMailInstructions({ forwardingEmail }: { forwardingEmail: string }) {
  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4 space-y-4">
      <h4 className="text-sm font-bold text-gray-900">Apple Mail (iCloud) — City Sticker Receipt Rule</h4>

      <div className="space-y-3">
        <Step n={1}>
          <p>
            <strong>On Mac:</strong> Open Mail &rarr; <strong>Settings</strong> &rarr; <strong>Rules</strong> tab &rarr; <strong>&quot;Add Rule&quot;</strong>
          </p>
          <p className="text-xs text-gray-500 mt-1">
            <strong>On iCloud.com:</strong> Go to Mail &rarr; Settings (gear) &rarr; Rules &rarr; &quot;Add a Rule&quot;
          </p>
        </Step>
        <Step n={2}>
          <p>
            Set condition: <strong>&quot;From&quot;</strong> contains
          </p>
          <code className="block mt-1 bg-gray-100 px-2 py-1 rounded text-xs">{CITY_STICKER_SENDER}</code>
        </Step>
        <Step n={3}>
          <p>
            Set action: <strong>&quot;Forward to&quot;</strong>
          </p>
          <code className="block mt-1 bg-blue-50 px-2 py-1 rounded text-xs font-mono text-blue-900 break-all">
            {forwardingEmail}
          </code>
        </Step>
        <Step n={4}>
          <p>Click <strong>&quot;OK&quot;</strong> / <strong>&quot;Done&quot;</strong> — done!</p>
        </Step>
      </div>

      <div className="border-t border-gray-100 pt-3">
        <p className="text-xs text-gray-600">
          <strong>Note:</strong> Apple Mail rules on Mac only run when Mail is open. For always-on forwarding, set the rule on iCloud.com instead.
        </p>
      </div>
    </div>
  );
}

/* ── Shared Step component ── */
function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center mt-0.5">
        {n}
      </span>
      <div className="text-sm text-gray-700 flex-1">
        {children}
      </div>
    </div>
  );
}
