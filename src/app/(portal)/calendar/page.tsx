import type { Metadata } from "next";
import { getCurrentPerson } from "@/server/auth/currentPerson";
import { getPortalCalendar, type CalendarEvent } from "@/server/dashboard/getPortalCalendar";
import { formatEventWhen } from "@/lib/time";
import { EVENT_TYPE_LABEL, reminderOffsetLabel } from "@/lib/eventDisplay";
import { EventForm } from "./EventForm";
import { deleteEventAction } from "./actions";
import portalStyles from "../portal.module.css";
import styles from "./calendar.module.css";

export const metadata: Metadata = { title: "Calendar" };

export default async function CalendarPage() {
  const person = await getCurrentPerson();
  if (!person) return null; // the layout already redirects; this satisfies the type checker

  const { levee, upcomingEvents, pastEvents, roster } = await getPortalCalendar(person.orgId);

  return (
    <div>
      <div className={portalStyles.pageHeader}>
        <div>
          <h1>Calendar</h1>
          {levee && <div className={portalStyles.meta}>{levee.name}</div>}
        </div>
      </div>

      {!levee ? (
        <div className={portalStyles.panel}>
          <div className={portalStyles.panelEmpty}>No levee is set up for this organization yet.</div>
        </div>
      ) : (
        <>
          <EventForm roster={roster} />

          <div className={styles.sectionHeading}>Upcoming</div>
          {upcomingEvents.length === 0 ? (
            <div className={portalStyles.panel}>
              <div className={portalStyles.panelEmpty}>Nothing scheduled.</div>
            </div>
          ) : (
            <ul className={styles.eventList}>
              {upcomingEvents.map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
            </ul>
          )}

          {pastEvents.length > 0 && (
            <>
              <div className={styles.sectionHeading}>Past</div>
              <ul className={styles.eventList}>
                {pastEvents.map((event) => (
                  <EventRow key={event.id} event={event} past />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

function EventRow({ event, past }: { event: CalendarEvent; past?: boolean }) {
  return (
    <li className={`${styles.eventRow} ${past ? styles.past : ""}`}>
      <div className={styles.eventMain}>
        <div className={styles.eventTitle}>{event.title}</div>
        <div className={styles.eventWhen}>{formatEventWhen(event.startsAt)}</div>
        {event.notes && <div className={styles.eventNotes}>{event.notes}</div>}
        {event.reminders.length > 0 && (
          <div className={styles.eventNotify}>
            Notifying {event.reminders.map((reminder) => reminder.personName).join(", ")} —{" "}
            {reminderOffsetLabel(event.reminders[0].offsetMinutes)}
            {event.reminders.every((reminder) => reminder.sentAt) ? " (sent)" : ""}
          </div>
        )}
      </div>
      <div className={styles.eventSide}>
        <span className={`${styles.tagPill} ${styles[`tag${event.type}`]}`}>{EVENT_TYPE_LABEL[event.type]}</span>
        <form action={deleteEventAction.bind(null, event.id)}>
          <button type="submit" className={styles.deleteBtn}>
            Delete
          </button>
        </form>
      </div>
    </li>
  );
}
