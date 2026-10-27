# Bounded development retest

Initial comparison: baseline `6bf7fd4`, candidate `c1eb79b` (`v2-claim-1`), nine matched cases each. All 18 rows completed, using 88 paid model attempts. Structured checks passed 5/9 baseline and 6/9 candidate. These are preliminary structured outcomes, not the final semantic assessment.

Observed candidate defects before the correction pass:

- `explicit-payment-details`: the generic amount.value field was interpreted as dollars (129), while the specialist correctly used cents (12900). Validation blocked the inconsistent finding. Add an explicit integer-US-cents description to that schema field and the orchestrator instruction; do not convert ambiguous values after generation or relax the guard.
- `explicit-other-invoice`: the model attempted an out-of-scope investigation and Reviewer then demanded unnecessary clarification/checking. Retain scope denial; explain that an explicitly different invoice can receive a scope explanation/operator referral without repeating a known invoice or promising an unavailable cross-account lookup.
- `business-yes-with-unknown-terms`: Reviewer promoted agreement to check into a business payment report and pushed the specialist toward an invalid report without an amount. Clarify the distinction between agreeing to investigate and reporting money received; retain unknown fields and the report/recognition validators.

One correction pass, baseline `v2-claim-2`, then candidate-only retest of these three unchanged cases under the same remaining budget. Keep every original row. The rerun is development evidence on known failures, not a new complete matched comparison, held-out test or proof that all nine cases pass at the new revision. No automatic further tuning pass is authorized by this protocol.
