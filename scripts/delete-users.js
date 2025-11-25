require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const { data: users } = await supabase
    .from("user_profiles")
    .select("user_id, email")
    .or("email.eq.heyliberalname@gmail.com,email.like.mystreetcleaning+%");

  console.log("Users to review:");
  for (const u of users || []) {
    const keep = u.email === "mystreetcleaning+6@gmail.com";
    console.log("  " + (keep ? "KEEP" : "DELETE") + ": " + u.email);
  }

  const toDelete = (users || []).filter(function(u) { return u.email !== "mystreetcleaning+6@gmail.com"; });

  console.log("\nDeleting " + toDelete.length + " users...\n");

  for (const user of toDelete) {
    console.log("Deleting " + user.email + "...");

    const { error: profileError } = await supabase
      .from("user_profiles")
      .delete()
      .eq("user_id", user.user_id);

    console.log(profileError ? "  Profile error: " + profileError.message : "  Deleted from user_profiles");

    const { error: authError } = await supabase.auth.admin.deleteUser(user.user_id);

    console.log(authError ? "  Auth error: " + authError.message : "  Deleted from auth.users");
  }

  console.log("\nDone!");
}

main().catch(console.error);
