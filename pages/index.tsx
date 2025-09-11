import React from 'react';
import Head from 'next/head';

export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      <Head>
        <title>TicketLess Chicago - Stay Compliant. Avoid Tickets.</title>
        <meta name="description" content="Renewals, alerts, and reminders - all in one place. Never miss a Chicago vehicle compliance deadline." />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      
      <main>
        <h1 className="text-4xl font-bold text-center py-20">
          TicketLess Chicago - Coming Soon
        </h1>
        <p className="text-center text-gray-600">
          We are currently updating our site. Please check back soon!
        </p>
      </main>
    </div>
  );
}