/** Private stdin review bridge. No Docker calls or executable retained adapter. */
import { reviewRetained, recoveryDesign } from '../../scripts/vectorRetainedReview.mjs';
let input = '';
try {
  for await (const block of process.stdin) {
    input += block;
    if (Buffer.byteLength(input) > 2097152) throw Error('VAR_PRIVATE_INPUT_BOUND');
  }
  const value = JSON.parse(input); input = '';
  const recoveryPlan = recoveryDesign(value.assessment);
  const receipt = reviewRetained({ ...value, recoveryPlan });
  process.stdout.write(JSON.stringify({ receipt, recoveryPlan }));
} catch (e) {
  process.stderr.write(/^VAR_[A-Z_]+$/.test(e.message) ? e.message : 'VAR_REVIEW_STOPPED');
  process.exitCode = 1;
}
