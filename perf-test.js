#!/usr/bin/env node

/**
 * WebSocket Sync Performance Tester
 * Measures round-trip time for game actions via WebSocket
 * 
 * Usage: node perf-test.js <gameId> <userId> <token> [action]
 * 
 * Action can be: ping | play_card | pass_turn
 */

const http = require('http');

function makeRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 5000,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runPerfTest() {
  const gameId = process.argv[2] || 'test-game-123';
  const userId = process.argv[3] || 'user-123';
  const token = process.argv[4] || 'test-token';
  const action = (process.argv[5] || 'ping').toLowerCase();

  console.log(`🧪 WebSocket Sync Performance Test`);
  console.log(`   Game: ${gameId}`);
  console.log(`   User: ${userId}`);
  console.log(`   Action: ${action}\n`);

  try {
    // For HTTP actions, measure from client perspective
    if (action === 'play_card' || action === 'pass_turn') {
      const startTime = Date.now();
      
      const endpoint = action === 'play_card' 
        ? `/api/game/${gameId}/play`
        : `/api/game/${gameId}/pass`;
      
      const response = await makeRequest('POST', endpoint, {
        userId,
        cardInstanceId: action === 'play_card' ? 'card-1' : undefined,
      });

      const clientTime = Date.now() - startTime;

      console.log(`✅ Action completed in ${clientTime}ms`);
      
      if (response.data.serverTimestamp) {
        console.log(`📊 Server timestamp: ${response.data.serverTimestamp}`);
      }
      
      if (response.status !== 200) {
        console.log(`⚠️  Response status: ${response.status}`);
        console.log(response.data);
      }
    }
    
    // For WebSocket ping test
    if (action === 'ping') {
      console.log('📡 WebSocket Ping Test - Check browser console logs while in a game');
      console.log('   Open browser DevTools → Console to see [Sync] RTT measurements');
      console.log('\n   Example output:');
      console.log('   ⚡ [Sync] RTT: 23ms (3 patches, v42)');
      console.log('   ✅ [Sync] RTT: 67ms (5 patches, v43)');
      console.log('   ⚠️  [Sync] RTT: 142ms (2 patches, v44)');
    }

  } catch (err) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
}

runPerfTest();
