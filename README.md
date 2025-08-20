# Notion → Google Calendar Task Sync

A Google Apps Script project that bridges **Notion** and **Google Calendar**.  
It turns tasks from a Notion database into Google Calendar events and automatically creates a **Daily Task Review** summary event.

## Features

- **Sync Notion tasks → Calendar events**  
  - Creates an all-day event for each task with a due date.  
  - Includes details in the event description (Type, Class, Resources).  
  - Marks tasks as `Synced` in Notion to prevent duplicates.

- **Daily Task Review summary**  
  - Creates (or updates) a **Daily Task Review** all-day event each morning.  
  - Summarizes unfinished tasks that are:  
    - 🔴 Overdue  
    - 🟡 Due Today  
    - 🟠 Due Tomorrow  
    - 🟢 Due in the Next 7 Days  
  - Provides a quick glance at what’s due without opening Notion.

- **Preserves task history**  
  - Each day’s review event is unique, so you can look back at past daily summaries.

---

## Setup

### 1. Clone the Script
- Open [Google Apps Script](https://script.google.com/).
- Create a new project.
- Paste the contents of [`Code.gs`](./Code.gs) into the editor.

### 2. Configure Notion
- Create a Notion integration and copy the **Internal Integration Token**.  
- Share your task database with the integration.  
- Copy the **Database ID** from the Notion URL.

### 3. Configure Google Calendar
- Decide which calendar should hold the tasks and daily summary.  
- Copy its **Calendar ID**:
  - Go to **Google Calendar → Settings → [Your Calendar] → Integrate calendar → Calendar ID**.

### 4. Fill in the Config
In the script’s `CONFIG` section, replace with your values:

```javascript
const NOTION_TOKEN = "YOUR_NOTION_TOKEN";
const DATABASE_ID = "YOUR_DATABASE_ID";
const CALENDAR_ID = "YOUR_CALENDAR_ID";
