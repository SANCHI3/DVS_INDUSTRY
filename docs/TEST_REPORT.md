# DVS Industry — Test & Validation Report

| Field | Value |
|---|---|
| Document ID | DVS-QA-TR-001 |
| Revision | 1.0 |
| Date of execution | 24 October 2026 |
| System under test | DVS Industry ERP + Perception Service, branch `master` — baseline `b799e8e`, verified after fixes at `792e48c` |
| Repository | https://github.com/SANCHI3/DVS_INDUSTRY |
| Test standard followed | Structure after IEEE 829 / ISO/IEC/IEEE 29119-3 (Test Summary Report) |
| Overall verdict | **PASS** — 397 / 397 automated tests pass; 4 defects found and closed |

---

## 1. Purpose and scope

This report records a full regression run of the DVS Industry system and the
validation status of its AI models. It covers:

| # | Subsystem | Type of test |
|---|---|---|
| 1 | Backend API (Node.js / Express / Prisma) | Static analysis, code-style, unit and integration tests |
| 2 | Frontend (React / Vite) | Static analysis, unit tests, production build |
| 3 | End-to-end (browser → API → PostgreSQL) | Playwright UI tests against a seeded database |
| 4 | Perception service (Python / PyTorch) | Unit, regression and false-positive scenario tests |
| 5 | AI models | Held-out evaluation metrics (precision, recall, F1, baseline comparison) |
| 6 | Supply chain | `npm audit` of production dependencies |

Out of scope: long-duration field trials on the deployment camera (see §8).

## 2. Test environments

| Environment | Where | Configuration |
|---|---|---|
| **CI — GitHub Actions** | `ubuntu-latest` hosted runners | Node 22, Python 3.12, CPU-only PyTorch, PostgreSQL 16 service container |
| **Local workstation** | Windows 11, developer laptop | Node 24.14, Python 3.11 venv, CPU-only PyTorch 2.14.1 |

## 3. Execution records (where the tests were run)

### 3.1 GitHub Actions — continuous integration

Workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) — runs on every push to `master` and on every pull request.

**Final verification run — commit `792e48c` (24 Oct 2026, after all fixes): [Run #40078158730](https://github.com/SANCHI3/DVS_INDUSTRY/actions/runs/40078158730) — ✅ SUCCESS (5 / 5 jobs)**

| Job | Result | Duration | Link |
|---|---|---|---|
| backend (typecheck, lint, format, 212 tests) | ✅ Pass | 52 s | [job log](https://github.com/SANCHI3/DVS_INDUSTRY/actions/runs/40078158730/job/120825905183) |
| frontend (typecheck, lint, 55 tests, build) | ✅ Pass | 29 s | [job log](https://github.com/SANCHI3/DVS_INDUSTRY/actions/runs/40078158730/job/120825905080) |
| e2e (Playwright + PostgreSQL 16) | ✅ Pass | 1 min 40 s | [job log](https://github.com/SANCHI3/DVS_INDUSTRY/actions/runs/40078158730/job/120825904963) |
| perception-service (pytest, 130 tests) | ✅ Pass | 1 min 25 s | [job log](https://github.com/SANCHI3/DVS_INDUSTRY/actions/runs/40078158730/job/120825905162) |
| audit (npm, production deps) | ✅ Pass | 7 s | [job log](https://github.com/SANCHI3/DVS_INDUSTRY/actions/runs/40078158730/job/120825905208) |

Run history during this test cycle:

| Run | Commit | Result | Note |
|---|---|---|---|
| [39976459749](https://github.com/SANCHI3/DVS_INDUSTRY/actions/runs/39976459749) | `b799e8e` (baseline, 23 Oct) | ✅ Success | Before this test cycle |
| [40077004703](https://github.com/SANCHI3/DVS_INDUSTRY/actions/runs/40077004703) | `2908ff7` | ❌ audit failed | DEF-001…003 fixed; new advisories found (DEF-004) |
| [40077665767](https://github.com/SANCHI3/DVS_INDUSTRY/actions/runs/40077665767) | `00b3ad9` | ❌ backend, e2e failed | Lockfile written by npm 11, rejected by npm 10 (DEF-004) |
| [40078158730](https://github.com/SANCHI3/DVS_INDUSTRY/actions/runs/40078158730) | `792e48c` | ✅ Success | All defects closed |

Earlier successful runs: [39963165846](https://github.com/SANCHI3/DVS_INDUSTRY/actions/runs/39963165846),
[39949564310](https://github.com/SANCHI3/DVS_INDUSTRY/actions/runs/39949564310),
[39825397831](https://github.com/SANCHI3/DVS_INDUSTRY/actions/runs/39825397831),
[39822663506](https://github.com/SANCHI3/DVS_INDUSTRY/actions/runs/39822663506).
Full history: https://github.com/SANCHI3/DVS_INDUSTRY/actions

### 3.2 Local regression run (24 Oct 2026)

| Suite | Command | Result |
|---|---|---|
| Backend — typecheck | `cd backend && npm run typecheck` | ✅ 0 errors |
| Backend — lint | `npm run lint` | ✅ 0 problems |
| Backend — code style | `npm run format:check` | ❌ → ✅ 4 files failed, fixed (DEF-001) |
| Backend — tests | `npm test` | ✅ **212 / 212 passed** (23 files) |
| Frontend — typecheck | `cd frontend && npm run typecheck` | ✅ 0 errors |
| Frontend — lint | `npm run lint` | ✅ 0 problems |
| Frontend — tests | `npm test` | ✅ **55 / 55 passed** (9 files) |
| Frontend — production build | `npm run build` | ✅ Built in 14.2 s |
| Perception — tests | `cd perception-service && python -m pytest -q` | ❌ → ✅ 1 failed (DEF-002), fixed → **130 / 130 passed** |
| Backend — dependency audit | `npm audit --omit=dev --audit-level=high` | ❌ → ✅ 3 high / 2 moderate (DEF-004), fixed → 0 vulnerabilities |
| Model metrics consistency | `python -m evaluation.run_all` | ❌ → ✅ exited with error (DEF-003), fixed → 21 result rows regenerated, all stored metrics consistent with confusion counts |

## 4. Summary of results

| Suite | Tests | Passed | Failed | Pass rate |
|---|---|---|---|---|
| Backend (Vitest + Supertest) | 212 | 212 | 0 | 100 % |
| Frontend (Vitest) | 55 | 55 | 0 | 100 % |
| Perception (pytest) | 130 | 130 | 0 | 100 % |
| End-to-end (Playwright, CI) | 2 spec files | ✅ all | 0 | 100 % |
| **Total (unit + integration)** | **397** | **397** | **0** | **100 %** |

## 5. AI model performance (held-out test data)

Source: [`docs/RESULTS.md`](RESULTS.md), generated by `perception-service/evaluation/run_all.py`
from the metrics files saved at training time. The script recomputes precision and recall
from the stored confusion counts and fails if they disagree.

| Incident | Deployed model | Precision | Recall | F1 | Baseline F1 | Test data | Status |
|---|---|---|---|---|---|---|---|
| Fight | R3D-18 3D CNN (video clips) | 0.94 | 0.97 | **0.96** | 0.85 | 344 test videos | ✅ Accepted |
| Fall | YOLOv8-Pose + BiGRU | 0.86 | 0.94 | **0.90** | 0.81 | 160 videos, 5-fold CV | ✅ Accepted |
| Fire | YOLOv8n + learned verifier | 1.00 | 0.91 | **0.95** | 0.87 | 27 FIRESENSE videos | ✅ Accepted |
| Smoke | YOLOv8n + learned verifier | 1.00 | 0.85 | **0.92** | 0.92 | 22 FIRESENSE videos | ✅ Accepted |
| Unusual activity | Autoencoder (unsupervised) | 0.96 | 0.67 | **0.79** | 0.52 | 102 videos | ⚠ Accepted with limitation (recall) |

Baseline = the simpler method each model replaced: fight v1 model, box-shape fall rule,
YOLO alone, autoencoder v1. The fire and smoke test sets are small (22–27 videos), so
their 95 % confidence intervals are wide (see `RESULTS.md` §1).

## 6. Defect log

| ID | Severity | Component | Description | Root cause | Resolution | Status |
|---|---|---|---|---|---|---|
| DEF-001 | Low | backend (tests) | `npm run format:check` failed on 4 test files: `assistant.service.test.ts`, `tools.test.ts`, `assistant.routes.test.ts`, `security.kpis.test.ts` | CI did not run the Prettier check, so unformatted code was merged without failing the build | Files reformatted with Prettier; `npm run format:check` added to the backend CI job so it cannot happen again | ✅ Closed — re-test passed (212/212, style clean) |
| DEF-002 | Medium | perception-service (evaluation) | `evaluation/ablation.py` line 558 raised `SyntaxError: f-string: unmatched '['` on Python 3.11; `test_evaluation.py::test_ablation_overrides_and_summary` failed | Same quote character reused inside an f-string (`{cal["clips"]}`), which is legal only on Python ≥ 3.12; the README supports 3.10–3.12, but CI tests only 3.12 | Inner quotes changed to `{cal['clips']}`; all perception modules compile on 3.11 | ✅ Closed — re-test passed (130/130) |
| DEF-003 | Low | perception-service (evaluation) | `python -m evaluation.run_all` exited with `metrics files neither used nor excluded: ['scene_anomaly_ae_v3_factory.metrics.json']`, so `RESULTS.md` could not be regenerated | The v3 factory-footage model (added 2026-10) is reported in `RESULTS.md` §7 by its own script but was not registered with the collector | File registered in the collector's exclusion list with its reason; outputs regenerated, no metric changed | ✅ Closed — re-run passed (21 rows) |
| DEF-004 | High | backend (dependencies) | CI `audit` job failed on 24 Oct 2026 ([run 40077004703](https://github.com/SANCHI3/DVS_INDUSTRY/actions/runs/40077004703)): new advisories for production dependencies — `multer` 2.4.0 (DoS, GHSA-q7qp-rjg7-q26m), `zod` < 4.6.6 (memory exhaustion, GHSA-mrhx-c7xc-m3w5), `nodemailer` ≤ 10.1.3 (address parsing, 3 advisories), `body-parser` 2.3.0, `ip-address` ≤ 10.7.3 | Advisories disclosed after the previous green run; no code change on our side. A first fix made with npm 11 rewrote the lockfile in a form CI's npm 10 rejects (`npm ci`: "Missing: magicast@0.3.5"), failing the backend and e2e jobs ([run 40077665767](https://github.com/SANCHI3/DVS_INDUSTRY/actions/runs/40077665767)) | Lockfile restored and the five packages updated with npm 10 (as in CI), within existing semver ranges: multer 2.5.0, zod 4.6.7, nodemailer 10.2.1, body-parser 2.4.0, ip-address 10.7.4 (42-line lockfile change) | ✅ Closed — 0 production vulnerabilities, `npm ci` in sync, 212/212 tests pass |

No defect affected the live system or the reported model metrics.

## 7. Test coverage by area (perception service)

| Area | Test file(s) |
|---|---|
| Rule engine and confirmation tiers | `test_rules_logic.py`, `test_crowd_logic.py` |
| False-positive regression (18 scenarios) | `test_false_positives.py` |
| Fight model sampling and gating | `test_rgb_sampling.py`, `test_learned_models.py` |
| Fall model | `test_fall_model.py` |
| Fire / smoke verifier | `test_fire_verifier.py` |
| Unusual-activity autoencoder | `test_scene_anomaly.py`, `test_train_factory.py` |
| Evidence extraction | `test_evidence.py` |
| Incident API, schema, de-duplication, outbox | `test_incident_api.py`, `test_incident_dedup.py`, `test_incident_report.py`, `test_reporter_outbox.py`, `test_dashboard_client.py` |
| Video input | `test_cctv_input.py`, `test_stream_reader_file.py`, `test_demo_mode.py` |
| LLM / plain-language output | `test_plain_language.py` |
| Evaluation statistics (bootstrap, McNemar) | `test_evaluation.py` |

## 8. Known limitations and residual risk

| # | Limitation | Impact | Mitigation |
|---|---|---|---|
| L1 | False alarms per hour on the deployment camera are not yet measured; on proxy clips the deployed system gives 37.6 false alarms/h | Operator alert fatigue possible in the field | `python -m evaluation.false_alarms --video <recording>` is ready to run once field footage exists |
| L2 | Unusual-activity recall is 0.67 | About 1 in 3 abnormal events not flagged by this detector | Specific detectors (fight, fall, fire) cover the high-severity events |
| L3 | Fire/smoke test sets are small (27 / 22 videos) | Wide confidence intervals | Collect more site footage |
| L4 | Fight interaction check separates classes weakly (ROC AUC 0.55) | Used as a review signal, not a veto | Re-tune on field recordings |

## 9. Conclusion

All automated test suites pass locally and in GitHub Actions. Four defects were found
and fixed (backend code style; a Python 3.11 syntax error in the ablation
report; a results-collector error; newly disclosed vulnerabilities in five
backend dependencies). Lockfiles must be regenerated with the npm version CI uses (npm 10 / Node 22); a CI step was added so the style defect
cannot recur. Recommendation: add Python 3.10/3.11 to the CI matrix, since
the README claims support for them. The deployed AI models meet or beat their baselines
on held-out data, with the limitations listed in §8. The build is **released
for demonstration**.

## 10. How to reproduce

```bash
# Backend
cd backend && npm ci && npx prisma generate
npm run typecheck && npm run lint && npm run format:check && npm test

# Frontend
cd ../frontend && npm ci
npm run typecheck && npm run lint && npm test && npm run build

# Perception service
cd ../perception-service
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
python -m pytest -q
python -m evaluation.run_all
```

## Approval

| Role | Name | Signature | Date |
|---|---|---|---|
| Prepared by | | | |
| Reviewed by | | | |
| Approved by (Guide) | | | |
