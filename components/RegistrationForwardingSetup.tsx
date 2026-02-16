import { useState } from 'react';
import { CheckCircleIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline';

interface RegistrationForwardingSetupProps {
  forwardingEmail: string;
}

export default function RegistrationForwardingSetup({ forwardingEmail }: RegistrationForwardingSetupProps) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(forwardingEmail);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-white shadow sm:rounded-lg">
      <div className="px-4 py-5 sm:p-6">
        <h3 className="text-lg font-medium leading-6 text-gray-900">Set Up Registration Receipt Forwarding</h3>
        <div className="mt-2 max-w-xl text-sm text-gray-500">
          <p>
            Forward city sticker and license plate purchase emails so we can keep proof that you purchased on time.
          </p>
        </div>

        <div className="mt-5 rounded-md bg-blue-50 p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <CheckCircleIcon className="h-5 w-5 text-blue-400" aria-hidden="true" />
            </div>
            <div className="ml-3 flex-1">
              <h3 className="text-sm font-medium text-blue-800">Your Registration Forwarding Address</h3>
              <div className="mt-2 text-sm text-blue-700">
                <div className="flex items-center gap-2">
                  <code className="rounded bg-blue-100 px-2 py-1 font-mono text-xs break-all">
                    {forwardingEmail}
                  </code>
                  <button
                    onClick={copyToClipboard}
                    className="inline-flex items-center rounded-md bg-blue-600 px-2 py-1 text-xs font-semibold text-white shadow-sm hover:bg-blue-500"
                  >
                    {copied ? (
                      <>
                        <CheckCircleIcon className="h-4 w-4 mr-1" />
                        Copied!
                      </>
                    ) : (
                      <>
                        <ClipboardDocumentIcon className="h-4 w-4 mr-1" />
                        Copy
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-lg border border-gray-200 p-4">
          <h4 className="text-sm font-semibold text-gray-900">4 quick steps (about 2 minutes)</h4>
          <ol className="mt-3 list-decimal list-inside space-y-3 text-sm text-gray-700">
            <li>
              Copy your forwarding address above
            </li>
            <li>
              In Gmail, search for <code className="bg-gray-100 px-2 py-0.5 rounded">chicagovehiclestickers@sebis.com</code>
            </li>
            <li>
              Click the filter icon &rarr; <strong>Create filter</strong> &rarr; <strong>Forward it to</strong> your address
            </li>
            <li>
              Repeat for <code className="bg-gray-100 px-2 py-0.5 rounded">ecommerce@ilsos.gov</code>
            </li>
          </ol>
          <p className="mt-3 text-xs text-gray-500">
            That's it! If you get ticketed before your sticker is applied, these receipts become your contest evidence. You can do this later — just bookmark this page.
          </p>
        </div>
      </div>
    </div>
  );
}
