"""All factory cameras in one process: python main.py --all --no-display

One StreamReader thread per enabled camera keeps that camera's newest
sub-stream frame; a single inference loop takes the cameras in turn
(scheduler.FrameScheduler), so one PC can watch 8 channels. A camera that is
down or shows video loss is skipped and retried; it never stops the others.
Models are loaded once and shared (shared_models.py).

Environment:
    MAX_FPS_PER_CAMERA    frames per second for any one camera (default 1)
    MAX_INFER_FPS_TOTAL   frames per second across all cameras (default 8;
                          4 with REMOTE_MODE=true)
    REMOTE_MODE           true on a laptop over Tailscale: sub stream, <= 1 fps

The PC is shared, so this runs at BELOW_NORMAL priority and a CPU guard slows
detection when the computer is busy (system_load.py). If the DVR moves to a new
address the process exits with RESTART_EXIT and service.py starts it again.
"""
from __future__ import annotations

import dataclasses
import os
import sys
import time
from pathlib import Path
from typing import Optional

import yaml

from auto_update import current_version, update_info
from ingestion.camera_config import CameraSetup, load_camera_setup
from ingestion.dvr import mask_text
from ingestion.dvr_finder import DvrWatcher, read_notice
from ingestion.evidence_grabber import MainStreamGrabber, snapshot_frame
from ingestion.stream_reader import StreamReader
from main import build_detector, camera_info, inference_device, _env_float
from pipeline import CameraPipeline, section_configs
from reporting.camera_heartbeat import CameraHeartbeat
from reporting.evidence_uploader import EvidenceUploader, evidence_meta, pick_pictures
from reporting.incident_report import IncidentReporter
from scheduler import FrameScheduler
from system_load import CpuGuard, limit_model_threads, memory_mb, set_low_priority, write_status

STATS_EVERY_S = 60.0
STATUS_EVERY_S = 15.0
RESTART_EXIT = 75  # "start me again now": the DVR has a new address


def total_fps_limit(setup: CameraSetup) -> float:
    return _env_float("MAX_INFER_FPS_TOTAL", 4.0 if setup.remote_mode else 8.0)


def limit_camera_fps(cameras: list) -> list:
    """The server is shared: a higher fps in cameras.yaml is not honoured."""
    most = _env_float("MAX_FPS_PER_CAMERA", 1.0)
    return [dataclasses.replace(c, fps=min(c.fps, most)) for c in cameras]


def format_stats(stats: dict, statuses: dict, cpu: Optional[float] = None, speed: float = 1.0) -> str:
    parts = []
    for cam_id, s in stats.items():
        ms = f"{s['infer_ms']:.0f} ms" if s["infer_ms"] is not None else "-"
        parts.append(f"{cam_id} {statuses.get(cam_id, '?').lower()} {s['fps']:.1f} fps {ms}")
    load = f"cpu {cpu:.0f}% speed {speed:.0%} | " if cpu is not None else ""
    return "[perf] " + load + " | ".join(parts)


def run_all(camera_ids: Optional[list[str]] = None, max_seconds: Optional[float] = None,
            only_events: Optional[set[str]] = None, output_dir: str = "output",
            config_dir: str = "config", heartbeat=None) -> None:
    setup = load_camera_setup(os.path.join(config_dir, "cameras.yaml"))
    with open(os.path.join(config_dir, "thresholds.yaml"), encoding="utf-8") as f:
        thresholds_cfg = yaml.safe_load(f)

    cameras = [c for c in setup.enabled if c.is_dvr]
    if camera_ids:
        wanted = set(camera_ids)
        cameras = [c for c in setup.cameras if c.id in wanted]
        missing = wanted - {c.id for c in cameras}
        if missing:
            raise SystemExit(f"not in cameras.yaml: {', '.join(sorted(missing))}")
    if not cameras:
        raise SystemExit("no enabled cameras in config/cameras.yaml")
    if any(c.is_dvr for c in cameras) and setup.dvr is None:
        raise SystemExit("DVR_HOST is not set in perception-service/.env (see docs/CCTV_SETUP.md)")
    password = setup.dvr.password if setup.dvr else ""
    cameras = limit_camera_fps(cameras)

    set_low_priority()
    threads = limit_model_threads()
    limit = total_fps_limit(setup)
    print(f"[multi] {len(cameras)} camera(s), up to {limit:g} frames/s in total"
          f"{' (REMOTE_MODE: sub stream, low fps)' if setup.remote_mode else ''}")
    print(f"[multi] inference device: {inference_device()}, {threads} model threads")

    detector = build_detector(thresholds_cfg)
    reporter = IncidentReporter(
        output_path=os.path.join(output_dir, "incidents.jsonl"),
        camera_locations={c.id: c.location for c in cameras},
        camera_info={c.id: camera_info(c.metadata(), c.id, c.location) for c in cameras},
        backend_url=os.getenv("LEGACY_INCIDENT_API_URL", "").strip() or None,
        background=True,
    )
    evidence_dir = section_configs(thresholds_cfg, output_dir, demo=False)["evidence"]["output_dir"]
    website = bool(os.getenv("DASHBOARD_BACKEND_URL", "").strip())
    uploader = EvidenceUploader(os.path.join(output_dir, "upload_queue")) if website else None
    # incident id -> (keyframes, Grad-CAM, details) waiting for the main-stream grab
    waiting: dict[str, tuple[list, list, dict]] = {}

    def send_evidence(incident_id: str, main_frames: list) -> None:
        keyframes, gradcam, meta = waiting.pop(incident_id, ([], [], {}))
        if main_frames:
            reporter.update_evidence(incident_id, {"main_frames": main_frames})
        if uploader is not None:
            uploader.enqueue(incident_id, pick_pictures(keyframes, main_frames, gradcam), meta)

    channels = {c.id: c.channel for c in cameras}
    grabber = MainStreamGrabber(
        os.path.join(evidence_dir, "main"), password=password, on_saved=send_evidence,
        fallback=(lambda cam_id: snapshot_frame(setup.dvr, channels[cam_id])) if setup.dvr else None,
    )

    guard = CpuGuard()
    readers: dict[str, StreamReader] = {}
    pipelines: dict[str, CameraPipeline] = {}
    for cam in cameras:
        evidence_url = cam.evidence_source(setup.dvr)

        def on_incident(incident_id: str, _event: str, cam_id=cam.id, url=evidence_url, *, report=None,
                        keyframes=None, detail=None, repeat=False) -> None:
            detail = detail or {}
            waiting[incident_id] = (list(keyframes or []), list(detail.get("gradcam_heatmaps") or []),
                                    evidence_meta(report or {}, detail))
            if url:
                grabber.request(incident_id, cam_id, url)
            else:
                send_evidence(incident_id, [])

        pipelines[cam.id] = CameraPipeline(
            cam.id, cam.to_runtime_dict(setup.dvr), thresholds_cfg, detector, reporter,
            output_dir=output_dir, only_events=only_events, fps=cam.fps, on_incident=on_incident,
        )
        readers[cam.id] = StreamReader(
            source=cam.detect_source(setup.dvr), camera_id=cam.id, target_fps=cam.fps,
            connect_timeout_s=_env_float("CCTV_CONNECT_TIMEOUT_SECONDS", 10.0),
            read_timeout_s=_env_float("CCTV_READ_TIMEOUT_SECONDS", 10.0),
            reconnect_delay_s=_env_float("CCTV_RECONNECT_INITIAL_SECONDS", 2.0),
            reconnect_max_delay_s=_env_float("CCTV_RECONNECT_MAX_SECONDS", 60.0),
        ).start()
        print(f"[{cam.id}] {cam.location}: channel {cam.channel}, {cam.detect_stream} stream, "
              f"{cam.fps:g} fps, rules {', '.join(pipelines[cam.id].events) or 'none'}")

    notice_path = Path(output_dir) / "dvr_address.json"
    status_path = Path(output_dir) / "status.json"
    env_path = Path(__file__).resolve().parent / ".env"
    watcher = None
    dvr_mac = os.getenv("DVR_MAC", "").strip()
    if setup.dvr is not None and dvr_mac and not setup.remote_mode and env_path.is_file():
        watcher = DvrWatcher(setup.dvr.host, setup.dvr.rtsp_port, dvr_mac, env_path, notice_path).start()

    if heartbeat is None and os.getenv("DASHBOARD_BACKEND_URL", "").strip():
        heartbeat = CameraHeartbeat(cameras, info=lambda: {
            "device": inference_device(),
            "remoteMode": setup.remote_mode,
            "maxInferFps": limit,
            "evidenceQueueMb": round(uploader.size_bytes() / 1e6, 1) if uploader else None,
            "evidenceQueueItems": uploader.pending() if uploader else None,
            "dvrNotice": read_notice(notice_path),
            "liveUrl": os.getenv("LIVE_VIEW_URL", "").strip().rstrip("/") or None,
            "cpuPercent": round(guard.cpu),
            "detectionSpeed": guard.speed,
            "version": current_version(),
            "memoryMb": memory_mb(),
            **update_info(),
        })
        print(f"[multi] camera status to the website as '{heartbeat.instance_id}' ({heartbeat.source})")
    scheduler = FrameScheduler({c.id: c.fps for c in cameras}, max_total_fps=limit)
    last_index = {c.id: -1 for c in cameras}
    was_lost = {c.id: False for c in cameras}
    started = last_stats = last_status = time.monotonic()
    latest_stats: dict = {}

    def statuses() -> dict:
        return {cam_id: r.status()["status"] for cam_id, r in readers.items()}

    def save_status() -> None:
        now_status = statuses()
        write_status(
            status_path,
            version=current_version(),
            cpuPercent=round(guard.cpu),
            memoryMb=memory_mb(),
            detectionSpeed=guard.speed,
            cameras={c.id: {"name": c.name, "status": now_status.get(c.id, "OFFLINE"),
                            "fps": (latest_stats.get(c.id) or {}).get("fps")} for c in cameras},
            websiteOkAt=getattr(heartbeat, "last_ok_at", None),
            websiteError=getattr(heartbeat, "last_error", None),
        )

    restart = False
    save_status()
    try:
        while True:
            now = time.monotonic()
            if max_seconds and now - started > max_seconds:
                print("[multi] max_seconds reached, stopping")
                break
            if watcher is not None and watcher.moved_to:
                print("[multi] restarting to connect to the DVR's new address")
                restart = True
                break
            scheduler.speed = guard.tick()
            if now - last_stats >= STATS_EVERY_S:
                last_stats = now
                latest_stats = scheduler.take_stats()
                print(format_stats(latest_stats, statuses(), guard.cpu, guard.speed), flush=True)
            if now - last_status >= STATUS_EVERY_S:
                last_status = now
                save_status()
            if heartbeat is not None:
                heartbeat.tick(readers, pipelines)

            cam_id = scheduler.next_camera()
            if cam_id is None:
                time.sleep(min(max(scheduler.wait_time(), 0.005), 0.1))
                continue
            reader = readers[cam_id]
            sample = reader.get_latest()
            if sample is None or sample.frame_index == last_index[cam_id]:
                scheduler.skip(cam_id, 0.05)
                continue
            last_index[cam_id] = sample.frame_index
            if reader.video_loss:
                if not was_lost[cam_id]:
                    print(f"[{cam_id}] video loss ({reader.health.state.status.lower()} picture) -- "
                          f"detection paused for this camera")
                was_lost[cam_id] = True
                scheduler.skip(cam_id, 1.0)
                continue
            if was_lost[cam_id]:
                print(f"[{cam_id}] picture back -- detection resumed")
                was_lost[cam_id] = False
                pipelines[cam_id].reset_scene()

            t0 = time.perf_counter()
            try:
                pipelines[cam_id].process(sample)
            except Exception as exc:  # noqa: BLE001 - one camera's error must not stop the rest
                print(f"[{cam_id}] processing error: {mask_text(exc, password)}")
            scheduler.done(cam_id, (time.perf_counter() - t0) * 1000.0)
    except KeyboardInterrupt:
        print("[multi] stopping")
    finally:
        if watcher is not None:
            watcher.stop()
        for r in readers.values():
            r.stop()
        grabber.close()
        reporter.close()
        if uploader is not None:
            uploader.close()
        for cam_id, pipe in pipelines.items():
            print(f"[{cam_id}] processed {pipe.frames_processed} frames, "
                  f"incidents {dict(pipe.incident_counts) or 'none'}")
    if restart:
        sys.exit(RESTART_EXIT)
