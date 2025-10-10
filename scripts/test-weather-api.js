// Test script for weather API integration
// Run with: node scripts/test-weather-api.js

const CHICAGO_LAT = 41.8781;
const CHICAGO_LON = -87.6298;
const NWS_API_BASE = 'https://api.weather.gov';
const USER_AGENT = 'TicketlessAmerica/1.0 (ticketlessamerica@gmail.com)';

async function fetchNWS(url) {
  console.log(`\nFetching: ${url}`);
  const response = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'application/geo+json'
    }
  });

  if (!response.ok) {
    throw new Error(`NWS API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function testWeatherAPI() {
  console.log('🌤️  Testing National Weather Service API Integration\n');
  console.log('='.repeat(60));

  try {
    // Step 1: Get grid point
    console.log('\n📍 Step 1: Getting Chicago grid point...');
    const pointUrl = `${NWS_API_BASE}/points/${CHICAGO_LAT},${CHICAGO_LON}`;
    const pointData = await fetchNWS(pointUrl);

    const gridPoint = {
      gridId: pointData.properties.gridId,
      gridX: pointData.properties.gridX,
      gridY: pointData.properties.gridY
    };

    console.log(`✅ Grid Point: ${gridPoint.gridId} (${gridPoint.gridX}, ${gridPoint.gridY})`);

    // Step 2: Get current conditions
    console.log('\n🌡️  Step 2: Getting current conditions (O\'Hare Airport)...');
    const stationUrl = `${NWS_API_BASE}/stations/KORD/observations/latest`;
    const currentData = await fetchNWS(stationUrl);

    console.log(`✅ Current Conditions:`);
    console.log(`   Temperature: ${Math.round(currentData.properties.temperature.value * 9/5 + 32)}°F`);
    console.log(`   Conditions: ${currentData.properties.textDescription}`);
    console.log(`   Wind: ${currentData.properties.windSpeed.value} km/h ${currentData.properties.windDirection.value}°`);
    console.log(`   Humidity: ${Math.round(currentData.properties.relativeHumidity.value)}%`);

    // Step 3: Get forecast
    console.log('\n📅 Step 3: Getting forecast...');
    const forecastUrl = `${NWS_API_BASE}/gridpoints/${gridPoint.gridId}/${gridPoint.gridX},${gridPoint.gridY}/forecast`;
    const forecastData = await fetchNWS(forecastUrl);

    console.log(`✅ Forecast (next 3 periods):`);
    forecastData.properties.periods.slice(0, 3).forEach((period, i) => {
      console.log(`\n   Period ${i + 1}: ${period.name}`);
      console.log(`   ${period.temperature}°${period.temperatureUnit} - ${period.shortForecast}`);
      console.log(`   ${period.detailedForecast.substring(0, 100)}...`);
    });

    // Step 4: Check for snow mentions
    console.log('\n❄️  Step 4: Checking for snow in forecast...');
    let snowFound = false;
    let maxSnowAmount = 0;

    for (const period of forecastData.properties.periods.slice(0, 7)) {
      const hasSnow = period.shortForecast.toLowerCase().includes('snow') ||
                      period.detailedForecast.toLowerCase().includes('snow');

      if (hasSnow) {
        snowFound = true;
        console.log(`\n   ❄️  Snow mentioned in ${period.name}:`);
        console.log(`   ${period.shortForecast}`);
        console.log(`   ${period.detailedForecast}`);

        // Try to parse snow amount
        const forecast = period.detailedForecast.toLowerCase();
        const rangeMatch = forecast.match(/(\d+)\s+to\s+(\d+)\s+inch/i);
        const aroundMatch = forecast.match(/(?:around|of)\s+(\d+(?:\.\d+)?)\s+inch/i);

        if (rangeMatch) {
          const amount = Math.max(parseFloat(rangeMatch[1]), parseFloat(rangeMatch[2]));
          console.log(`   📏 Estimated: ${amount} inches`);
          maxSnowAmount = Math.max(maxSnowAmount, amount);
        } else if (aroundMatch) {
          const amount = parseFloat(aroundMatch[1]);
          console.log(`   📏 Estimated: ${amount} inches`);
          maxSnowAmount = Math.max(maxSnowAmount, amount);
        }
      }
    }

    if (!snowFound) {
      console.log('   ✅ No snow in forecast');
    } else if (maxSnowAmount >= 2.0) {
      console.log(`\n   🚨 2-INCH BAN ALERT: ${maxSnowAmount}" of snow forecasted!`);
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('\n📊 Test Summary:');
    console.log(`   ✅ API Connection: Success`);
    console.log(`   ✅ Grid Point: ${gridPoint.gridId}`);
    console.log(`   ✅ Current Conditions: Retrieved`);
    console.log(`   ✅ Forecast: Retrieved`);
    console.log(`   ❄️  Snow Detected: ${snowFound ? 'Yes' : 'No'}`);
    if (maxSnowAmount > 0) {
      console.log(`   📏 Max Snow Amount: ${maxSnowAmount} inches`);
      console.log(`   🚨 2-Inch Ban: ${maxSnowAmount >= 2.0 ? 'TRIGGER' : 'No action'}`);
    }

    console.log('\n🎉 Weather API test completed successfully!\n');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

testWeatherAPI()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
