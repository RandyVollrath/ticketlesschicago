/**
 * Email Forwarding Setup Component
 *
 * Displays user's unique forwarding address and step-by-step instructions
 * for setting up automatic bill forwarding from utility providers.
 */

import { useState } from 'react'
import { CheckCircleIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline'

interface EmailForwardingSetupProps {
  forwardingEmail: string
}

export default function EmailForwardingSetup({ forwardingEmail }: EmailForwardingSetupProps) {
  const [copied, setCopied] = useState(false)

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(forwardingEmail)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div id="email-forwarding" className="bg-white shadow sm:rounded-lg">
      <div className="px-4 py-5 sm:p-6">
        <h3 className="text-lg font-medium leading-6 text-gray-900">
          Set Up Automatic Bill Forwarding
        </h3>
        <div className="mt-2 max-w-xl text-sm text-gray-500">
          <p>
            Forward your monthly utility bills automatically so we always have your most recent proof of residency.
          </p>
        </div>

        {/* Forwarding Email Address */}
        <div className="mt-5">
          <div className="rounded-md bg-blue-50 p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <CheckCircleIcon className="h-5 w-5 text-blue-400" aria-hidden="true" />
              </div>
              <div className="ml-3 flex-1">
                <h3 className="text-sm font-medium text-blue-800">Your Forwarding Address</h3>
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
        </div>

        {/* Setup Instructions */}
        <div className="mt-6">
          <h4 className="text-sm font-medium text-gray-900 mb-3">Setup Instructions</h4>

          <div className="space-y-4">
            {/* ComEd Instructions */}
            <details className="group border border-gray-200 rounded-lg">
              <summary className="cursor-pointer px-4 py-3 font-medium text-gray-900 hover:bg-gray-50">
                ComEd (Commonwealth Edison)
              </summary>
              <div className="px-4 pb-4 pt-2 text-sm text-gray-600 space-y-2">
                <p className="font-medium text-gray-700">Step 1: Open Gmail and search for ComEd emails</p>
                <p>Search for: <code className="bg-gray-100 px-2 py-0.5 rounded">from:@comed.com</code></p>

                <p className="font-medium text-gray-700 mt-3">Step 2: Create a filter</p>
                <ol className="list-decimal list-inside space-y-1 ml-2">
                  <li>Click the search options dropdown (Show search options)</li>
                  <li>Enter <code className="bg-gray-100 px-2 py-0.5 rounded">@comed.com</code> in the "From" field</li>
                  <li>Enter <code className="bg-gray-100 px-2 py-0.5 rounded">bill OR statement</code> in "Has the words" field</li>
                  <li>Click "Create filter"</li>
                </ol>

                <p className="font-medium text-gray-700 mt-3">Step 3: Set up forwarding</p>
                <ol className="list-decimal list-inside space-y-1 ml-2">
                  <li>Check "Forward it to"</li>
                  <li>Add forwarding address: <code className="bg-gray-100 px-2 py-0.5 rounded text-xs break-all">{forwardingEmail}</code></li>
                  <li>Gmail will send a verification email - <strong>we'll handle this automatically!</strong></li>
                  <li>Click "Create filter"</li>
                </ol>

                <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded">
                  <p className="text-xs text-green-800">
                    <strong>Good news:</strong> Gmail verification is handled automatically. Just create the filter
                    and we'll confirm the forwarding address for you behind the scenes. Your bills will start
                    forwarding within a few seconds!
                  </p>
                </div>
              </div>
            </details>

            {/* Peoples Gas Instructions */}
            <details className="group border border-gray-200 rounded-lg">
              <summary className="cursor-pointer px-4 py-3 font-medium text-gray-900 hover:bg-gray-50">
                Peoples Gas
              </summary>
              <div className="px-4 pb-4 pt-2 text-sm text-gray-600 space-y-2">
                <p className="font-medium text-gray-700">Step 1: Open Gmail and search for Peoples Gas emails</p>
                <p>Search for: <code className="bg-gray-100 px-2 py-0.5 rounded">from:@peoplesgasdelivery.com</code></p>

                <p className="font-medium text-gray-700 mt-3">Step 2: Create a filter</p>
                <ol className="list-decimal list-inside space-y-1 ml-2">
                  <li>Click the search options dropdown (Show search options)</li>
                  <li>Enter <code className="bg-gray-100 px-2 py-0.5 rounded">@peoplesgasdelivery.com</code> in the "From" field</li>
                  <li>Enter <code className="bg-gray-100 px-2 py-0.5 rounded">bill OR statement</code> in "Has the words" field</li>
                  <li>Click "Create filter"</li>
                </ol>

                <p className="font-medium text-gray-700 mt-3">Step 3: Set up forwarding</p>
                <ol className="list-decimal list-inside space-y-1 ml-2">
                  <li>Check "Forward it to"</li>
                  <li>Add forwarding address: <code className="bg-gray-100 px-2 py-0.5 rounded text-xs break-all">{forwardingEmail}</code></li>
                  <li>Gmail will send a verification email - <strong>we'll handle this automatically!</strong></li>
                  <li>Click "Create filter"</li>
                </ol>

                <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded">
                  <p className="text-xs text-green-800">
                    <strong>Good news:</strong> Gmail verification is handled automatically. Just create the filter
                    and we'll confirm the forwarding address for you behind the scenes!
                  </p>
                </div>
              </div>
            </details>

            {/* Xfinity/Comcast Instructions */}
            <details className="group border border-gray-200 rounded-lg">
              <summary className="cursor-pointer px-4 py-3 font-medium text-gray-900 hover:bg-gray-50">
                Xfinity / Comcast (Internet)
              </summary>
              <div className="px-4 pb-4 pt-2 text-sm text-gray-600 space-y-2">
                <p className="font-medium text-gray-700">Step 1: Open Gmail and search for Xfinity emails</p>
                <p>Search for: <code className="bg-gray-100 px-2 py-0.5 rounded">from:@xfinity.com OR from:@comcast.net</code></p>

                <p className="font-medium text-gray-700 mt-3">Step 2: Create a filter</p>
                <ol className="list-decimal list-inside space-y-1 ml-2">
                  <li>Click the search options dropdown (Show search options)</li>
                  <li>Enter <code className="bg-gray-100 px-2 py-0.5 rounded">@xfinity.com OR @comcast.net</code> in the "From" field</li>
                  <li>Enter <code className="bg-gray-100 px-2 py-0.5 rounded">bill OR statement</code> in "Has the words" field</li>
                  <li>Click "Create filter"</li>
                </ol>

                <p className="font-medium text-gray-700 mt-3">Step 3: Set up forwarding</p>
                <ol className="list-decimal list-inside space-y-1 ml-2">
                  <li>Check "Forward it to"</li>
                  <li>Add forwarding address: <code className="bg-gray-100 px-2 py-0.5 rounded text-xs break-all">{forwardingEmail}</code></li>
                  <li>Gmail will send a verification email - <strong>we'll handle this automatically!</strong></li>
                  <li>Click "Create filter"</li>
                </ol>

                <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded">
                  <p className="text-xs text-green-800">
                    <strong>Good news:</strong> Gmail verification is handled automatically. Just create the filter
                    and we'll confirm the forwarding address for you behind the scenes!
                  </p>
                </div>
              </div>
            </details>

            {/* Generic Instructions */}
            <details className="group border border-gray-200 rounded-lg">
              <summary className="cursor-pointer px-4 py-3 font-medium text-gray-900 hover:bg-gray-50">
                Other Utility Providers
              </summary>
              <div className="px-4 pb-4 pt-2 text-sm text-gray-600 space-y-2">
                <p>Use these same steps for any utility provider:</p>

                <ol className="list-decimal list-inside space-y-2 ml-2">
                  <li>Find the email domain your utility uses (check a recent bill email)</li>
                  <li>In Gmail, click "Show search options"</li>
                  <li>Enter the domain in "From" (e.g., <code className="bg-gray-100 px-2 py-0.5 rounded">@utilityprovider.com</code>)</li>
                  <li>Enter <code className="bg-gray-100 px-2 py-0.5 rounded">bill OR statement</code> in "Has the words"</li>
                  <li>Click "Create filter"</li>
                  <li>Check "Forward it to" and add: <code className="bg-gray-100 px-2 py-0.5 rounded text-xs break-all">{forwardingEmail}</code></li>
                  <li>Gmail will send a verification email - <strong>we'll handle this automatically!</strong></li>
                  <li>Click "Create filter"</li>
                </ol>

                <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded">
                  <p className="text-xs text-green-800">
                    <strong>Good news:</strong> Gmail verification is handled automatically. Just create the filter
                    and we'll confirm the forwarding address for you behind the scenes!
                  </p>
                </div>

                <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded">
                  <p className="text-xs text-blue-800">
                    <strong>Accepted Bills:</strong> Electric (ComEd), Gas (Peoples Gas), Internet (Xfinity, AT&T, RCN),
                    or Water bills work as proof of residency.
                  </p>
                </div>
              </div>
            </details>

            {/* Registration Receipt Instructions */}
            <details className="group border border-gray-200 rounded-lg">
              <summary className="cursor-pointer px-4 py-3 font-medium text-gray-900 hover:bg-gray-50">
                Registration Purchase Emails (SEBIS + Illinois SOS)
              </summary>
              <div className="px-4 pb-4 pt-2 text-sm text-gray-600 space-y-2">
                <p className="font-medium text-gray-700">
                  Forward purchase emails from:
                </p>
                <ul className="list-disc list-inside space-y-1">
                  <li><code className="bg-gray-100 px-2 py-0.5 rounded">chicagovehiclestickers@sebis.com</code> (city sticker)</li>
                  <li><code className="bg-gray-100 px-2 py-0.5 rounded">ecommerce@ilsos.gov</code> (license plate sticker)</li>
                </ul>

                <p>
                  We store these receipts as evidence that you purchased registration on time. If you get ticketed before the sticker is applied,
                  this gives us proof for contesting.
                </p>

                <ol className="list-decimal list-inside space-y-1 ml-2">
                  <li>In Gmail, click <strong>Show search options</strong></li>
                  <li>Set <strong>From</strong> to one sender at a time and create a filter for each sender above</li>
                  <li>Click <strong>Create filter</strong></li>
                  <li>Check <strong>Forward it to</strong> and choose: <code className="bg-gray-100 px-2 py-0.5 rounded text-xs break-all">{forwardingEmail}</code></li>
                  <li>Click <strong>Create filter</strong></li>
                </ol>

                <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded">
                  <p className="text-xs text-blue-800">
                    Forwarding receipts is optional but strongly recommended for contest evidence.
                  </p>
                </div>
              </div>
            </details>
          </div>
        </div>

        {/* Video Tutorial Placeholder */}
        <div className="mt-6 p-4 bg-gray-50 border border-gray-200 rounded-lg">
          <h4 className="text-sm font-medium text-gray-900 mb-2">Video Tutorial</h4>
          <p className="text-sm text-gray-600 mb-3">
            Watch this 30-second walkthrough of setting up email forwarding:
          </p>
          <div className="aspect-video bg-gray-200 rounded flex items-center justify-center">
            <p className="text-gray-500 text-sm">[Video tutorial coming soon]</p>
          </div>
        </div>

        {/* Why This Works */}
        <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-lg">
          <h4 className="text-sm font-medium text-green-900 mb-2">Why This Works</h4>
          <ul className="text-sm text-green-800 space-y-1 list-disc list-inside">
            <li>Your bills forward automatically every month</li>
            <li>We always have your most recent proof of residency</li>
            <li>Old bills are automatically deleted after 60 days (we keep 2 months for safety)</li>
            <li>You never have to manually upload bills again</li>
            <li>Your city sticker renewals happen automatically with up-to-date documents</li>
          </ul>
        </div>
      </div>
    </div>
  )
}
