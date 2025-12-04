const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data: remitters, error } = await supabase
    .from("renewal_partners")
    .select("*")
    .eq("status", "active");

  console.log("=== ACTIVE REMITTERS ===");
  if (error) {
    console.log("Error:", error);
  } else {
    remitters.forEach(r => {
      console.log("\nID:", r.id);
      console.log("Name:", r.name);
      console.log("Email:", r.email);
      console.log("Stripe Connect ID:", r.stripe_connected_account_id);
      console.log("Status:", r.status);
    });
  }
}

check();
