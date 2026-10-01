const TARGET_URL = process.argv[2] || 'http://localhost:3000';
const showId = '9e2afb72-ee7a-4b09-bbad-8000244d6b72'; // Your active show ID

async function runBurst() {
  console.log(`🚀 Starting Load & Concurrency Burst against ${TARGET_URL} for Show ${showId}...`);

  // Helper to chunk requests to stay within free-tier connection limits
  async function mapConcurrently(array, limit, fn) {
    let index = 0;
    const results = [];
    async function worker() {
      while (index < array.length) {
        const currentIndex = index++;
        results[currentIndex] = await fn(array[currentIndex], currentIndex);
      }
    }
    const workers = Array(Math.min(limit, array.length)).fill(0).map(() => worker());
    await Promise.all(workers);
    return results;
  }

  // 1. THE HOT-SEAT STAMPEDE: 500 users fight for seat "A12" (batched by 20 concurrent connections)
  console.log('\n--- Test 1: Hot-Seat Stampede (500 users targeting A12) ---');
  const stampedeInputs = Array.from({ length: 500 }).map((_, i) => i);
  
  const stampedeResults = await mapConcurrently(stampedeInputs, 20, async (i) => {
    try {
      const res = await fetch(`${TARGET_URL}/shows/${showId}/reserve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer user_${i}`,
          'idempotency-key': `key_A12_${i}`,
        },
        body: JSON.stringify({ seats: ['A12'] }),
      });
      return { status: res.status };
    } catch (err) {
      return { status: 500 };
    }
  });

  const stampedeCounts = stampedeResults.reduce((acc, curr) => {
    acc[curr.status] = (acc[curr.status] || 0) + 1;
    return acc;
  }, {});

  console.log('Stampede Outcome Distribution:', stampedeCounts);
  // Expected: { '201': 1, '409': 499 } (Zero 5xx!)

  // 2. IDEMPOTENCY RETRY TEST: Same user, same key, multiple requests sequentially/safely
  console.log('\n--- Test 2: Idempotency Retry Test ---');
  const retryKey = 'unique_retry_key_999';
  const retryStatuses = [];
  
  for (let i = 0; i < 10; i++) {
    const res = await fetch(`${TARGET_URL}/shows/${showId}/reserve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer user_vip',
        'idempotency-key': retryKey,
      },
      body: JSON.stringify({ seats: ['A13'] }),
    });
    retryStatuses.push(res.status);
  }

  console.log('Retry Statuses (All should return 201 cleanly):', retryStatuses);

  // 3. RECONCILIATION INVARIANT CHECK
  console.log('\n--- Test 3: Reconciliation Invariant Verification ---');
  const finalShowRes = await fetch(`${TARGET_URL}/shows/${showId}`);
  const finalShowState = await finalShowRes.json();
  
  console.log('Final Show State:', finalShowState);
  const invariantHolds = 
    (finalShowState.available + finalShowState.held + finalShowState.confirmed) === finalShowState.total_seats;
  
  console.log(`Reconciliation Invariant (available + held + confirmed == total_seats): ${invariantHolds ? '✅ PASSED' : '❌ FAILED'}`);
}

runBurst();