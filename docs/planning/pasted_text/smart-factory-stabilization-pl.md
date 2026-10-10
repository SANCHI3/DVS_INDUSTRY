You are acting as the Lead Frontend Engineer, Enterprise UI Architect, QA Engineer, and Product Owner for the DVS Industries Smart Factory Platform.

This project is now entering the Frontend Stabilization Phase.

The objective is NOT to redesign the application.

The objective is to make the frontend production-ready.

=========================================================
CRITICAL RULES
=========================================================

DO NOT redesign the UI.

DO NOT change:

• Theme
• Colors
• Typography
• Sidebar
• Navigation styling
• Existing layouts
• Existing cards
• Existing dashboards
• Existing animations
• Existing branding
• Existing icons
• Existing spacing

Preserve the current industrial red, brown and white enterprise design.

Only improve functionality, architecture and user experience.

=========================================================
PHASE 1 — COMPLETE APPLICATION AUDIT
=========================================================

Perform a complete frontend audit.

Find and fix:

• Broken buttons
• Dead links
• Duplicate pages
• Duplicate cards
• Duplicate forms
• Duplicate tables
• Empty components
• Placeholder content
• Unused UI
• Unreachable routes
• Non-working actions
• Missing validations
• Missing loading states
• Missing empty states
• Missing error states

Remove unnecessary components while preserving the current design.

=========================================================
PHASE 2 — MAKE EVERY BUTTON FUNCTIONAL
=========================================================

Every interactive element must work.

Examples:

Create

Edit

Delete

Save

Cancel

Search

Filter

Reset

Approve

Reject

Assign

Calculate

Generate

Download

Upload

Export PDF

Export CSV

Print

Dispatch

Track

View Details

Sync

Order Now

Create Purchase Order

Create Client Order

Generate Invoice

Generate Delivery Challan

Generate Report

Update Inventory

Run Production

Run Calculator

All buttons must either:

Navigate

Open Modal

Submit Form

Execute Business Logic

Update Data

Export Data

Show Notification

No decorative buttons are allowed.

=========================================================
PHASE 3 — COMPLETE NAVIGATION
=========================================================

Ensure navigation is fully connected.

Landing Page

↓

Login

↓

Role Selection

↓

Role Dashboard

↓

Modules

↓

Reports

↓

Logout

Every navigation item must work.

Breadcrumbs must update correctly.

Back navigation must work.

=========================================================
PHASE 4 — ROLE BASED ACCESS
=========================================================

Administrator

Full ERP Access

Production

Production Module Only

Quality

Inventory & Quality Only

Store

Orders & Supply Only

Supplier

Supplier Portal

Client

Client Portal

Hide unauthorized modules.

Protect unauthorized routes.

Display Access Denied page if a restricted URL is accessed.

=========================================================
PHASE 5 — FORM VALIDATION
=========================================================

Every form must have validation.

Required fields

Numeric validation

Date validation

Dropdown validation

Email validation

Phone validation

Duplicate prevention

Confirmation dialogs

Unsaved changes warning

=========================================================
PHASE 6 — CRUD COMPLETION
=========================================================

Complete CRUD operations for:

Employees

Suppliers

Clients

Inventory

Materials

Purchase Orders

Client Orders

Machines

Departments

Reports

Settings

Each CRUD must support:

Create

Read

Update

Delete

Search

Filter

Sort

Pagination

=========================================================
PHASE 7 — MODULE CONNECTION
=========================================================

Connect all modules together.

Supplier

↓

Purchase Order

↓

Material Received

↓

Inventory Updated

↓

Production Planning

↓

Machine Assignment

↓

Worker Assignment

↓

Production

↓

Quality Inspection

↓

Finished Goods Inventory

↓

Client Orders

↓

Dispatch

↓

Delivery

↓

Reports

↓

AI Analytics

Every module should automatically update related modules.

=========================================================
PHASE 8 — INVENTORY WORKFLOW
=========================================================

Inventory should trigger Purchase Orders automatically.

Stock Status

Green

In Stock

Orange

Low Stock

Red

Out of Stock

If Low Stock

Show

Request Reorder

If Out of Stock

Show

Order Now

Clicking Order Now

↓

Open Purchase Order

↓

Auto-select Material

↓

Recommend Supplier

↓

Generate PO

↓

Notify Supplier

=========================================================
PHASE 9 — CLIENT DISPATCH
=========================================================

Dispatch button should only activate when:

Production Complete

Quality Passed

Inventory Available

Click Dispatch

↓

Generate Invoice

↓

Generate Delivery Challan

↓

Update Shipment

↓

Notify Client

↓

Close Order

=========================================================
PHASE 10 — FACE RECOGNITION ATTENDANCE
=========================================================

Do NOT create another attendance system.

Design integration with the existing DVS Face Recognition Attendance Software.

Architecture

Face Scanner

↓

Attendance Software

↓

Attendance API

↓

Integration Layer

↓

Workforce Dashboard

Display

Sync Status

Last Sync

Connected Device

Attendance Today

Working Hours

Check-in

Check-out

Overtime

Late Entry

Attendance History

Manual Sync Button

API Health

=========================================================
PHASE 11 — LOADING STATES
=========================================================

Every page must include

Loading Skeleton

Spinner

Progress Bar

Empty State

No Data State

Error State

Retry Button

=========================================================
PHASE 12 — TABLE IMPROVEMENTS
=========================================================

Every table must support

Search

Filter

Sorting

Pagination

Column Visibility

Export CSV

Export PDF

Print

Responsive Layout

Sticky Header

=========================================================
PHASE 13 — RESPONSIVENESS
=========================================================

Optimize for

Desktop

Laptop

Tablet

Mobile

Ensure no layout breaks.

=========================================================
PHASE 14 — PERFORMANCE
=========================================================

Optimize frontend.

Lazy Loading

Code Splitting

Memoization

Image Optimization

Component Reuse

Remove Duplicate Rendering

Optimize Bundle Size

=========================================================
PHASE 15 — CODE ORGANIZATION
=========================================================

Refactor code into a scalable structure.

Use:

Pages

Components

Layouts

Routes

Hooks

Services

Utils

Types

Constants

Context

Keep components reusable.

Avoid duplicated code.

=========================================================
PHASE 16 — USER EXPERIENCE
=========================================================

Improve UX without changing design.

Toast Notifications

Confirmation Dialogs

Success Messages

Keyboard Navigation

Hover States

Focus States

Smooth Transitions

Consistent Button Behavior

=========================================================
PHASE 17 — FINAL QA
=========================================================

Before completion verify:

✓ Every button works

✓ Every page works

✓ Every modal works

✓ Every form validates

✓ Every CRUD works

✓ No duplicate UI

✓ No placeholder data

✓ No broken navigation

✓ No dead routes

✓ No missing icons

✓ No empty pages

✓ No console errors

✓ No TypeScript errors

✓ No responsive issues

✓ No accessibility issues

✓ Existing UI preserved

✓ Existing workflows preserved

The application should feel like a production-ready industrial ERP similar to SAP Manufacturing, Oracle Manufacturing Cloud, Siemens Opcenter, or Microsoft Dynamics 365 Supply Chain.