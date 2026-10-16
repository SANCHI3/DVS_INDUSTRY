# 1. Introduction and problem statement

## 1.1 Background

A small or medium manufacturing plant runs on two kinds of information:

- **Operational data:** employees, shifts and attendance, materials and stock,
  client and supplier orders, and production work orders.
- **Safety and security data:** incidents such as fights, falls, fires
  and crowding.

Operational data is increasingly kept in an ERP. Safety monitoring usually
means CCTV cameras recording to a video recorder. Footage is reviewed after
something has happened, and nobody watches every camera continuously. An
incident on the floor may therefore be noticed only when someone reports it,
and its record is kept apart from the operational data.

## 1.2 Problem statement

Build a system that:

1. manages the plant's operational data in one ERP, with role-based access;
2. watches CCTV footage automatically and recognises safety incidents (fights,
   falls, fire/smoke, crowding, unusual activity) in real time;
3. raises **one** incident per real event, with a confidence, a severity and
   evidence, and alerts staff on every open dashboard within seconds;
4. explains each alert in plain language to staff who are not technical, and
   shows *why* the AI raised it;
5. keeps false alarms low enough that staff keep trusting the alerts.

## 1.3 Why a single object detector is not enough

YOLO-style detectors recognise *objects in one frame*. Most safety incidents
are defined by *behaviour over time*:

- A **fight** looks like two people standing close together in any single
  frame. It is the motion over a second or two that differs.
- A **fall** is the speed and direction of the body's collapse. Someone lying
  down on purpose ends in the same pose.
- **Fire look-alikes** (orange objects, lamps, reflections) produce the same
  detections frame after frame. Real flames flicker and smoke grows.
- **Unusual events** have no label at all.

The project therefore uses YOLO only as the first stage (finding and tracking
people) and adds a model suited to each incident type (chapter 5).

## 1.4 Objectives

- An ERP backend and dashboard for workforce, inventory, orders, production,
  security, reports, audit and analytics.
- A perception service with task-specific models, each evaluated against a
  baseline on held-out videos.
- Real-time delivery of incidents to the dashboard with a live alert pop-up.
- Evidence and explainability: keyframes, clips, Grad-CAM, plain-language
  reasons, and the basis of each confidence value.
- A demo mode that runs the whole chain without a camera.

## 1.5 Scope

In scope: one or more fixed cameras (webcam, RTSP or video file), a local
PostgreSQL database, and local deployment on one machine or a LAN server.

Out of scope: face recognition, person re-identification across cameras,
cloud deployment, and automatic actions without a human decision. Alerts are
always reviewed by staff.

## 1.6 Report organisation

- Chapter 3 surveys related work.
- Chapter 4 presents the architecture.
- Chapter 5 describes each module and why its model was chosen.
- Chapter 6 gives implementation details.
- Chapter 7 reports testing and results.
- Chapter 8 discusses limitations and future work.
- Chapter 9 concludes.
