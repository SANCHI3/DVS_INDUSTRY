"""Focused deterministic tests for crowd gathering detection.
Run from the project root:  py -3.12 -u test_crowd_logic.py
"""
import yaml

from temporal.rule_engine import RuleEngine
from temporal.temporal_buffer import TemporalBuffer

with open("config/cameras.yaml") as f:
    cameras = yaml.safe_load(f)
with open("config/thresholds.yaml") as f:
    thresholds = yaml.safe_load(f)

# Isolate this test from any configured crowd zones (whole-frame crowding).
cam = dict(cameras["cameras"][0])
cam["zones"] = []
engine = RuleEngine(cam, thresholds)

def crowd_candidates(buffer):
    return [c for c in engine.evaluate(buffer) if c.event_type == "crowd"]

def add_people(buffer, timestamp, positions):
    for pid, (x, y) in enumerate(positions, start=1):
        # 40x160 person boxes; x/y denotes bottom-centre.
        buffer.update(pid, "person", (x - 20, y - 160, x + 20, y), 0.90, timestamp=timestamp)

print("TEST 1: separated people must not form a crowd")
b = TemporalBuffer()
for step in range(8):
    add_people(b, 1000.0 + step, [(50,300), (250,300), (450,300), (630,300)])
    assert not crowd_candidates(b), "Separated people incorrectly formed a crowd"
print("  PASS")

print("TEST 2: clustered people must persist for five seconds")
engine._crowd_state = {}
b = TemporalBuffer()
cluster = [(260,300), (310,300), (360,300), (410,300)]
for step in range(6):
    add_people(b, 2000.0 + step, cluster)
    assert not crowd_candidates(b), "Crowd fired before sustained_seconds"
add_people(b, 2006.0, cluster)
events = crowd_candidates(b)
assert len(events) == 1, "Sustained crowd did not fire"
assert events[0].detail["count"] == 4
assert events[0].detail["sustained_seconds"] >= 5.0
print("  PASS", events[0].detail)

print("TEST 3: a stale fourth track must not keep a crowd alive")
engine._crowd_state = {}
b = TemporalBuffer()
add_people(b, 3000.0, cluster)
for step in range(1, 8):
    # Only three tracks continue; track 4 remains in the buffer but becomes stale.
    add_people(b, 3000.0 + step, cluster[:3])
    assert not crowd_candidates(b), "Stale person track incorrectly counted"
print("  PASS")

print("All crowd tests passed.")
