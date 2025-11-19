#!/usr/bin/env node

/**
 * Production Status Verification Script
 *
 * Analyzes production database to determine:
 * - What features are actually being used
 * - What's deployed but dormant
 * - Production readiness scores
 *
 * Run with: node scripts/verify-production-status.js
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runQuery(description, query, params = []) {
  console.log(`\n📊 ${description}`);
  try {
    const { data, error, count } = await query;

    if (error) {
      console.error(`   ❌ Error: ${error.message}`);
      return null;
    }

    return { data, count };
  } catch (err) {
    console.error(`   ❌ Exception: ${err.message}`);
    return null;
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('🔍 PRODUCTION STATUS VERIFICATION');
  console.log('='.repeat(70));
  console.log(`Environment: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log('='.repeat(70));

  // ==========================================
  // 1. USER BASE ANALYSIS
  // ==========================================
  console.log('\n' + '='.repeat(70));
  console.log('👥 USER BASE ANALYSIS');
  console.log('='.repeat(70));

  const totalUsers = await runQuery(
    'Total Users',
    supabase.from('user_profiles').select('*', { count: 'exact', head: true })
  );
  console.log(`   Total: ${totalUsers?.count || 0} users`);

  const protectionUsers = await runQuery(
    'Protection Subscribers',
    supabase.from('user_profiles').select('*', { count: 'exact', head: true }).eq('has_protection', true)
  );
  console.log(`   Protection subscribers: ${protectionUsers?.count || 0}`);
  if (protectionUsers?.count > 0) {
    console.log(`   ✅ Users are paying for Protection!`);
  } else {
    console.log(`   ⚠️  No Protection subscribers yet`);
  }

  const withLicensePlate = await runQuery(
    'Users with License Plates',
    supabase.from('user_profiles').select('license_plate', { count: 'exact' }).not('license_plate', 'is', null)
  );
  console.log(`   With license plate: ${withLicensePlate?.count || 0}`);

  const withCitySticker = await runQuery(
    'Users with City Sticker Expiry',
    supabase.from('user_profiles').select('city_sticker_expiry', { count: 'exact' }).not('city_sticker_expiry', 'is', null)
  );
  console.log(`   With city sticker expiry: ${withCitySticker?.count || 0}`);

  const withLicensePlateExpiry = await runQuery(
    'Users with License Plate Expiry',
    supabase.from('user_profiles').select('license_plate_expiry', { count: 'exact' }).not('license_plate_expiry', 'is', null)
  );
  console.log(`   With license plate expiry: ${withLicensePlateExpiry?.count || 0}`);

  // ==========================================
  // 2. RENEWALS & CHARGES
  // ==========================================
  console.log('\n' + '='.repeat(70));
  console.log('💰 RENEWALS & CHARGES ANALYSIS');
  console.log('='.repeat(70));

  // Check if renewal_charges table exists
  const renewalCharges = await runQuery(
    'Renewal Charges',
    supabase.from('renewal_charges').select('*', { count: 'exact' })
  );

  if (renewalCharges?.count !== null) {
    console.log(`   Total renewal charges: ${renewalCharges.count}`);

    if (renewalCharges.count > 0) {
      console.log(`   ✅ Renewal charging system IS active!`);

      // Get recent charges
      const recentCharges = await runQuery(
        'Recent Charges (last 30 days)',
        supabase
          .from('renewal_charges')
          .select('created_at, amount, charge_type, status')
          .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
          .order('created_at', { ascending: false })
          .limit(5)
      );

      if (recentCharges?.data) {
        console.log(`\n   Recent charges:`);
        recentCharges.data.forEach((charge, i) => {
          console.log(`   ${i + 1}. ${charge.charge_type}: $${charge.amount} - ${charge.status} (${new Date(charge.created_at).toLocaleDateString()})`);
        });
      }

      // Sum total revenue
      const { data: totalRevenue } = await supabase
        .from('renewal_charges')
        .select('amount')
        .eq('status', 'succeeded');

      if (totalRevenue) {
        const total = totalRevenue.reduce((sum, r) => sum + (r.amount || 0), 0);
        console.log(`\n   💵 Total revenue from renewals: $${total.toFixed(2)}`);
      }
    } else {
      console.log(`   ⚠️  No charges processed yet`);
    }
  } else {
    console.log(`   ⚠️  renewal_charges table may not exist or is inaccessible`);
  }

  // ==========================================
  // 3. REMITTER SYSTEM
  // ==========================================
  console.log('\n' + '='.repeat(70));
  console.log('🏢 REMITTER/PARTNER SYSTEM');
  console.log('='.repeat(70));

  const remitters = await runQuery(
    'Remitter Partners',
    supabase.from('renewal_partners').select('*', { count: 'exact' })
  );

  if (remitters?.count !== null) {
    console.log(`   Total remitters: ${remitters.count}`);

    if (remitters.count > 0) {
      console.log(`   ✅ Remitters are signed up!`);

      // Show remitter details
      const { data: remitterList } = await supabase
        .from('renewal_partners')
        .select('business_name, status, stripe_connected, city, state')
        .limit(10);

      if (remitterList) {
        console.log(`\n   Remitter list:`);
        remitterList.forEach((r, i) => {
          const stripeStatus = r.stripe_connected ? '✅ Stripe Connected' : '❌ No Stripe';
          console.log(`   ${i + 1}. ${r.business_name} (${r.city}, ${r.state}) - ${r.status} - ${stripeStatus}`);
        });
      }
    } else {
      console.log(`   ⚠️  No remitters signed up yet - this is the first step needed!`);
    }
  } else {
    console.log(`   ⚠️  renewal_partners table may not exist`);
  }

  // Check orders
  const orders = await runQuery(
    'Renewal Orders',
    supabase.from('renewal_orders').select('*', { count: 'exact' })
  );

  if (orders?.count !== null) {
    console.log(`   Total renewal orders: ${orders.count}`);

    if (orders.count > 0) {
      const pendingOrders = await runQuery(
        'Pending Orders',
        supabase.from('renewal_orders').select('*', { count: 'exact' }).eq('status', 'pending')
      );
      console.log(`   Pending orders: ${pendingOrders?.count || 0}`);
      console.log(`   ✅ Orders are being created!`);
    }
  }

  // ==========================================
  // 4. DOCUMENT MANAGEMENT
  // ==========================================
  console.log('\n' + '='.repeat(70));
  console.log('📄 DOCUMENT MANAGEMENT');
  console.log('='.repeat(70));

  const withLicense = await runQuery(
    'Users with Driver License Uploaded',
    supabase.from('user_profiles').select('*', { count: 'exact' }).not('drivers_license_path', 'is', null)
  );
  console.log(`   Driver licenses uploaded: ${withLicense?.count || 0}`);

  const withResidency = await runQuery(
    'Users with Residency Proof',
    supabase.from('user_profiles').select('*', { count: 'exact' }).not('residency_proof_path', 'is', null)
  );
  console.log(`   Utility bills uploaded: ${withResidency?.count || 0}`);

  const withEmailForwarding = await runQuery(
    'Users with Email Forwarding Address',
    supabase.from('user_profiles').select('*', { count: 'exact' }).not('email_forwarding_address', 'is', null)
  );
  console.log(`   Email forwarding configured: ${withEmailForwarding?.count || 0}`);

  // ==========================================
  // 5. LICENSE PLATE RENEWAL DATA
  // ==========================================
  console.log('\n' + '='.repeat(70));
  console.log('🚗 LICENSE PLATE RENEWAL DATA');
  console.log('='.repeat(70));

  const withPlateType = await runQuery(
    'Users with Plate Type Set',
    supabase.from('user_profiles').select('*', { count: 'exact' }).not('license_plate_type', 'is', null)
  );
  console.log(`   Plate types configured: ${withPlateType?.count || 0}`);

  if (withPlateType?.count > 0) {
    const { data: plateTypes } = await supabase
      .from('user_profiles')
      .select('license_plate_type, license_plate_renewal_cost')
      .not('license_plate_type', 'is', null)
      .limit(5);

    if (plateTypes && plateTypes.length > 0) {
      console.log(`\n   Sample plate configurations:`);
      plateTypes.forEach((p, i) => {
        console.log(`   ${i + 1}. ${p.license_plate_type}: $${p.license_plate_renewal_cost}`);
      });
      console.log(`   ✅ License plate cost calculator is working!`);
    }
  } else {
    console.log(`   ⚠️  No users have configured plate type yet`);
  }

  // ==========================================
  // 6. UPCOMING RENEWALS
  // ==========================================
  console.log('\n' + '='.repeat(70));
  console.log('📅 UPCOMING RENEWALS (Next 30 Days)');
  console.log('='.repeat(70));

  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  const upcomingCityStickers = await runQuery(
    'City Sticker Renewals Due',
    supabase
      .from('user_profiles')
      .select('*', { count: 'exact' })
      .lte('city_sticker_expiry', thirtyDaysFromNow.toISOString().split('T')[0])
      .gte('city_sticker_expiry', new Date().toISOString().split('T')[0])
      .eq('has_protection', true)
  );
  console.log(`   City stickers due: ${upcomingCityStickers?.count || 0}`);

  const upcomingLicensePlates = await runQuery(
    'License Plate Renewals Due',
    supabase
      .from('user_profiles')
      .select('*', { count: 'exact' })
      .lte('license_plate_expiry', thirtyDaysFromNow.toISOString().split('T')[0])
      .gte('license_plate_expiry', new Date().toISOString().split('T')[0])
      .eq('has_protection', true)
  );
  console.log(`   License plates due: ${upcomingLicensePlates?.count || 0}`);

  if ((upcomingCityStickers?.count || 0) + (upcomingLicensePlates?.count || 0) > 0) {
    console.log(`   ✅ Renewals will trigger soon - test the cron job!`);
  } else {
    console.log(`   ⚠️  No renewals due in next 30 days - hard to test cron job`);
  }

  // ==========================================
  // 7. PRODUCTION READINESS SCORES
  // ==========================================
  console.log('\n' + '='.repeat(70));
  console.log('📊 PRODUCTION READINESS SCORES');
  console.log('='.repeat(70));

  const scores = {
    'User Signups': totalUsers?.count > 0 ? 100 : 0,
    'Protection Subscriptions': protectionUsers?.count > 0 ? 100 : 0,
    'Renewal Charging': renewalCharges?.count > 0 ? 100 : 60,
    'Remitter System': remitters?.count > 0 ? 100 : 30,
    'Document Management': withLicense?.count > 0 ? 100 : 70,
    'License Plate Calculator': withPlateType?.count > 0 ? 100 : 80,
  };

  Object.entries(scores).forEach(([feature, score]) => {
    const bar = '█'.repeat(Math.floor(score / 10)) + '░'.repeat(10 - Math.floor(score / 10));
    const status = score === 100 ? '✅' : score >= 70 ? '⚠️ ' : '❌';
    console.log(`   ${status} ${feature.padEnd(30)} ${bar} ${score}%`);
  });

  const overallScore = Math.round(Object.values(scores).reduce((a, b) => a + b, 0) / Object.values(scores).length);
  console.log(`\n   🎯 OVERALL PRODUCTION READINESS: ${overallScore}%`);

  // ==========================================
  // 8. NEXT STEPS
  // ==========================================
  console.log('\n' + '='.repeat(70));
  console.log('🎯 RECOMMENDED NEXT STEPS');
  console.log('='.repeat(70));

  const nextSteps = [];

  if ((remitters?.count || 0) === 0) {
    nextSteps.push('CRITICAL: Recruit at least 1 remitter partner');
  }

  if ((protectionUsers?.count || 0) === 0) {
    nextSteps.push('Get first Protection subscriber (test with real user)');
  }

  if ((renewalCharges?.count || 0) === 0) {
    nextSteps.push('Test renewal charging cron job');
  }

  if ((upcomingCityStickers?.count || 0) === 0 && (upcomingLicensePlates?.count || 0) === 0) {
    nextSteps.push('Create test user with expiry in 15 days to test auto-renewal');
  }

  if ((withEmailForwarding?.count || 0) === 0) {
    nextSteps.push('Test email forwarding for utility bills');
  }

  if (nextSteps.length === 0) {
    console.log('   ✅ System is operational! Monitor and optimize.');
  } else {
    nextSteps.forEach((step, i) => {
      console.log(`   ${i + 1}. ${step}`);
    });
  }

  console.log('\n' + '='.repeat(70));
  console.log('✅ Verification Complete');
  console.log('='.repeat(70));
}

main().catch((err) => {
  console.error('\n❌ Fatal error:', err.message);
  process.exit(1);
});
