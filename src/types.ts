export type ViewId =
  | "dashboard"
  | "assignment"
  | "create"
  | "recent"
  | "settings";

export type GroupMode = "project" | "status" | "epic";

export type TicketScope =
  | "all"
  | "mine"
  | "in-progress"
  | "waiting"
  | "done"
  | "mentioned";

export type Ticket = {
  id: string;
  key: string;
  url: string;
  summary: string;
  project: string;
  projectCode: string;
  status: string;
  assignee: string;
  assigneeId: string;
  reporter: string;
  reporterId: string;
  epic: string;
  epicId: string;
  updatedAt: string;
  updatedAtLabel: string;
  priority: "Low" | "Medium" | "High" | "Urgent";
  mentioned: boolean;
  watched: boolean;
  createdByMe: boolean;
  issueTypeName: string;
  developmentAssignees: string[];
  developmentRequestStatus: string;
};

export type Project = {
  id: string;
  key: string;
  name: string;
  description: string;
  simplified?: boolean;
  style?: string;
};

export type Person = {
  accountId: string;
  name: string;
  role: string;
  avatar: string;
  avatarUrl?: string;
  email?: string;
};

export type Epic = {
  id: string;
  key: string;
  name: string;
  projectCode: string;
  cadence: string;
  recentUses: number;
  url: string;
};

export type IssueType = {
  id: string;
  name: string;
  description: string;
  subtask: boolean;
};

export type RecentTicket = {
  key: string;
  summary: string;
  projectCode: string;
  epic: string;
  createdAt: string;
  url: string;
};

export type FavoriteProject = {
  projectCode: string;
  label: string;
};

export type CreateTemplate = {
  id: string;
  name: string;
  form: CreateFormState;
};

export type SettingsState = {
  domainPrefix: string;
  email: string;
  apiToken: string;
  recommendationCount: number;
  defaultView: ViewId;
  defaultGrouping: GroupMode;
  assignmentMenuUnlocked: boolean;
  favoriteProjects: FavoriteProject[];
  createTemplates: CreateTemplate[];
};

export type CreateFormState = {
  projectCode: string;
  issueTypeId: string;
  assigneeId: string;
  epicId: string;
  title: string;
  description: string;
};

export type JiraFieldCatalog = {
  epicLinkFieldId: string | null;
  epicNameFieldId: string | null;
  developmentAssigneeFieldId: string | null;
};

export type JiraCache = {
  cacheVersion: number;
  syncedAt: string;
  currentUser: Person | null;
  projects: Project[];
  users: Person[];
  epics: Epic[];
  tickets: Ticket[];
  assignmentTickets: Ticket[];
  mentions: Ticket[];
  recentCreated: RecentTicket[];
  issueTypesByProject: Record<string, IssueType[]>;
  fieldCatalog: JiraFieldCatalog;
};

export type CreateFieldMetadata = {
  fieldId: string;
  key: string;
  name: string;
  required: boolean;
};
