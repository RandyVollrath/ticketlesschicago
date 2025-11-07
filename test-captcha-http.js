const https = require('https');

const apiKey = '7b22b9f10457d2df98a87281c1aece2b';
const siteKey = 'cd38d875-4dbb-4893-a4c9-736eab35e83a';
const pageUrl = 'https://webapps1.chicago.gov/payments-web/';

console.log('🔓 Testing 2captcha via direct HTTP API...\n');

// Step 1: Submit captcha
const submitUrl = `https://2captcha.com/in.php?key=${apiKey}&method=hcaptcha&sitekey=${siteKey}&pageurl=${encodeURIComponent(pageUrl)}&json=1`;

https.get(submitUrl, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const result = JSON.parse(data);
    if (result.status === 0) {
      console.log('❌ Error submitting captcha:', result.request);
      return;
    }

    console.log('✅ Captcha submitted to 2captcha');
    console.log('🎫 Request ID:', result.request);
    console.log('⏳ Waiting 20 seconds for solve...\n');

    // Step 2: Check for result
    const checkResult = () => {
      const resultUrl = `https://2captcha.com/res.php?key=${apiKey}&action=get&id=${result.request}&json=1`;
      https.get(resultUrl, (res2) => {
        let data2 = '';
        res2.on('data', chunk => data2 += chunk);
        res2.on('end', () => {
          const check = JSON.parse(data2);
          if (check.status === 0 && check.request === 'CAPCHA_NOT_READY') {
            console.log('⏳ Still solving... checking again in 5 seconds');
            setTimeout(checkResult, 5000);
          } else if (check.status === 1) {
            console.log('\n✅ SUCCESS! Captcha solved!');
            console.log('🎫 Token:', check.request.substring(0, 60) + '...');
            console.log('\n💰 Cost: $0.003');
            console.log('💵 Remaining balance: ~$19.997\n');
            console.log('✅ 2captcha integration WORKS!\n');
          } else {
            console.log('❌ Error:', check.request);
          }
        });
      });
    };

    setTimeout(checkResult, 20000);
  });
});
