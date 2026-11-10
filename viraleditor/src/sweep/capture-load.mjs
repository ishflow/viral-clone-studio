// Fixed local CPU load for capture-investigation.mjs; the parent terminates each worker in finally.
let value = 0;
for (;;) {
  for (let n = 0; n < 100000; n++) value = (value + Math.sqrt(n)) % 1000000;
}
