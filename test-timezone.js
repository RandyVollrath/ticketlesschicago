// Test what time the server thinks it is in Chicago timezone
function getChicagoTime() {
  const now = new Date();
  const chicagoTime = new Date().toLocaleString("en-US", { timeZone: "America/Chicago" });
  const chicagoDate = new Date(now.toLocaleString("en-US", { timeZone: "America/Chicago" }));
  const hour = chicagoDate.getHours();

  return { hour, chicagoTime, chicagoDate };
}

console.log('Current time info:');
console.log('UTC now:', new Date().toISOString());
const { hour, chicagoTime, chicagoDate } = getChicagoTime();
console.log('Chicago time string:', chicagoTime);
console.log('Chicago Date object:', chicagoDate);
console.log('Chicago hour:', hour);
console.log('');
console.log('Cron schedule interpretation:');
console.log('0 12 * * * (noon UTC) should be 7am Chicago (morning_reminder)');
console.log('Current hour matches 7am?', hour === 7);
console.log('Current hour matches 15 (3pm)?', hour === 15);
console.log('Current hour matches 19 (7pm)?', hour === 19);
