/**
 * This script pulls tasks from a Notion database and creates Google Calendar events.
 * The event description includes Type, Class, and Links/Resources from Notion.
 */

// CONFIG — Fill these in with your info
const NOTION_TOKEN = "YOUR_NOTION_TOKEN";
const DATABASE_ID = "YOUR_NOTION_DATABASE_ID";
const CALENDAR_ID = "YOUR_GOOGLE_CALENDAR_ID";
const TITLE_FIELD = "Task";
const REMINDER_EVENT_TITLE = "Daily Task Review";


function runDailySyncAndReview() {
  syncNotionTasksToGoogleCalendar();
  updateDailyTaskReview();
}

/**
 * Create all-day events for Notion tasks where:
 * - Due is set
 * - Done is false
 * - Synced is false (prevents duplicates)
 * Then mark Synced = true on the Notion page.
 */
function syncNotionTasksToGoogleCalendar() {
  const headers = {
    "Authorization": "Bearer " + NOTION_TOKEN,
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
  };

  const query = {
    filter: {
      and: [
        { property: "Due", date: { is_not_empty: true } },
        { property: "Done", checkbox: { equals: false } },
        { property: "Synced", checkbox: { equals: false } },
      ],
    },
    page_size: 100,
  };

  const resp = UrlFetchApp.fetch(
    "https://api.notion.com/v1/databases/" + DATABASE_ID + "/query",
    { method: "post", headers, payload: JSON.stringify(query), muteHttpExceptions: true }
  );

  if (resp.getResponseCode() < 200 || resp.getResponseCode() >= 300) {
    console.error("Notion query failed:", resp.getResponseCode(), resp.getContentText());
    return;
  }

  const data = JSON.parse(resp.getContentText());
  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!calendar) {
    console.error("Calendar not found. Check CALENDAR_ID and sharing permissions.");
    return;
  }

  (data.results || []).forEach((page) => {
    const props = page.properties || {};
    const pageId = page.id;
    const title = (props[TITLE_FIELD]?.title?.[0]?.plain_text || "Untitled Task").trim();
    const dueStart = props["Due"]?.date?.start; // ISO date/datetime
    if (!dueStart) return;

    // Normalize to all-day (local midnight)
    const d = new Date(dueStart);
    const allDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());

    const taskType = props["Type"]?.select?.name || "N/A";
    const classRelId = props["Class"]?.relation?.[0]?.id || "None";
    const linkUrl = props["Links/Resources"]?.url || "";

    const description =
      "Type: " + taskType + "\n" +
      "Class: " + classRelId + "\n" +
      "Resources: " + linkUrl;

    try {
      const event = calendar.createAllDayEvent(title, allDay, { description });
      if (event && event.getId()) {
        updateNotionCheckbox(pageId, { Synced: { checkbox: true } });
      }
    } catch (e) {
      console.error("Failed to create event:", e);
    }
  });
}

/**
 * Build a summary of unfinished tasks that are:
 * - Overdue
 * - Due today
 * - Due tomorrow
 * - Due within the next 7 days
 * Then upsert (create or update) today's Daily Task Review all-day event.
 */
function updateDailyTaskReview() {
  const tz = Session.getScriptTimeZone(); // e.g., America/New_York
  const today = new Date(); today.setHours(0,0,0,0);
  const next7 = new Date(today); next7.setDate(today.getDate() + 7);

  const next7ISO = Utilities.formatDate(next7, tz, "yyyy-MM-dd");

  const headers = {
    "Authorization": "Bearer " + NOTION_TOKEN,
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
  };

  // Unfinished tasks due on/before 7 days from now (includes overdue + today)
  const query = {
    filter: {
      and: [
        { property: "Due", date: { is_not_empty: true } },
        { property: "Due", date: { on_or_before: next7ISO } },
        { property: "Done", checkbox: { equals: false } }
      ]
    },
    sorts: [{ property: "Due", direction: "ascending" }],
    page_size: 100
  };

  const resp = UrlFetchApp.fetch(
    "https://api.notion.com/v1/databases/" + DATABASE_ID + "/query",
    { method: "post", headers, payload: JSON.stringify(query), muteHttpExceptions: true }
  );

  if (resp.getResponseCode() < 200 || resp.getResponseCode() >= 300) {
    console.error("Notion query failed:", resp.getResponseCode(), resp.getContentText());
    return;
  }

  const results = (JSON.parse(resp.getContentText()).results) || [];

  // Helpers
  function toLocalMidnight(dStr) {
    const d = new Date(dStr);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }
  function dayDiff(a, b) { // a-b in whole days
    const MS = 24*60*60*1000;
    return Math.round((a.getTime() - b.getTime()) / MS);
  }
  function labelForDiff(diff) {
    if (diff < 0) return "Overdue";
    if (diff === 0) return "Due today";
    if (diff === 1) return "Due tomorrow";
    return `Due in ${diff} days`;
  }
  function fmtDate(d) {
    return Utilities.formatDate(d, tz, "EEE, MMM d");
  }

  // Group lines
  const groups = { Overdue: [], Today: [], Tomorrow: [], Upcoming: [] };

  results.forEach(page => {
    const props = page.properties || {};
    const title = (props[TITLE_FIELD]?.title?.[0]?.plain_text || "Untitled Task").trim();
    const dueStart = props["Due"]?.date?.start;
    if (!dueStart) return;

    const due = toLocalMidnight(dueStart);
    const diff = dayDiff(due, today);
    const line = `• ${title} — ${fmtDate(due)} (${labelForDiff(diff)})`;

    if (diff < 0) groups.Overdue.push(line);
    else if (diff === 0) groups.Today.push(line);
    else if (diff === 1) groups.Tomorrow.push(line);
    else if (diff >= 2 && diff <= 7) groups.Upcoming.push(line);
  });

  // Compose description
  const sections = [];
  const add = (heading, arr, emoji) => {
    if (arr.length) sections.push(`${emoji} ${heading} (${arr.length})\n${arr.join("\n")}`);
  };
  add("Overdue", groups.Overdue, "🔴");
  add("Due Today", groups.Today, "🟡");
  add("Due Tomorrow", groups.Tomorrow, "🟠");
  add("Due in Next 7 Days", groups.Upcoming, "🟢");

  const summaryText = sections.length
    ? `🧾 Task Summary (Overdue + Next 7 Days)\n\n${sections.join("\n\n")}`
    : "✅ No overdue tasks and nothing due in the next 7 days.";

  // Upsert today's review event
  const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!calendar) {
    console.error("Calendar not found. Check CALENDAR_ID and sharing permissions.");
    return;
  }
  const todays = calendar.getEventsForDay(today) || [];
  let ev = todays.find(e => (e.getTitle() || "").includes(REMINDER_EVENT_TITLE));
  if (!ev) {
    calendar.createAllDayEvent(REMINDER_EVENT_TITLE, today, { description: summaryText });
  } else {
    ev.setDescription(summaryText);
  }
}

/**
 * Patch Notion page properties (e.g., set Synced = true)
 */
function updateNotionCheckbox(pageId, properties) {
  const payload = { properties };
  const resp = UrlFetchApp.fetch("https://api.notion.com/v1/pages/" + pageId, {
    method: "patch",
    headers: {
      "Authorization": "Bearer " + NOTION_TOKEN,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  if (resp.getResponseCode() < 200 || resp.getResponseCode() >= 300) {
    console.error("Failed to patch page:", pageId, resp.getResponseCode(), resp.getContentText());
  }
}