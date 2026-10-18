"""
Lightweight sanity test for the rule engine / confirmation / severity logic,
independent of YOLO/camera hardware. Simulates track histories directly.
Run: python test_rules_logic.py
"""
import time

import yaml

from confirmation.event_confirmation import EventConfirmation
from severity.severity_rules import compute_severity
from temporal.rule_engine import RuleEngine
from temporal.temporal_buffer import TemporalBuffer

with open("config/cameras.yaml") as f:
    cameras_cfg = yaml.safe_load(f)
with open("config/thresholds.yaml") as f:
    thresholds_cfg = yaml.safe_load(f)

# Pin the crowd threshold so the 4-person demo below still forms a crowd.
thresholds_cfg["rules"]["crowd"]["person_count_threshold"] = 3
cam_cfg = cameras_cfg["cameras"][0]
rule_engine = RuleEngine(cam_cfg, thresholds_cfg)
confirmation = EventConfirmation(thresholds_cfg["confirmation"])

print("=== TEST 1: Crowd gathering (4 people, threshold=3) ===")
buffer2 = TemporalBuffer()
confirmation2 = EventConfirmation(thresholds_cfg["confirmation"])
for i in range(6):
    for pid in range(1, 5):
        buffer2.update(track_id=pid, class_name="person", bbox=(300 + pid * 20, 100, 340 + pid * 20, 300), confidence=0.9)
    candidates = rule_engine.evaluate(buffer2)
    confirmed = confirmation2.update(candidates)
    for c in confirmed:
        sev = compute_severity(c.event_type, c, thresholds_cfg["severity"])
        print(f"  cycle {i}: {c.tier} {c.event_type} conf={c.confidence:.2f} severity={sev} detail={c.candidate.detail}")

print("\n=== TEST 2: Fall (aspect ratio flips from tall to wide, then stays still) ===")
print("    (uses configured thresholds: flip window "
      f"{thresholds_cfg['rules']['fall']['aspect_ratio_flip_seconds']}s, "
      f"stillness {thresholds_cfg['rules']['fall']['stillness_seconds']}s -- test runs real time to match)")
buffer3 = TemporalBuffer()
confirmation3 = EventConfirmation(thresholds_cfg["confirmation"])
stillness_needed = thresholds_cfg["rules"]["fall"]["stillness_seconds"]
# standing: tall narrow box (just one state so the "before" aspect ratio is captured)
buffer3.update(track_id=9, class_name="person", bbox=(300, 100, 340, 300), confidence=0.9)  # w=40,h=200 -> ar=0.2
rule_engine.evaluate(buffer3)
time.sleep(0.3)
# fallen: wide short box, stays in same place (still) for longer than stillness_needed
steps = int((stillness_needed + 2) / 0.5) + 1
for i in range(steps):
    buffer3.update(track_id=9, class_name="person", bbox=(280, 260, 400, 300), confidence=0.9)  # w=120,h=40 -> ar=3.0
    candidates = rule_engine.evaluate(buffer3)
    confirmed = confirmation3.update(candidates)
    for c in confirmed:
        sev = compute_severity(c.event_type, c, thresholds_cfg["severity"])
        print(f"  cycle {i} (t={i*0.5:.1f}s): {c.tier} {c.event_type} conf={c.confidence:.2f} severity={sev} detail={c.candidate.detail}")
    time.sleep(0.5)

print("\n=== TEST 3: Normal walking (no fall, count<threshold) should NOT fire ===")
buffer4 = TemporalBuffer()
confirmation4 = EventConfirmation(thresholds_cfg["confirmation"])
fired = False
for i in range(6):
    x = 250 + i * 10
    buffer4.update(track_id=5, class_name="person", bbox=(x, 100, x + 40, 300), confidence=0.9)  # tall box, moving
    candidates = rule_engine.evaluate(buffer4)
    confirmed = confirmation4.update(candidates)
    if confirmed:
        fired = True
        for c in confirmed:
            print(f"  UNEXPECTED FIRE: {c.tier} {c.event_type}")
print("  no false positive fired" if not fired else "  FAILED: false positive triggered")

print("\nAll logic tests completed.")
