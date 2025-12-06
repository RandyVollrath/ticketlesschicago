export default function TermsPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-sky-100 to-white dark:from-slate-900 dark:to-slate-800 py-16">
      <div className="container mx-auto px-4 max-w-3xl">
        <h1 className="text-4xl font-bold text-slate-800 dark:text-white mb-8">
          Terms of Service & SMS Consent
        </h1>

        <div className="bg-white dark:bg-slate-700 rounded-2xl shadow-xl p-8 space-y-8">
          {/* SMS Consent Section */}
          <section>
            <h2 className="text-2xl font-semibold text-slate-800 dark:text-white mb-4">
              SMS/Text Message Consent
            </h2>
            <div className="text-slate-600 dark:text-slate-300 space-y-4">
              <p>
                By providing your phone number and using SnowSOS, you expressly consent to receive
                SMS/text messages from SnowSOS regarding:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Job posting confirmations and status updates</li>
                <li>Notifications when a snow removal provider claims your job</li>
                <li>Service completion notifications</li>
                <li>New job alerts (for registered snow removal providers)</li>
                <li>Account and service-related communications</li>
              </ul>
              <p>
                <strong>Message frequency:</strong> Message frequency varies based on your usage of the service.
                You may receive multiple messages when posting jobs or during active service requests.
              </p>
              <p>
                <strong>Message and data rates may apply.</strong> Your carrier&apos;s standard messaging
                rates apply to all SMS communications.
              </p>
              <p>
                <strong>Opt-out:</strong> You may opt out of SMS messages at any time by texting STOP
                to any message you receive from us. After opting out, you will receive one final
                confirmation message. Note that opting out may limit your ability to use our service.
              </p>
              <p>
                <strong>Help:</strong> Text HELP to receive assistance or contact us at support@snowsos.com.
              </p>
              <p>
                We will not share your phone number with third parties for marketing purposes.
                Your information is used solely to provide our snow removal marketplace service.
              </p>
            </div>
          </section>

          {/* Service Description */}
          <section>
            <h2 className="text-2xl font-semibold text-slate-800 dark:text-white mb-4">
              About SnowSOS
            </h2>
            <div className="text-slate-600 dark:text-slate-300 space-y-4">
              <p>
                SnowSOS is an on-demand snow removal marketplace connecting Chicago-area residents
                with local snow plow operators and shovelers. Our platform enables:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>Customers to request snow removal services via our website</li>
                <li>Registered snow removal providers to receive and claim available jobs</li>
                <li>Real-time SMS notifications for job updates and status changes</li>
                <li>Direct communication between customers and service providers</li>
              </ul>
            </div>
          </section>

          {/* Terms of Use */}
          <section>
            <h2 className="text-2xl font-semibold text-slate-800 dark:text-white mb-4">
              Terms of Use
            </h2>
            <div className="text-slate-600 dark:text-slate-300 space-y-4">
              <p>
                By using SnowSOS, you agree to the following terms:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li>You must provide accurate contact information including a valid phone number</li>
                <li>You consent to receive SMS notifications related to the service</li>
                <li>Snow removal providers are independent contractors, not employees of SnowSOS</li>
                <li>Payment is arranged directly between customers and service providers</li>
                <li>SnowSOS is not liable for the quality of work performed by providers</li>
                <li>You must be 18 years or older to use this service</li>
              </ul>
            </div>
          </section>

          {/* Privacy */}
          <section>
            <h2 className="text-2xl font-semibold text-slate-800 dark:text-white mb-4">
              Privacy Policy
            </h2>
            <div className="text-slate-600 dark:text-slate-300 space-y-4">
              <p>
                We collect and use the following information to provide our service:
              </p>
              <ul className="list-disc pl-6 space-y-2">
                <li><strong>Phone number:</strong> Used for SMS notifications and account identification</li>
                <li><strong>Address:</strong> Used to match you with nearby service providers</li>
                <li><strong>Service requests:</strong> Stored to facilitate job matching and history</li>
              </ul>
              <p>
                We do not sell your personal information to third parties. Your data is used
                solely to operate the SnowSOS marketplace.
              </p>
            </div>
          </section>

          {/* Contact */}
          <section>
            <h2 className="text-2xl font-semibold text-slate-800 dark:text-white mb-4">
              Contact Us
            </h2>
            <div className="text-slate-600 dark:text-slate-300">
              <p>
                For questions about these terms or our service, contact us at:
              </p>
              <p className="mt-2">
                <strong>Email:</strong> support@snowsos.com<br />
                <strong>SMS:</strong> Text HELP to +1 (833) 260-7864
              </p>
            </div>
          </section>

          <p className="text-sm text-slate-500 dark:text-slate-400 pt-4 border-t border-slate-200 dark:border-slate-600">
            Last updated: December 2024
          </p>
        </div>
      </div>
    </main>
  );
}
