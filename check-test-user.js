const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  // Get test user profile
  const { data: user, error: userErr } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("email", "ticketlessamerica@gmail.com")
    .single();

  console.log("=== TEST USER PROFILE ===");
  if (userErr) {
    console.log("Error:", userErr);
  } else {
    console.log("user_id:", user.user_id);
    console.log("email:", user.email);
    console.log("has_protection:", user.has_protection);
    console.log("stripe_customer_id:", user.stripe_customer_id);
    console.log("city_sticker_expiry:", user.city_sticker_expiry);
    console.log("license_plate_expiry:", user.license_plate_expiry);
    console.log("vehicle_type:", user.vehicle_type);
    console.log("license_plate:", user.license_plate);
    console.log("emissions_date:", user.emissions_date);
    console.log("emissions_completed:", user.emissions_completed);
  }

  // Get active remitter
  const { data: remitter, error: remErr } = await supabase
    .from("renewal_partners")
    .select("*")
    .eq("status", "active")
    .not("stripe_connected_account_id", "is", null)
    .single();

  console.log("\n=== ACTIVE REMITTER ===");
  if (remErr) {
    console.log("Error:", remErr);
  } else {
    console.log("id:", remitter.id);
    console.log("name:", remitter.name);
    console.log("email:", remitter.email);
    console.log("stripe_connected_account_id:", remitter.stripe_connected_account_id);
    console.log("status:", remitter.status);
  }

  // Check existing charges for this user
  if (user) {
    const { data: charges, error: chargesErr } = await supabase
      .from("renewal_charges")
      .select("*")
      .eq("user_id", user.user_id)
      .order("created_at", { ascending: false })
      .limit(5);

    console.log("\n=== RECENT CHARGES ===");
    if (chargesErr) {
      console.log("Error:", chargesErr);
    } else if (charges && charges.length > 0) {
      charges.forEach(c => console.log(c.charge_type, c.status, c.amount, c.created_at));
    } else {
      console.log("No charges yet");
    }
  }

  // Check existing orders
  const { data: orders } = await supabase
    .from("renewal_orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(5);

  console.log("\n=== RECENT ORDERS ===");
  if (orders && orders.length > 0) {
    orders.forEach(o => console.log(o.order_number, o.status, o.license_plate, o.created_at));
  } else {
    console.log("No orders yet");
  }
}

check();
