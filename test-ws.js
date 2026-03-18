const WebSocket = require('ws');

// Test direct connection to backend (bypassing nginx)
console.log('🧪 Test 1: Direct connection to backend:5000');
const ws1 = new WebSocket('ws://127.0.0.1:5000/ws?gameId=test123&token=faketoken');

ws1.on('open', () => {
  console.log('✅ Test 1 SUCCESS: Connected to backend:5000 directly');
  ws1.close();
  testNginx();
});

ws1.on('error', (err) => {
  console.log('❌ Test 1 FAILED: Cannot connect to backend:5000:', err.message);
  testNginx();
});

ws1.on('message', (data) => {
  console.log('📨 Backend response:', data);
});

function testNginx() {
  setTimeout(() => {
    console.log('\n🧪 Test 2: Connection via nginx localhost');
    const ws2 = new WebSocket('ws://localhost/ws?gameId=test123&token=faketoken');

    ws2.on('open', () => {
      console.log('✅ Test 2 SUCCESS: Connected via nginx localhost');
      ws2.close();
      process.exit(0);
    });

    ws2.on('error', (err) => {
      console.log('❌ Test 2 FAILED: Cannot connect via nginx localhost:', err.message);
      process.exit(1);
    });
  }, 1000);
}

setTimeout(() => {
  console.log('❌ Test timeout - no response after 5 seconds');
  process.exit(1);
}, 5000);
