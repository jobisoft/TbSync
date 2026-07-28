/**
 * Descriptors for the folder types the manager renders. Providers opt into a
 * subset via their announce `capabilities.folderTypes`.
 */

export const FOLDER_TYPES = {
  contacts: {
    icon: "icons/contacts-16.png",
    labelKey: "folderType.contacts",
    columns: ["name", "status", "lastSync"],
  },
  calendars: {
    icon: "icons/calendar-16.png",
    labelKey: "folderType.calendars",
    columns: ["name", "status", "lastSync", "color"],
  },
  tasks: {
    icon: "icons/tasks-16.png",
    labelKey: "folderType.tasks",
    columns: ["name", "status", "lastSync"],
  },
};
