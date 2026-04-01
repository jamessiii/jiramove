import type {
  CreateFieldMetadata,
  CreateFormState,
  Epic,
  IssueType,
  JiraCache,
  JiraFieldCatalog,
  Person,
  Project,
  RecentTicket,
  SettingsState,
  Ticket,
} from "../types";

type RawIssue = {
  id: string;
  key: string;
  fields: Record<string, any>;
};

type SearchResponse = {
  issues: RawIssue[];
  maxResults?: number;
  total?: number;
  isLast?: boolean;
  nextPageToken?: string;
};

type ProjectSearchResponse = {
  values: Array<{
    id: string;
    key: string;
    name: string;
    description?: string;
    simplified?: boolean;
    style?: string;
  }>;
};

type MyselfResponse = {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  avatarUrls?: Record<string, string>;
};

type CreateIssueResponse = {
  id: string;
  key: string;
};

type CreateMetaIssueTypesResponse = {
  issueTypes?: Array<{
    id: string;
    name: string;
    description?: string;
    subtask?: boolean;
  }>;
};

type CreateMetaFieldsResponse = {
  fields?:
    | Array<{
        fieldId?: string;
        key?: string;
        name?: string;
        required?: boolean;
      }>
    | Record<
        string,
        {
          key?: string;
          name?: string;
          required?: boolean;
        }
      >;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_VERSION = 7;
const EXCLUDED_STATUS_KEYWORDS = ["이슈종료", "보류", "닫힘"];
const DEVELOPMENT_ASSIGNEE_FIELD_ID = "customfield_10115";
const DEVELOPMENT_REQUEST_FIELD_ID = "customfield_10091";
const UNASSIGNED_LABEL = "미지정";

export class JiraRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "JiraRequestError";
    this.status = status;
  }
}

export function hasSavedCredentials(settings: SettingsState): boolean {
  return Boolean(
    settings.domainPrefix.trim() && settings.email.trim() && settings.apiToken.trim(),
  );
}

export function buildBaseUrl(settings: SettingsState): string {
  return `https://${settings.domainPrefix.trim()}.atlassian.net`;
}

function shouldUseDevProxy(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const { hostname } = window.location;
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function getExternalProxyUrl(settings: SettingsState): string | null {
  const trimmed = settings.proxyUrl.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/\/+$/, "");
}

function buildRequestUrl(settings: SettingsState, path: string): string {
  if (shouldUseDevProxy()) {
    return `/__jira_proxy__${path}`;
  }

  const proxyUrl = getExternalProxyUrl(settings);
  if (proxyUrl) {
    return `${proxyUrl}${path}`;
  }

  return `${buildBaseUrl(settings)}${path}`;
}

function buildRequestHeaders(
  settings: SettingsState,
  init: RequestInit,
): Headers {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");

  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  headers.set(
    "Authorization",
    `Basic ${encodeBasicValue(`${settings.email}:${settings.apiToken}`)}`,
  );

  if (shouldUseDevProxy() || getExternalProxyUrl(settings)) {
    headers.set("x-jira-base-url", buildBaseUrl(settings));
  }

  return headers;
}

export function isSyncStale(isoString: string | undefined): boolean {
  if (!isoString) {
    return true;
  }

  const timestamp = Date.parse(isoString);
  if (Number.isNaN(timestamp)) {
    return true;
  }

  return Date.now() - timestamp > DAY_MS;
}

export async function testJiraConnection(settings: SettingsState): Promise<Person> {
  const response = await jiraRequest<MyselfResponse>(settings, "/rest/api/3/myself");
  return mapCurrentUser(response);
}

export async function syncJiraCache(
  settings: SettingsState,
  previousIssueTypesByProject: Record<string, IssueType[]> = {},
): Promise<JiraCache> {
  const currentUserResponse = await jiraRequest<MyselfResponse>(settings, "/rest/api/3/myself");
  const currentUser = mapCurrentUser(currentUserResponse);

  const [fieldCatalog, projects] = await Promise.all([
    fetchFieldCatalog(settings),
    fetchProjects(settings),
  ]);

  const projectKeys = projects.map((project) => project.key);
  const [users, epics] = await Promise.all([
    fetchAssignableUsers(settings, projectKeys),
    fetchEpics(settings, projectKeys),
  ]);

  const epicsByKey = new Map(epics.map((epic) => [epic.key, epic]));
  const [tickets, assignmentTickets, mentions, recentCreated] = await Promise.all([
    fetchMyTickets(settings, currentUser, fieldCatalog, epicsByKey),
    fetchAssignmentTickets(settings, currentUser, fieldCatalog, epicsByKey, projectKeys),
    fetchMentionTickets(settings, currentUser, fieldCatalog, epicsByKey),
    fetchRecentCreatedTickets(settings, currentUser, fieldCatalog, epicsByKey),
  ]);

  const recentEpicCounts = recentCreated.reduce<Map<string, number>>((counts, ticket) => {
    if (!ticket.epic) {
      return counts;
    }

    counts.set(ticket.epic, (counts.get(ticket.epic) ?? 0) + 1);
    return counts;
  }, new Map());

  const normalizedEpics = epics.map((epic) => ({
    ...epic,
    recentUses: recentEpicCounts.get(epic.name) ?? epic.recentUses,
  }));

  return {
    cacheVersion: CACHE_VERSION,
    syncedAt: new Date().toISOString(),
    currentUser,
    projects,
    users,
    epics: normalizedEpics,
    tickets,
    assignmentTickets,
    mentions,
    recentCreated,
    issueTypesByProject: previousIssueTypesByProject,
    fieldCatalog,
  };
}

export async function fetchIssueTypesForProject(
  settings: SettingsState,
  projectKey: string,
): Promise<IssueType[]> {
  const response = await jiraRequest<CreateMetaIssueTypesResponse>(
    settings,
    `/rest/api/3/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes`,
  );

  return (response.issueTypes ?? []).map((issueType) => ({
    id: issueType.id,
    name: issueType.name,
    description: issueType.description ?? "",
    subtask: Boolean(issueType.subtask),
  }));
}

export async function fetchCreateFieldsForIssueType(
  settings: SettingsState,
  projectKey: string,
  issueTypeId: string,
): Promise<CreateFieldMetadata[]> {
  const response = await jiraRequest<CreateMetaFieldsResponse>(
    settings,
    `/rest/api/3/issue/createmeta/${encodeURIComponent(
      projectKey,
    )}/issuetypes/${encodeURIComponent(issueTypeId)}`,
  );

  if (Array.isArray(response.fields)) {
    return response.fields.map((field) => ({
      fieldId: field.fieldId ?? field.key ?? "",
      key: field.key ?? field.fieldId ?? "",
      name: field.name ?? field.key ?? field.fieldId ?? "",
      required: Boolean(field.required),
    }));
  }

  return Object.entries(response.fields ?? {}).map(([fieldId, field]) => ({
    fieldId,
    key: field.key ?? fieldId,
    name: field.name ?? fieldId,
    required: Boolean(field.required),
  }));
}

export async function createIssue(
  settings: SettingsState,
  form: CreateFormState,
  options: {
    epics: Epic[];
    fieldCatalog: JiraFieldCatalog;
  },
): Promise<RecentTicket> {
  const createFields = await fetchCreateFieldsForIssueType(
    settings,
    form.projectCode,
    form.issueTypeId,
  );
  const availableFieldIds = new Set(createFields.map((field) => field.fieldId));
  const epicLookup = new Map(options.epics.map((epic) => [epic.id, epic]));
  const selectedEpic = epicLookup.get(form.epicId);
  const epicParentFieldId = resolveEpicParentFieldId(createFields, options.fieldCatalog);

  const fields: Record<string, any> = {
    project: { key: form.projectCode },
    issuetype: { id: form.issueTypeId },
    summary: form.title.trim(),
  };

  if (form.description.trim()) {
    fields.description = toAdfDocument(form.description.trim());
  }

  if (form.assigneeId && availableFieldIds.has("assignee")) {
    fields.assignee = { accountId: form.assigneeId };
  }

  if (selectedEpic && epicParentFieldId) {
    if (epicParentFieldId === "parent") {
      fields.parent = { key: selectedEpic.key };
    } else {
      fields[epicParentFieldId] = selectedEpic.key;
    }
  }

  const created = await jiraRequest<CreateIssueResponse>(settings, "/rest/api/3/issue", {
    method: "POST",
    body: JSON.stringify({ fields }),
  });

  return {
    key: created.key,
    summary: form.title.trim(),
    projectCode: form.projectCode,
    epic: selectedEpic?.name ?? UNASSIGNED_LABEL,
    createdAt: formatCreatedLabel(new Date().toISOString()),
    url: `${buildBaseUrl(settings)}/browse/${created.key}`,
  };
}

function mapCurrentUser(response: MyselfResponse): Person {
  return {
    accountId: response.accountId,
    name: response.displayName,
    role: "내 계정",
    avatar: makeInitials(response.displayName),
    avatarUrl: response.avatarUrls?.["48x48"],
    email: response.emailAddress,
  };
}

async function fetchProjects(settings: SettingsState): Promise<Project[]> {
  const response = await jiraRequest<ProjectSearchResponse>(
    settings,
    "/rest/api/3/project/search?maxResults=100",
  );

  return response.values.map((project) => ({
    id: project.id,
    key: project.key,
    name: project.name,
    description: project.description ?? "",
    simplified: project.simplified,
    style: project.style,
  }));
}

async function fetchAssignableUsers(
  settings: SettingsState,
  projectKeys: string[],
): Promise<Person[]> {
  if (projectKeys.length === 0) {
    return [];
  }

  const chunks = chunk(projectKeys, 15);
  const users = new Map<string, Person>();

  await Promise.all(
    chunks.map(async (projectKeyChunk) => {
      const query = new URLSearchParams({
        projectKeys: projectKeyChunk.join(","),
        maxResults: "500",
      });

      const response = await jiraRequest<any[]>(
        settings,
        `/rest/api/2/user/assignable/multiProjectSearch?${query.toString()}`,
      );

      response.forEach((user) => {
        if (!user.accountId || users.has(user.accountId)) {
          return;
        }

        users.set(user.accountId, {
          accountId: user.accountId,
          name: user.displayName,
          role: user.active ? "할당 가능" : "비활성",
          avatar: makeInitials(user.displayName),
          avatarUrl: user.avatarUrls?.["48x48"],
          email: user.emailAddress,
        });
      });
    }),
  );

  return Array.from(users.values()).sort((left, right) => left.name.localeCompare(right.name));
}

async function fetchFieldCatalog(settings: SettingsState): Promise<JiraFieldCatalog> {
  const response = await jiraRequest<any[]>(settings, "/rest/api/3/field");

  const epicLinkField = response.find(
    (field) =>
      field.schema?.custom === "com.pyxis.greenhopper.jira:gh-epic-link" ||
      field.name === "Epic Link",
  );
  const epicNameField = response.find(
    (field) =>
      field.schema?.custom === "com.pyxis.greenhopper.jira:gh-epic-label" ||
      field.name === "Epic Name",
  );

  return {
    epicLinkFieldId: epicLinkField?.id ?? null,
    epicNameFieldId: epicNameField?.id ?? null,
    developmentAssigneeFieldId: DEVELOPMENT_ASSIGNEE_FIELD_ID,
  };
}

async function fetchEpics(settings: SettingsState, projectKeys: string[]): Promise<Epic[]> {
  if (projectKeys.length === 0) {
    return [];
  }

  const projectClause = `project in (${projectKeys.join(",")})`;
  const issues = await searchAllIssues(settings, {
    jql: buildActiveIssueJql(projectClause, "updated DESC"),
    fields: ["summary", "project", "updated", "issuetype", "status"],
    pageSize: 100,
  });

  return dedupeByKey(
    issues
      .filter((issue) => !isExcludedWorkflowIssue(issue))
      .filter(isEpicCandidateIssue)
      .map((issue) => mapEpicIssue(issue, settings)),
  );
}

export async function fetchProjectEpics(
  settings: SettingsState,
  projectKey: string,
): Promise<Epic[]> {
  const issues = await searchAllIssues(settings, {
    jql: buildActiveIssueJql(`project = ${projectKey}`, "updated DESC"),
    fields: ["summary", "project", "updated", "issuetype", "status"],
    pageSize: 100,
  });

  return dedupeByKey(
    issues
      .filter((issue) => !isExcludedWorkflowIssue(issue))
      .filter(isEpicCandidateIssue)
      .map((issue) => mapEpicIssue(issue, settings)),
  );
}

async function fetchMyTickets(
  settings: SettingsState,
  currentUser: Person,
  fieldCatalog: JiraFieldCatalog,
  epicsByKey: Map<string, Epic>,
): Promise<Ticket[]> {
  const queries = [
    buildActiveIssueJql(
      "(assignee = currentUser() OR reporter = currentUser() OR watcher = currentUser() OR creator = currentUser() OR issuekey in issueHistory())",
      "updated DESC",
    ),
    buildActiveIssueJql(
      "(assignee = currentUser() OR reporter = currentUser() OR watcher = currentUser() OR creator = currentUser())",
      "updated DESC",
    ),
  ];

  for (const jql of queries) {
    try {
      const issues = await searchIssues(settings, {
        jql,
        maxResults: 60,
        fields: issueFieldList(fieldCatalog),
      });

      return dedupeByKey(
        issues
          .filter((issue) => !isExcludedWorkflowIssue(issue))
          .map((issue) => mapIssue(issue, settings, currentUser, fieldCatalog, epicsByKey)),
      );
    } catch (error) {
      if (!(error instanceof JiraRequestError)) {
        throw error;
      }
    }
  }

  return [];
}

async function fetchAssignmentTickets(
  settings: SettingsState,
  currentUser: Person,
  fieldCatalog: JiraFieldCatalog,
  epicsByKey: Map<string, Epic>,
  projectKeys: string[],
): Promise<Ticket[]> {
  if (projectKeys.length === 0) {
    return [];
  }

  const chunks = chunk(projectKeys, 20);
  const results = await Promise.all(
    chunks.map(async (projectKeyChunk) => {
      const issues = await searchAllIssues(settings, {
        jql: buildActiveIssueJql(`project in (${projectKeyChunk.join(",")})`, "updated DESC"),
        fields: issueFieldList(fieldCatalog),
        pageSize: 100,
      });

      return issues
        .filter((issue) => !isExcludedWorkflowIssue(issue))
        .filter((issue) => isAssignmentIssue(issue))
        .map((issue) => mapIssue(issue, settings, currentUser, fieldCatalog, epicsByKey));
    }),
  );

  return dedupeByKey(results.flat());
}

async function fetchMentionTickets(
  settings: SettingsState,
  currentUser: Person,
  fieldCatalog: JiraFieldCatalog,
  epicsByKey: Map<string, Epic>,
): Promise<Ticket[]> {
  const issues = await searchIssues(settings, {
    jql: buildActiveIssueJql("updated >= -14d", "updated DESC"),
    maxResults: 80,
    fields: issueFieldList(fieldCatalog, true),
  });

  return dedupeByKey(
    issues
      .filter((issue) => !isExcludedWorkflowIssue(issue))
      .filter((issue) => issueMentionsCurrentUser(issue, currentUser))
      .map((issue) =>
        mapIssue(
          issue,
          settings,
          currentUser,
          fieldCatalog,
          epicsByKey,
          true,
        ),
      ),
  );
}

async function fetchRecentCreatedTickets(
  settings: SettingsState,
  currentUser: Person,
  fieldCatalog: JiraFieldCatalog,
  epicsByKey: Map<string, Epic>,
): Promise<RecentTicket[]> {
  const issues = await searchIssues(settings, {
    jql: buildActiveIssueJql("creator = currentUser()", "created DESC"),
    maxResults: 10,
    fields: [...issueFieldList(fieldCatalog), "created"],
  });

  return issues.filter((issue) => !isExcludedWorkflowIssue(issue)).map((issue) => {
    const mapped = mapIssue(issue, settings, currentUser, fieldCatalog, epicsByKey);
    return {
      key: mapped.key,
      summary: mapped.summary,
      projectCode: mapped.projectCode,
      epic: mapped.epic,
      createdAt: formatCreatedLabel(issue.fields.created ?? issue.fields.updated),
      url: mapped.url,
    };
  });
}

async function searchIssues(
  settings: SettingsState,
  payload: {
    jql: string;
    maxResults: number;
    fields: string[];
    nextPageToken?: string;
  },
): Promise<RawIssue[]> {
  const response = await searchIssuePage(settings, payload);
  return response.issues ?? [];
}

async function searchIssuePage(
  settings: SettingsState,
  payload: {
    jql: string;
    maxResults: number;
    fields: string[];
    nextPageToken?: string;
  },
): Promise<SearchResponse> {
  return jiraRequest<SearchResponse>(settings, "/rest/api/3/search/jql", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

async function searchAllIssues(
  settings: SettingsState,
  payload: {
    jql: string;
    fields: string[];
    pageSize?: number;
  },
): Promise<RawIssue[]> {
  const pageSize = payload.pageSize ?? 100;
  const issues: RawIssue[] = [];
  let nextPageToken: string | undefined;

  while (true) {
    const response = await searchIssuePage(settings, {
      jql: payload.jql,
      maxResults: pageSize,
      fields: payload.fields,
      nextPageToken,
    });
    const pageIssues = response.issues ?? [];

    if (pageIssues.length === 0) {
      break;
    }

    issues.push(...pageIssues);

    if (response.isLast === true) {
      break;
    }

    if (typeof response.total === "number" && issues.length >= response.total) {
      break;
    }

    if (!response.nextPageToken || pageIssues.length < pageSize) {
      break;
    }

    nextPageToken = response.nextPageToken;
  }

  return issues;
}

function mapIssue(
  issue: RawIssue,
  settings: SettingsState,
  currentUser: Person,
  fieldCatalog: JiraFieldCatalog,
  epicsByKey: Map<string, Epic>,
  forceMentioned = false,
): Ticket {
  const fields = issue.fields ?? {};
  const priorityName = String(fields.priority?.name ?? "Medium");
  const priority = normalizePriority(priorityName);
  const projectCode = fields.project?.key ?? "";
  const epicInfo = resolveEpic(fields, fieldCatalog, epicsByKey);
  const assigneeName = fields.assignee?.displayName ?? UNASSIGNED_LABEL;
  const assigneeId = fields.assignee?.accountId ?? "";
  const reporterName = fields.reporter?.displayName ?? "알 수 없음";
  const reporterId = fields.reporter?.accountId ?? "";
  const updatedAt = fields.updated ?? new Date().toISOString();
  const developmentAssignees = resolveDevelopmentAssignees(fields, fieldCatalog);

  return {
    id: issue.id,
    key: issue.key,
    url: `${buildBaseUrl(settings)}/browse/${issue.key}`,
    summary: fields.summary ?? issue.key,
    project: fields.project?.name ?? projectCode,
    projectCode,
    status: fields.status?.name ?? "알 수 없음",
    assignee: assigneeName,
    assigneeId,
    reporter: reporterName,
    reporterId,
    epic: epicInfo.name,
    epicId: epicInfo.id,
    updatedAt,
    updatedAtLabel: formatRelativeTime(updatedAt),
    priority,
    mentioned: forceMentioned,
    watched: Boolean(fields.watcher?.isWatching),
    createdByMe: fields.creator?.accountId === currentUser.accountId,
    issueTypeName: fields.issuetype?.name ?? "이슈",
    developmentAssignees,
    developmentRequestStatus: resolveDevelopmentRequestStatus(fields[DEVELOPMENT_REQUEST_FIELD_ID]),
  };
}

function resolveEpic(
  fields: Record<string, any>,
  fieldCatalog: JiraFieldCatalog,
  epicsByKey: Map<string, Epic>,
): { id: string; name: string } {
  const parent = fields.parent;
  const currentIssueIsSubtask = Boolean(fields.issuetype?.subtask);
  if (parent && !currentIssueIsSubtask) {
    return {
      id: parent.id ?? "",
      name: parent.fields?.summary ?? parent.key ?? UNASSIGNED_LABEL,
    };
  }

  const epicLinkValue = fieldCatalog.epicLinkFieldId
    ? fields[fieldCatalog.epicLinkFieldId]
    : null;
  const epicKey =
    (typeof epicLinkValue === "string" ? epicLinkValue : null) ??
    epicLinkValue?.key ??
    epicLinkValue?.value ??
    "";

  if (epicKey && epicsByKey.has(epicKey)) {
    const epic = epicsByKey.get(epicKey)!;
    return { id: epic.id, name: epic.name };
  }

  return { id: "", name: UNASSIGNED_LABEL };
}

function isEpicCandidateIssue(issue: RawIssue): boolean {
  const issueType = issue.fields?.issuetype ?? {};
  const hierarchyLevel = Number(issueType.hierarchyLevel);

  if (Number.isFinite(hierarchyLevel)) {
    return hierarchyLevel >= 1;
  }

  const issueTypeName = String(issueType.name ?? "").toLowerCase();
  return issueTypeName.includes("epic") || issueTypeName.includes("에픽");
}

function mapEpicIssue(issue: RawIssue, settings: SettingsState): Epic {
  return {
    id: issue.id,
    key: issue.key,
    name: issue.fields.summary ?? issue.key,
    projectCode: issue.fields.project?.key ?? "",
    cadence: "동기화된 Jira 에픽",
    recentUses: 0,
    url: `${buildBaseUrl(settings)}/browse/${issue.key}`,
  };
}

function issueMentionsCurrentUser(issue: RawIssue, currentUser: Person): boolean {
  const fields = issue.fields ?? {};
  return (
    containsMentionValue(fields.description, currentUser) ||
    containsMentionValue(fields.comment, currentUser)
  );
}

function containsMentionValue(value: unknown, currentUser: Person): boolean {
  if (!value) {
    return false;
  }

  if (typeof value === "string") {
    return (
      value.includes(`[~accountid:${currentUser.accountId}]`) ||
      value.includes(currentUser.name)
    );
  }

  if (Array.isArray(value)) {
    return value.some((entry) => containsMentionValue(entry, currentUser));
  }

  if (typeof value === "object") {
    const record = value as Record<string, any>;
    if (record.type === "mention") {
      return (
        record.attrs?.id === currentUser.accountId ||
        String(record.attrs?.text ?? "").includes(currentUser.name)
      );
    }

    return Object.values(record).some((entry) => containsMentionValue(entry, currentUser));
  }

  return false;
}

function normalizeFieldName(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function extractDisplayLabels(value: unknown): string[] {
  if (value == null) {
    return [];
  }

  if (typeof value === "string" || typeof value === "number") {
    return [String(value)];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => extractDisplayLabels(entry));
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const candidates = [
      record.displayName,
      record.name,
      record.value,
      record.label,
      record.text,
    ].filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);

    return candidates;
  }

  return [];
}

function dedupeLabels(values: string[]): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  values.forEach((value) => {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    results.push(normalized);
  });

  return results;
}

function resolveDevelopmentAssignees(
  fields: Record<string, any>,
  fieldCatalog: JiraFieldCatalog,
): string[] {
  const fieldId = fieldCatalog.developmentAssigneeFieldId ?? DEVELOPMENT_ASSIGNEE_FIELD_ID;
  return dedupeLabels(extractDisplayLabels(fields[fieldId]));
}

function resolveDevelopmentRequestStatus(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }

  const labels = dedupeLabels(extractDisplayLabels(value));
  if (labels.length > 0) {
    return labels[0];
  }

  return "";
}

function isIncompleteDevelopmentRequestStatus(value: unknown): boolean {
  const status = resolveDevelopmentRequestStatus(value);
  return normalizeFieldName(status) !== "완료";
}

function isAssignmentIssue(issue: RawIssue): boolean {
  const workflowStatus = normalizeFieldName(issue.fields?.status?.name);
  return (
    workflowStatus === "개발요청" &&
    isIncompleteDevelopmentRequestStatus(issue.fields?.[DEVELOPMENT_REQUEST_FIELD_ID])
  );
}

function buildActiveIssueJql(whereClause: string, orderByClause: string): string {
  return `${whereClause} AND statusCategory != Done ORDER BY ${orderByClause}`;
}

function isExcludedWorkflowIssue(issue: RawIssue): boolean {
  const statusName = String(issue.fields?.status?.name ?? "").toLowerCase();
  return EXCLUDED_STATUS_KEYWORDS.some((keyword) => statusName.includes(keyword.toLowerCase()));
}

function issueFieldList(fieldCatalog: JiraFieldCatalog, includeBody = false): string[] {
  const fields = [
    "summary",
    "project",
    "status",
    "assignee",
    "reporter",
    "updated",
    "priority",
    "parent",
    "issuetype",
    "creator",
    "watcher",
    DEVELOPMENT_REQUEST_FIELD_ID,
  ];

  if (includeBody) {
    fields.push("description", "comment");
  }

  if (fieldCatalog.epicLinkFieldId) {
    fields.push(fieldCatalog.epicLinkFieldId);
  }

  if (fieldCatalog.developmentAssigneeFieldId) {
    fields.push(fieldCatalog.developmentAssigneeFieldId);
  }

  return fields;
}

function normalizePriority(value: string): Ticket["priority"] {
  const lowered = value.toLowerCase();
  if (lowered.includes("highest") || lowered.includes("urgent") || lowered.includes("blocker")) {
    return "Urgent";
  }
  if (lowered.includes("high")) {
    return "High";
  }
  if (lowered.includes("low") || lowered.includes("minor")) {
    return "Low";
  }
  return "Medium";
}

function toAdfDocument(text: string): Record<string, unknown> {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => ({
      type: "paragraph",
      content: paragraph.split("\n").flatMap((line, index, lines) => {
        const content: Array<Record<string, unknown>> = [
          {
            type: "text",
            text: line,
          },
        ];

        if (index < lines.length - 1) {
          content.push({ type: "hardBreak" });
        }

        return content;
      }),
    }));

  return {
    version: 1,
    type: "doc",
    content: paragraphs.length > 0 ? paragraphs : [{ type: "paragraph", content: [] }],
  };
}

function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }

  const diffMs = date.getTime() - Date.now();
  const diffMinutes = Math.round(diffMs / (60 * 1000));
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (Math.abs(diffMinutes) < 60) {
    return formatter.format(diffMinutes, "minute");
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return formatter.format(diffHours, "hour");
  }

  const diffDays = Math.round(diffHours / 24);
  return formatter.format(diffDays, "day");
}

function formatCreatedLabel(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }

  const now = new Date();
  const dayDiff = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayOffset = Math.round(dayDiff / DAY_MS);
  const timeLabel = new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);

  if (dayOffset === 0) {
    return `오늘 ${timeLabel}`;
  }
  if (dayOffset === 1) {
    return `어제 ${timeLabel}`;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function makeInitials(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function dedupeByKey<T extends { key: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.key)) {
      return false;
    }
    seen.add(item.key);
    return true;
  });
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function encodeBasicValue(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary);
}

function resolveEpicParentFieldId(
  createFields: CreateFieldMetadata[],
  fieldCatalog: JiraFieldCatalog,
): string | null {
  if (!fieldCatalog.epicLinkFieldId) {
    const parentField = createFields.find(
      (field) => field.fieldId === "parent" || field.key === "parent",
    );
    return parentField ? "parent" : null;
  }

  const epicLinkField = createFields.find(
    (field) =>
      field.fieldId === fieldCatalog.epicLinkFieldId || field.key === fieldCatalog.epicLinkFieldId,
  );

  if (epicLinkField?.fieldId) {
    return epicLinkField.fieldId;
  }

  const parentField = createFields.find(
    (field) => field.fieldId === "parent" || field.key === "parent",
  );
  if (parentField) {
    return "parent";
  }

  return null;
}

async function jiraRequest<T>(
  settings: SettingsState,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!hasSavedCredentials(settings)) {
    throw new JiraRequestError("Jira 연결 정보를 먼저 저장해 주세요.", 400);
  }

  let response: Response;

  try {
    response = await fetch(buildRequestUrl(settings, path), {
      ...init,
      headers: buildRequestHeaders(settings, init),
    });
  } catch (error) {
    const proxyUrl = getExternalProxyUrl(settings);
    const hint = proxyUrl
      ? `프록시(${proxyUrl})에 연결할 수 없습니다. 프록시 서버가 실행 중인지 확인해 주세요.`
      : "브라우저에서 Jira API를 직접 호출하면 CORS로 막힐 수 있습니다. 프록시 URL을 설정해 주세요.";

    throw new JiraRequestError(
      error instanceof Error && error.message ? `${hint} (${error.message})` : hint,
      0,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  let data: any = undefined;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!response.ok) {
    const errorMessage =
      data?.errorMessages?.join(", ") ??
      data?.errors?.summary ??
      data?.message ??
      response.statusText;
    throw new JiraRequestError(errorMessage, response.status);
  }

  return data as T;
}

