export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-sky-100 to-white dark:from-slate-900 dark:to-slate-800">
      <div className="container mx-auto px-4 py-16">
        {/* Hero Section */}
        <div className="text-center max-w-3xl mx-auto">
          <h1 className="text-5xl md:text-6xl font-bold text-slate-800 dark:text-white mb-4">
            SnowSOS
          </h1>
          <p className="text-xl md:text-2xl text-slate-600 dark:text-slate-300 mb-8">
            Emergency Snow Removal
          </p>

          {/* CTA Box */}
          <div className="bg-white dark:bg-slate-700 rounded-2xl shadow-xl p-8 md:p-12 mb-12">
            <div className="text-6xl mb-6">
              <span role="img" aria-label="snowflake">&#10052;</span>
            </div>
            <p className="text-lg text-slate-600 dark:text-slate-300 mb-6">
              Need your driveway or sidewalk cleared? Just send a text!
            </p>
            <div className="bg-sky-50 dark:bg-slate-600 rounded-xl p-6 mb-6">
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">
                Text your address to:
              </p>
              <p className="text-3xl md:text-4xl font-bold text-sky-600 dark:text-sky-400 font-mono">
                (XXX) XXX-XXXX
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                Replace with your ClickSend number
              </p>
            </div>
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              Example: &quot;123 Main St, driveway and sidewalk please&quot;
            </p>
          </div>

          {/* How It Works */}
          <div className="grid md:grid-cols-3 gap-6 text-left">
            <div className="bg-white dark:bg-slate-700 rounded-xl p-6 shadow-lg">
              <div className="text-3xl mb-4">1</div>
              <h3 className="font-semibold text-lg text-slate-800 dark:text-white mb-2">
                Text Your Address
              </h3>
              <p className="text-slate-600 dark:text-slate-300 text-sm">
                Send us your address and what needs to be cleared (driveway, sidewalk, etc.)
              </p>
            </div>
            <div className="bg-white dark:bg-slate-700 rounded-xl p-6 shadow-lg">
              <div className="text-3xl mb-4">2</div>
              <h3 className="font-semibold text-lg text-slate-800 dark:text-white mb-2">
                We Alert Shovelers
              </h3>
              <p className="text-slate-600 dark:text-slate-300 text-sm">
                Your request is instantly sent to all available snow removal pros in the area.
              </p>
            </div>
            <div className="bg-white dark:bg-slate-700 rounded-xl p-6 shadow-lg">
              <div className="text-3xl mb-4">3</div>
              <h3 className="font-semibold text-lg text-slate-800 dark:text-white mb-2">
                Get Confirmation
              </h3>
              <p className="text-slate-600 dark:text-slate-300 text-sm">
                You&apos;ll receive a text when a shoveler claims your job and is on the way.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="text-center mt-16 text-slate-500 dark:text-slate-400 text-sm">
          <p>SnowSOS - Fast, simple snow removal via text.</p>
        </footer>
      </div>
    </main>
  );
}
