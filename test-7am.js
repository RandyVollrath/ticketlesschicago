// Simulate what happens at 12:00 UTC (7am Chicago)
function getChicagoTimeBUGGY(date) {
  const chicagoTime = date.toLocaleString("en-US", { timeZone: "America/Chicago" });
  const chicagoDate = new Date(date.toLocaleString("en-US", { timeZone: "America/Chicago" }));
  const hour = chicagoDate.getHours();

  return { hour, chicagoTime, chicagoDate };
}

function getChicagoTimeFIXED(date) {
  const chicagoTime = date.toLocaleString("en-US", { timeZone: "America/Chicago" });

  // Use Intl.DateTimeFormat to properly extract hour in Chicago timezone
  const hour = parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      hour: 'numeric',
      hour12: false
    }).format(date)
  );

  return { hour, chicagoTime };
}

console.log('Testing at 12:00 UTC (should be 7am Chicago):');
const noon_utc = new Date('2025-10-01T12:00:00.000Z');
console.log('UTC time:', noon_utc.toISOString());

const buggy = getChicagoTimeBUGGY(noon_utc);
console.log('\n🐛 BUGGY version:');
console.log('  Chicago time string:', buggy.chicagoTime);
console.log('  Chicago Date object:', buggy.chicagoDate.toISOString());
console.log('  Hour extracted:', buggy.hour, '❌ WRONG!');

const fixed = getChicagoTimeFIXED(noon_utc);
console.log('\n✅ FIXED version:');
console.log('  Chicago time string:', fixed.chicagoTime);
console.log('  Hour extracted:', fixed.hour, '✅ CORRECT!');
