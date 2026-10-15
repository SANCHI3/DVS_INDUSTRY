# 3. System architecture

## 3.1 Overall system

Three processes on one machine or LAN: the React dashboard, the Express API
with PostgreSQL, and the Python perception service. The perception service is
a client of the API: it logs in with a dedicated `PERCEPTION_SERVICE` role that
can only create incidents and attach summaries.

```mermaid
flowchart LR
    subgraph Browser
        UI["React + Vite dashboard<br/>(admin, production, store, supplier, client)"]
    end
    subgraph Server["Node.js backend (Express 5, TypeScript)"]
        API["REST API /api/v1<br/>JWT auth + RBAC, Zod validation, audit log"]
        SSE["SSE stream<br/>/security/stream"]
        AN["Smart Analytics<br/>(forecasting, OEE, SPC)"]
    end
    DB[("PostgreSQL<br/>22 Prisma models")]
    subgraph Perception["Perception service (Python)"]
        CAM["Camera / RTSP / video file<br/>or demo playlist"]
        PIPE["Detection pipeline<br/>(see 3.2)"]
        OUT["output/<br/>incidents.jsonl, evidence,<br/>Grad-CAM, clips"]
    end
    LLM["LLM API (optional)<br/>OpenAI-compatible"]

    UI -- "HTTPS + Bearer JWT" --> API
    SSE -- "incident.created / updated" --> UI
    API <--> DB
    AN <--> DB
    CAM --> PIPE --> OUT
    PIPE -- "POST incident (CONFIRMED only)" --> API
    PIPE -- "facts only" --> LLM
    LLM -- "summary (validated)" --> PIPE
    PIPE -- "PATCH ai-summary" --> API
    API -- "read-only evidence join<br/>on incidentNumber" --> OUT
```

## 3.2 Perception pipeline

Each processed frame (10 per second, resized to 640×480) goes through the
stages below. The detectors run in the same loop; the expensive ones are gated
(they run only when people are close and moving, or on a stride).

```mermaid
flowchart TD
    F["Frame (10 fps, 640x480)"] --> Y["YOLOv8n<br/>people / objects"]
    Y --> T["ByteTrack<br/>track IDs"]
    T --> B["Temporal buffer<br/>30 s per track"]
    F --> EV["Evidence ring buffer<br/>15 s full resolution"]

    B --> R["Rule engine<br/>loitering, intrusion, crowd"]
    B --> FG["Motion gate"] --> FC["R3D-18 fight classifier<br/>16-frame clips, 2 of 3"] --> IV["Interaction check<br/>2 people, close, agitated"]
    B --> PG["Cheap fall gate"] --> PO["YOLOv8-Pose"] --> GRU["Temporal CNN + BiGRU<br/>4 s pose windows"]
    F --> FS["YOLOv8n fire/smoke<br/>3 of 5 frames"] --> DY["Static-region check<br/>flicker / growth"] --> LV["Learned verifier<br/>gradient boosting"]
    F --> OF["Optical flow + MOG2<br/>38 features / 2 s"] --> AE["Denoising autoencoder<br/>camera-calibrated threshold"]

    R & IV & GRU & LV & AE --> C["Event confirmation<br/>N-of-M, PROBABLE / CONFIRMED"]
    C --> S["Severity rules<br/>base + modifiers + hard caps"]
    S --> D["De-duplication<br/>one incident per ongoing event"]
    D --> REP["Incident reporter<br/>validate, save, evidence"]
    EV --> REP
    REP --> API["ERP API (CONFIRMED)"]
    REP --> L["LLM summary<br/>validated, template fallback"]
```

## 3.3 Database (ER diagram)

The 22 Prisma models, grouped by domain. Only keys and the main fields are
shown. Perception incidents are stored in `SecurityIncident`. The
perception `incident_id` becomes `incidentNumber`, which joins the record to
its evidence files without a schema change.

```mermaid
erDiagram
    Role ||--o{ User : has
    User ||--o{ RefreshToken : owns
    User ||--o{ PasswordResetToken : owns
    User |o--o| Employee : "linked to"
    Department ||--o{ Employee : employs
    Shift ||--o{ Employee : assigns
    Employee ||--o{ Employee : manages
    Employee ||--o{ Attendance : records
    Employee ||--o{ AttendancePunch : punches
    Material ||--o{ StockTransaction : moves
    Material ||--o{ ScrapRecord : scraps
    Supplier ||--o{ PurchaseOrder : receives
    Client ||--o{ ClientOrder : places
    WorkOrder ||--o{ WorkOrderOutput : produces
    SecurityIncident ||--o{ IncidentUpdate : "history"
    SecurityIncident |o--o{ SecurityAlert : raises

    User { int id PK
        string email
        string password "bcrypt hash"
        int roleId FK }
    Employee { int id PK
        string employeeCode
        int departmentId FK
        int shiftId FK }
    Material { int id PK
        string code
        decimal currentStock }
    WorkOrder { int id PK
        string workOrderNumber
        int targetQuantity }
    SecurityIncident { int id PK
        string incidentNumber "perception incident_id"
        enum type
        enum severity
        enum status
        float confidenceScore
        string aiSummary
        datetime occurredAt }
    IncidentUpdate { int id PK
        int incidentId FK
        string comment }
    SecurityAlert { int id PK
        int incidentId FK
        enum status }
    AuditLog { int id PK
        string action
        string entity
        int userId }
```

## 3.4 Incident sequence

From the moment a camera sees an event until a person on the dashboard
handles it.

```mermaid
sequenceDiagram
    autonumber
    participant Cam as Camera / demo video
    participant P as Perception service
    participant API as ERP API
    participant DB as PostgreSQL
    participant UI as Dashboard (browser)
    participant L as LLM (optional)
    actor Staff

    Cam->>P: frames (10 fps)
    P->>P: detect, track, run detectors
    P->>P: confirmation reaches CONFIRMED
    P->>P: severity, de-duplication, save record and evidence
    P->>API: POST /security/incidents (incident_id, type, severity, confidence)
    API->>DB: insert SecurityIncident (dedupe on incidentNumber)
    API-->>UI: SSE incident.created
    UI->>Staff: row appears live + priority pop-up (fire, CRITICAL, or confidence >= 90%)
    P->>L: plain facts (no scores)
    L-->>P: two-sentence summary
    P->>P: reject if it drops the location, adds jargon or new numbers
    P->>API: PATCH /security/incidents/ai-summary
    API-->>UI: SSE incident.updated
    Staff->>UI: open incident
    UI->>API: GET /security/incidents/:id/evidence
    API-->>UI: keyframes, Grad-CAM, clips, explanation
    Staff->>API: assign, investigate, resolve (audited)
    Note over P,API: a repeat of the same event updates the incident (escalation) instead of creating a new one
```
