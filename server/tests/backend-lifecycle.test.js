const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateRetainedAllocation } = require("../src/modules/payments/service");

test("retained cancellation balance is split using commission on the amount left after refund", () => {
  const original = calculateRetainedAllocation(101, 0, 100);
  const afterRefund = calculateRetainedAllocation(101, 1, 100);

  assert.deepEqual(original, {
    retainedAmountPaise: 101,
    commissionPaise: 1,
    providerAmountPaise: 100,
  });
  assert.deepEqual(afterRefund, {
    retainedAmountPaise: 100,
    commissionPaise: 1,
    providerAmountPaise: 99,
  });
  assert.equal(original.providerAmountPaise - afterRefund.providerAmountPaise, 1);
});

test("full refunds leave no fee or provider amount, including at zero commission", () => {
  assert.deepEqual(calculateRetainedAllocation(10_000, 10_000, 500), {
    retainedAmountPaise: 0,
    commissionPaise: 0,
    providerAmountPaise: 0,
  });
  assert.deepEqual(calculateRetainedAllocation(10_000, 2_500, 0), {
    retainedAmountPaise: 7_500,
    commissionPaise: 0,
    providerAmountPaise: 7_500,
  });
});
