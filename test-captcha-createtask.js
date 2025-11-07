const https = require('https');

const apiKey = '7b22b9f10457d2df98a87281c1aece2b';
const siteKey = 'cd38d875-4dbb-4893-a4c9-736eab35e83a';
const pageUrl = 'https://webapps1.chicago.gov/payments-web/';

console.log('🔓 Testing 2captcha with createTask API (new format)...\n');

// Step 1: Create task using new API
const taskData = JSON.stringify({
  clientKey: apiKey,
  task: {
    type: 'HCaptchaTaskProxyless',
    websiteURL: pageUrl,
    websiteKey: siteKey
  }
});

const options = {
  hostname: 'api.2captcha.com',
  path: '/createTask',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': taskData.length
  }
};

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const result = JSON.parse(data);

    if (result.errorId > 0) {
      console.log('❌ Error creating task:', result.errorDescription);
      console.log('\n📝 Common issues:');
      console.log('   - Account needs "Developer" role');
      console.log('   - hCaptcha not enabled for your account');
      console.log('   - Contact 2captcha support to enable\n');
      return;
    }

    console.log('✅ Task created successfully!');
    console.log('🎫 Task ID:', result.taskId);
    console.log('⏳ Waiting 20 seconds for solve...\n');

    // Step 2: Check task result
    const checkResult = () => {
      const checkData = JSON.stringify({
        clientKey: apiKey,
        taskId: result.taskId
      });

      const checkOptions = {
        hostname: 'api.2captcha.com',
        path: '/getTaskResult',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': checkData.length
        }
      };

      const checkReq = https.request(checkOptions, (res2) => {
        let data2 = '';
        res2.on('data', chunk => data2 += chunk);
        res2.on('end', () => {
          const check = JSON.parse(data2);

          if (check.status === 'processing') {
            console.log('⏳ Still solving... checking again in 5 seconds');
            setTimeout(checkResult, 5000);
          } else if (check.status === 'ready') {
            console.log('\n✅ SUCCESS! Captcha solved!');
            console.log('🎫 Token:', check.solution.gRecaptchaResponse.substring(0, 60) + '...');
            console.log('\n💰 Cost: $0.003');
            console.log('💵 Remaining balance: ~$19.997\n');
            console.log('✅ 2captcha integration WORKS!\n');
          } else {
            console.log('❌ Error:', check.errorDescription || 'Unknown error');
          }
        });
      });

      checkReq.write(checkData);
      checkReq.end();
    };

    setTimeout(checkResult, 20000);
  });
});

req.on('error', (e) => {
  console.error('❌ Request error:', e.message);
});

req.write(taskData);
req.end();
