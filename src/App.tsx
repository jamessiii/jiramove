import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { navigation } from "./navigation";
import { deleteStoredValue, getStoredValue, setStoredValue } from "./lib/indexedDb";
import {
  JiraRequestError,
  createIssue,
  fetchCreateFieldsForIssueType,
  fetchProjectEpics,
  fetchIssueTypesForProject,
  hasSavedCredentials,
  isSyncStale,
  syncJiraCache,
  testJiraConnection,
} from "./lib/jira";
import type {
  CreateFieldMetadata,
  CreateFormState,
  CreateTemplate,
  Epic,
  FavoriteProject,
  GroupMode,
  IssueType,
  JiraCache,
  RecentTicket,
  SettingsState,
  Ticket,
  TicketScope,
  ViewId,
} from "./types";
import { CreateView, SettingsView } from "./ui/CreateViews";
import {
  AssignmentView,
  DashboardView,
  RecentView,
} from "./ui/TicketViews";

const SETTINGS_KEY = "settings";
const CACHE_KEY = "jira-cache";
const VIEW_KEY = "active-view";
const CACHE_VERSION = 7;
const ACTIVE_VIEWS: ViewId[] = ["dashboard", "assignment", "create", "recent", "settings"];

const defaultSettings: SettingsState = {
  domainPrefix: "",
  email: "",
  apiToken: "",
  recommendationCount: 4,
  defaultView: "dashboard",
  defaultGrouping: "status",
  assignmentMenuUnlocked: false,
  favoriteProjects: [],
  createTemplates: [],
};

const emptyCache: JiraCache = {
  cacheVersion: CACHE_VERSION,
  syncedAt: "",
  currentUser: null,
  projects: [],
  users: [],
  epics: [],
  tickets: [],
  assignmentTickets: [],
  mentions: [],
  recentCreated: [],
  issueTypesByProject: {},
  fieldCatalog: {
    epicLinkFieldId: null,
    epicNameFieldId: null,
    developmentAssigneeFieldId: null,
  },
};

const emptyForm: CreateFormState = {
  projectCode: "",
  issueTypeId: "",
  assigneeId: "",
  epicId: "",
  title: "",
  description: "",
};

function App() {
  const [activeView, setActiveView] = useState<ViewId>("dashboard");
  const [settings, setSettings] = useState<SettingsState>(defaultSettings);
  const [jiraCache, setJiraCache] = useState<JiraCache>(emptyCache);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [syncState, setSyncState] = useState<"idle" | "syncing">("idle");
  const [connectionState, setConnectionState] = useState<
    "idle" | "testing" | "connected" | "error"
  >("idle");
  const [createState, setCreateState] = useState<"idle" | "creating">("idle");
  const [createFields, setCreateFields] = useState<CreateFieldMetadata[]>([]);
  const [createFieldsLoading, setCreateFieldsLoading] = useState(false);
  const [projectEpicsLoading, setProjectEpicsLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [ticketScope, setTicketScope] = useState<TicketScope>("all");
  const [groupMode, setGroupMode] = useState<GroupMode>("status");
  const [onlyMine, setOnlyMine] = useState(true);
  const [onlyMentioned, setOnlyMentioned] = useState(false);
  const [createForm, setCreateForm] = useState<CreateFormState>(emptyForm);
  const [isLoaded, setIsLoaded] = useState(false);
  const [didBootstrapSync, setDidBootstrapSync] = useState(false);
  const [, setLogoClickTimes] = useState<number[]>([]);
  const [unlockModalOpen, setUnlockModalOpen] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockError, setUnlockError] = useState<string | null>(null);

  const configured = hasSavedCredentials(settings);
  const assignmentMenuUnlocked = settings.assignmentMenuUnlocked;
  const projects = jiraCache.projects;
  const users = jiraCache.users;
  const epics = jiraCache.epics;
  const tickets = jiraCache.tickets;
  const assignmentTickets = jiraCache.assignmentTickets;
  const mentionTickets = jiraCache.mentions;
  const recentCreated = jiraCache.recentCreated;
  const currentUser = jiraCache.currentUser;
  const currentUserId = currentUser?.accountId ?? "";
  const issueTypes = jiraCache.issueTypesByProject[createForm.projectCode] ?? [];
  const selectedIssueType =
    issueTypes.find((issueType) => issueType.id === createForm.issueTypeId) ?? null;
  const selectedIssueTypeIsEpic = isEpicIssueType(selectedIssueType);
  const hasEpicField =
    !selectedIssueTypeIsEpic &&
    createFields.some((field) => isEpicParentField(field, jiraCache.fieldCatalog));
  const epicSelectionRequired = createFields.some(
    (field) => !selectedIssueTypeIsEpic && isEpicParentField(field, jiraCache.fieldCatalog) && field.required,
  );
  const favoriteProjects = useMemo(() => {
    return settings.favoriteProjects
      .map((favorite) => {
        const project = projects.find((candidate) => candidate.key === favorite.projectCode);
        if (!project) {
          return null;
        }

        return {
          ...favorite,
          projectName: project.name,
          projectDescription: project.description,
        };
      })
      .filter((favorite): favorite is FavoriteProject & {
        projectName: string;
        projectDescription: string;
      } => favorite !== null);
  }, [projects, settings.favoriteProjects]);
  const createTemplates = useMemo(() => {
    return settings.createTemplates.map((template) => {
      const project = projects.find((candidate) => candidate.key === template.form.projectCode);
      const templateIssueTypes = jiraCache.issueTypesByProject[template.form.projectCode] ?? [];
      const issueType = templateIssueTypes.find(
        (candidate) => candidate.id === template.form.issueTypeId,
      );
      const assignee = users.find((candidate) => candidate.accountId === template.form.assigneeId);
      const epic = epics.find((candidate) => candidate.id === template.form.epicId);

      return {
        ...template,
        projectName: (project?.name ?? template.form.projectCode) || "프로젝트 미지정",
        issueTypeName: (issueType?.name ?? template.form.issueTypeId) || "이슈 유형 미지정",
        assigneeName: assignee?.name ?? "담당자 미지정",
        epicName: epic ? `[${epic.key}] ${epic.name}` : "에픽 미지정",
        titlePreview: template.form.title.trim() || "제목 없음",
      };
    });
  }, [epics, jiraCache.issueTypesByProject, projects, settings.createTemplates, users]);
  const visibleNavigation = useMemo(
    () =>
      navigation.filter(
        (item) => item.id !== "assignment" || assignmentMenuUnlocked,
      ),
    [assignmentMenuUnlocked],
  );
  usePersistentState({
    isLoaded,
    settings,
    activeView,
    jiraCache,
  });

  useLoadStoredState({
    setSettings,
    setGroupMode,
    setActiveView,
    setJiraCache,
    setConnectionState,
    setIsLoaded,
  });

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timer = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!assignmentMenuUnlocked && activeView === "assignment") {
      setActiveView("dashboard");
    }
  }, [activeView, assignmentMenuUnlocked]);

  useEffect(() => {
    if (!assignmentMenuUnlocked && settings.defaultView === "assignment") {
      setSettings((previous) =>
        previous.defaultView === "assignment"
          ? {
              ...previous,
              defaultView: "dashboard",
            }
          : previous,
      );
    }
  }, [assignmentMenuUnlocked, settings.defaultView]);

  useEffect(() => {
    if (!unlockModalOpen) {
      setUnlockPassword("");
      setUnlockError(null);
      setLogoClickTimes([]);
    }
  }, [unlockModalOpen]);

  useEffect(() => {
    if (!isLoaded || didBootstrapSync) {
      return;
    }

    setDidBootstrapSync(true);

    if (!configured) {
      setConnectionState("idle");
      return;
    }

    if (jiraCache.currentUser) {
      setConnectionState("connected");
    }

    if (isSyncStale(jiraCache.syncedAt)) {
      void runSync(true);
    }
  }, [configured, didBootstrapSync, isLoaded, jiraCache.currentUser, jiraCache.syncedAt]);

  useEffect(() => {
    setCreateForm((previous) => {
      const nextProjectCode = projects.some((project) => project.key === previous.projectCode)
        ? previous.projectCode
        : (projects[0]?.key ?? "");
      const availableIssueTypes =
        jiraCache.issueTypesByProject[nextProjectCode] ?? [];
      const nextIssueTypeId = availableIssueTypes.some(
        (issueType) => issueType.id === previous.issueTypeId,
      )
        ? previous.issueTypeId
        : (availableIssueTypes[0]?.id ?? "");
      const nextAssigneeId = users.some((person) => person.accountId === previous.assigneeId)
        ? previous.assigneeId
        : (users.find((person) => person.accountId === jiraCache.currentUser?.accountId)?.accountId ??
          users[0]?.accountId ??
          "");
      const nextEpicId = epics.some((epic) => epic.id === previous.epicId)
        ? previous.epicId
        : "";

      if (
        previous.projectCode === nextProjectCode &&
        previous.issueTypeId === nextIssueTypeId &&
        previous.assigneeId === nextAssigneeId &&
        previous.epicId === nextEpicId
      ) {
        return previous;
      }

      return {
        ...previous,
        projectCode: nextProjectCode,
        issueTypeId: nextIssueTypeId,
        assigneeId: nextAssigneeId,
        epicId: nextEpicId,
      };
    });
  }, [epics, jiraCache.currentUser, jiraCache.issueTypesByProject, projects, users]);

  useEffect(() => {
    if (!configured || !createForm.projectCode || jiraCache.issueTypesByProject[createForm.projectCode]) {
      return;
    }

    let cancelled = false;

    async function loadIssueTypes() {
      try {
        const nextIssueTypes = await fetchIssueTypesForProject(settings, createForm.projectCode);
        if (!cancelled) {
          setJiraCache((previous) => ({
            ...previous,
            issueTypesByProject: {
              ...previous.issueTypesByProject,
              [createForm.projectCode]: nextIssueTypes,
            },
          }));
        }
      } catch (error) {
        if (!cancelled) {
          setLastError(getErrorMessage(error));
        }
      }
    }

    void loadIssueTypes();

    return () => {
      cancelled = true;
    };
  }, [configured, createForm.projectCode, jiraCache.issueTypesByProject, settings]);

  useEffect(() => {
    if (!configured || !createForm.projectCode || !createForm.issueTypeId) {
      setCreateFields([]);
      return;
    }

    let cancelled = false;
    setCreateFieldsLoading(true);

    async function loadCreateFields() {
      try {
        const metadata = await fetchCreateFieldsForIssueType(
          settings,
          createForm.projectCode,
          createForm.issueTypeId,
        );
        if (!cancelled) {
          setCreateFields(metadata);
        }
      } catch (error) {
        if (!cancelled) {
          setCreateFields([]);
          setLastError(getErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setCreateFieldsLoading(false);
        }
      }
    }

    void loadCreateFields();

    return () => {
      cancelled = true;
    };
  }, [configured, createForm.issueTypeId, createForm.projectCode, settings]);

  useEffect(() => {
    if (createFieldsLoading || !createForm.epicId) {
      return;
    }

    if (!selectedIssueTypeIsEpic && hasEpicField) {
      return;
    }

    setCreateForm((previous) =>
      previous.epicId
        ? {
            ...previous,
            epicId: "",
          }
        : previous,
    );
  }, [createFieldsLoading, createForm.epicId, hasEpicField, selectedIssueTypeIsEpic]);

  useEffect(() => {
    if (
      !configured ||
      !createForm.projectCode ||
      !createForm.issueTypeId ||
      !hasEpicField ||
      epics.length > 0
    ) {
      setProjectEpicsLoading(false);
      return;
    }

    let cancelled = false;
    setProjectEpicsLoading(true);

    async function loadProjectEpics() {
      try {
        const fetchedEpics = await fetchProjectEpics(settings, createForm.projectCode);
        if (!cancelled && fetchedEpics.length > 0) {
          setJiraCache((previous) => ({
            ...previous,
            epics: mergeEpics(previous.epics, fetchedEpics),
          }));
        }
      } catch (error) {
        if (!cancelled) {
          setLastError(getErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setProjectEpicsLoading(false);
        }
      }
    }

    void loadProjectEpics();

    return () => {
      cancelled = true;
    };
  }, [
    configured,
    createForm.issueTypeId,
    createForm.projectCode,
    hasEpicField,
    epics.length,
    settings,
  ]);

  const filteredTickets = useMemo(() => {
    const loweredSearch = deferredSearch.toLowerCase().trim();

    return tickets.filter((ticket) => {
      const matchesSearch =
        loweredSearch.length === 0 ||
        [
          ticket.key,
          ticket.summary,
          ticket.project,
          ticket.epic,
          ticket.assignee,
          ticket.status,
        ]
          .join(" ")
          .toLowerCase()
          .includes(loweredSearch);

      const matchesMine =
        !onlyMine ||
        ticket.assigneeId === currentUserId ||
        ticket.reporterId === currentUserId ||
        ticket.createdByMe;
      const matchesMentioned = !onlyMentioned || ticket.mentioned;
      const matchesScope =
        ticketScope === "all" ||
        (ticketScope === "mine" && ticket.assigneeId === currentUserId) ||
        (ticketScope === "in-progress" && ticket.status.toLowerCase().includes("progress")) ||
        (ticketScope === "waiting" &&
          (ticket.status.toLowerCase().includes("to do") ||
            ticket.status.toLowerCase().includes("backlog"))) ||
        (ticketScope === "done" && ticket.status.toLowerCase().includes("done")) ||
        (ticketScope === "mentioned" && ticket.mentioned);

      return matchesSearch && matchesMine && matchesMentioned && matchesScope;
    });
  }, [currentUserId, deferredSearch, onlyMentioned, onlyMine, ticketScope, tickets]);

  const ticketGroups = useMemo(() => {
    return filteredTickets.reduce<Record<string, Ticket[]>>((accumulator, ticket) => {
      const key =
        groupMode === "project"
          ? `${ticket.projectCode} / ${ticket.project}`
          : groupMode === "epic"
            ? ticket.epic
            : ticket.status;

      accumulator[key] ??= [];
      accumulator[key].push(ticket);
      return accumulator;
    }, {});
  }, [filteredTickets, groupMode]);

  const lastSyncedAtLabel = jiraCache.syncedAt
    ? new Intl.DateTimeFormat("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(jiraCache.syncedAt))
    : "아직 동기화 없음";

  function showToast(message: string) {
    setToast(message);
  }

  async function runSync(silent = false) {
    if (!configured) {
      showToast("먼저 Jira 연결 정보를 저장해 주세요.");
      setActiveView("settings");
      return;
    }

    setSyncState("syncing");
    setLastError(null);

    try {
      const nextCache = await syncJiraCache(settings, jiraCache.issueTypesByProject);
      setJiraCache(nextCache);
      setConnectionState("connected");
      if (!silent) {
        showToast("Jira 데이터를 동기화했습니다.");
      }
    } catch (error) {
      setConnectionState("error");
      setLastError(getErrorMessage(error));
      showToast("동기화에 실패했습니다. 기존 캐시는 유지했습니다.");
    } finally {
      setSyncState("idle");
    }
  }

  async function handleTestConnection() {
    if (!configured) {
      showToast("Jira 도메인, 이메일, API 토큰을 먼저 입력해 주세요.");
      return;
    }

    setConnectionState("testing");
    setLastError(null);

    try {
      const me = await testJiraConnection(settings);
      setConnectionState("connected");
      setJiraCache((previous) => ({
        ...previous,
        currentUser: me,
      }));
      showToast(`${me.name} 계정으로 연결되었습니다.`);
    } catch (error) {
      setConnectionState("error");
      setLastError(getErrorMessage(error));
      showToast("Jira 연결 테스트에 실패했습니다.");
    }
  }

  function handleSaveSettings() {
    if (!configured) {
      showToast("Jira 연결 정보를 모두 입력하고 저장해 주세요.");
      return;
    }

    showToast("설정을 브라우저에 저장했습니다.");
  }

  async function handleClearCache() {
    await deleteStoredValue(CACHE_KEY);
    setJiraCache(emptyCache);
    setConnectionState("idle");
    showToast("로컬 Jira 캐시를 초기화했습니다.");
  }

  async function handleCreateTicket(openAfterCreate: boolean) {
    if (!configured) {
      showToast("먼저 Jira 연결 정보를 저장해 주세요.");
      setActiveView("settings");
      return;
    }

    if (!createForm.title.trim()) {
      showToast("이슈 제목을 입력해 주세요.");
      return;
    }

    if (!createForm.projectCode || !createForm.issueTypeId) {
      showToast("프로젝트와 이슈 유형을 선택해 주세요.");
      return;
    }

    if (epicSelectionRequired && !createForm.epicId) {
      showToast("이 이슈 유형은 에픽 선택이 필요합니다.");
      return;
    }

    setCreateState("creating");
    setLastError(null);

    try {
      const created = await createIssue(settings, createForm, {
        epics,
        fieldCatalog: jiraCache.fieldCatalog,
      });

      setJiraCache((previous) => ({
        ...previous,
        recentCreated: [created, ...previous.recentCreated.filter((ticket) => ticket.key !== created.key)].slice(0, 10),
      }));
      setConnectionState("connected");
      showToast(`${created.key} 이슈를 생성했습니다.`);

      setCreateForm((previous) => ({
        ...previous,
        title: "",
        description: "",
      }));

      if (openAfterCreate) {
        openExternal(created.url);
      }

      void runSync(true);
    } catch (error) {
      setConnectionState("error");
      setLastError(getErrorMessage(error));
      showToast("이슈 생성에 실패했습니다.");
    } finally {
      setCreateState("idle");
    }
  }

  function handleReuseRecent(ticket: RecentTicket) {
    const matchingEpic = epics.find((epic) => epic.name === ticket.epic);
    setCreateForm((previous) => ({
      ...previous,
      projectCode: ticket.projectCode,
      epicId: matchingEpic?.id ?? previous.epicId,
      title: ticket.summary,
    }));
    setActiveView("create");
    showToast(`${ticket.key} 내용을 생성 폼에 불러왔습니다.`);
  }

  function handleApplyFavoriteProject(favorite: FavoriteProject) {
    const availableIssueTypes = jiraCache.issueTypesByProject[favorite.projectCode] ?? [];
    const preferredAssigneeId =
      users.find((person) => person.accountId === jiraCache.currentUser?.accountId)?.accountId ??
      users[0]?.accountId ??
      "";

    setCreateForm((previous) => ({
      ...previous,
      projectCode: favorite.projectCode,
      issueTypeId: availableIssueTypes.some((issueType) => issueType.id === previous.issueTypeId)
        ? previous.issueTypeId
        : (availableIssueTypes[0]?.id ?? ""),
      assigneeId: previous.assigneeId || preferredAssigneeId,
      epicId: epics.some((epic) => epic.id === previous.epicId)
        ? previous.epicId
        : "",
    }));
    setActiveView("create");
    showToast(`${favorite.label} 프로젝트 바로가기를 적용했습니다.`);
  }

  async function handleApplyTemplate(template: CreateTemplate) {
    if (configured && template.form.projectCode) {
      try {
        if (!jiraCache.issueTypesByProject[template.form.projectCode]) {
          const nextIssueTypes = await fetchIssueTypesForProject(settings, template.form.projectCode);
          setJiraCache((previous) => ({
            ...previous,
            issueTypesByProject: {
              ...previous.issueTypesByProject,
              [template.form.projectCode]: nextIssueTypes,
            },
          }));
        }

        if (template.form.epicId && !epics.some((epic) => epic.id === template.form.epicId)) {
          const fetchedEpics = await fetchProjectEpics(settings, template.form.projectCode);
          if (fetchedEpics.length > 0) {
            setJiraCache((previous) => ({
              ...previous,
              epics: mergeEpics(previous.epics, fetchedEpics),
            }));
          }
        }
      } catch (error) {
        setLastError(getErrorMessage(error));
      }
    }

    setCreateForm({
      projectCode: template.form.projectCode,
      issueTypeId: template.form.issueTypeId,
      assigneeId: template.form.assigneeId,
      epicId: template.form.epicId,
      title: template.form.title,
      description: template.form.description,
    });
    setActiveView("create");
    showToast(`${template.name} 템플릿을 불러왔습니다.`);
  }

  function handleSaveTemplate(name: string) {
    const trimmedName = name.trim();
    if (!trimmedName) {
      showToast("템플릿 이름을 입력해 주세요.");
      return;
    }

    if (!isTemplateSavable(createForm)) {
      showToast("저장할 작성 내용이 없습니다.");
      return;
    }

    const nextTemplate: CreateTemplate = {
      id: createLocalId(),
      name: trimmedName,
      form: {
        projectCode: createForm.projectCode,
        issueTypeId: createForm.issueTypeId,
        assigneeId: createForm.assigneeId,
        epicId: createForm.epicId,
        title: createForm.title,
        description: createForm.description,
      },
    };

    setSettings((previous) => ({
      ...previous,
      createTemplates: [nextTemplate, ...previous.createTemplates],
    }));
    showToast(`${trimmedName} 템플릿을 저장했습니다.`);
  }

  function handleRenameTemplate(templateId: string, name: string) {
    const trimmedName = name.trim();
    if (!trimmedName) {
      showToast("템플릿 이름을 입력해 주세요.");
      return;
    }

    setSettings((previous) => ({
      ...previous,
      createTemplates: previous.createTemplates.map((template) =>
        template.id === templateId
          ? {
              ...template,
              name: trimmedName,
            }
          : template,
        ),
    }));
    showToast("템플릿 이름을 수정했습니다.");
  }

  function handleDeleteTemplate(templateId: string) {
    const template = settings.createTemplates.find((candidate) => candidate.id === templateId);
    setSettings((previous) => ({
      ...previous,
      createTemplates: previous.createTemplates.filter((candidate) => candidate.id !== templateId),
    }));
    showToast(template ? `${template.name} 템플릿을 삭제했습니다.` : "템플릿을 삭제했습니다.");
  }

  function handleCopyIssueKey(ticket: Ticket) {
    if (!navigator.clipboard) {
      showToast("이 브라우저에서는 클립보드 복사를 사용할 수 없습니다.");
      return;
    }

    void navigator.clipboard.writeText(ticket.key);
    showToast(`${ticket.key} 키를 클립보드에 복사했습니다.`);
  }

  function handleLogoClick() {
    if (assignmentMenuUnlocked) {
      return;
    }

    const now = Date.now();
    setLogoClickTimes((previous) => {
      const next = [...previous.filter((timestamp) => now - timestamp <= 3000), now];
      if (next.length >= 5) {
        setUnlockModalOpen(true);
        return [];
      }

      return next;
    });
  }

  function handleUnlockAssignmentMenu() {
    if (unlockPassword.trim() !== "ajslanqm") {
      setUnlockError("비밀번호가 올바르지 않습니다.");
      return;
    }

    setSettings((previous) => ({
      ...previous,
      assignmentMenuUnlocked: true,
    }));
    setUnlockModalOpen(false);
    showToast("업무할당 메뉴를 해금했습니다.");
  }

  function handleRemoveAssignmentMenu() {
    setSettings((previous) => ({
      ...previous,
      assignmentMenuUnlocked: false,
      defaultView:
        previous.defaultView === "assignment" ? "dashboard" : previous.defaultView,
    }));
    if (activeView === "assignment") {
      setActiveView("dashboard");
    }
    showToast("업무할당 메뉴를 숨겼습니다.");
  }

  function openExternal(url: string) {
    if (!url || url === "#") {
      showToast("이 항목에는 Jira 링크가 없습니다.");
      return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
  }

  function renderView() {
    switch (activeView) {
      case "dashboard":
        return (
          <DashboardView
            dashboardCards={[
              {
                id: "all",
                label: "전체",
                value: tickets.length,
                tone: "neutral",
              },
              {
                id: "mine",
                label: "내 담당",
                value: tickets.filter((ticket) => ticket.assigneeId === currentUserId).length,
                tone: "info",
              },
              {
                id: "mentions",
                label: "언급됨",
                value: mentionTickets.length,
                tone: "accent",
              },
              {
                id: "review",
                label: "리뷰",
                value: tickets.filter((ticket) => ticket.status.toLowerCase().includes("review")).length,
                tone: "warning",
              },
              {
                id: "recent",
                label: "최근 생성",
                value: recentCreated.length,
                tone: "success",
              },
            ]}
            allTickets={tickets}
            assignedTickets={tickets.filter((ticket) => ticket.assigneeId === currentUserId)}
            reviewTickets={tickets.filter((ticket) => ticket.status.toLowerCase().includes("review"))}
            recentCreated={recentCreated}
            mentionTickets={mentionTickets}
            onGoToCreate={() => setActiveView("create")}
            onOpenIssue={(ticket) => openExternal(ticket.url)}
            onOpenRecent={(ticket) => openExternal(ticket.url)}
            onReuseRecent={handleReuseRecent}
          />
        );
      case "assignment":
        return (
          <AssignmentView
            tickets={assignmentTickets}
            onOpenIssue={(ticket) => openExternal(ticket.url)}
          />
        );
      case "create":
        return (
          <CreateView
            favoriteProjects={favoriteProjects}
            templates={createTemplates}
            createForm={createForm}
            setCreateForm={setCreateForm}
            projects={projects}
            issueTypes={issueTypes}
            people={users}
            epics={epics}
            createState={createState}
            configured={configured}
            createFieldsLoading={createFieldsLoading}
            epicsLoading={projectEpicsLoading}
            epicFieldAvailable={hasEpicField}
            epicSelectionRequired={epicSelectionRequired}
            createFields={createFields}
            onCreate={handleCreateTicket}
            onSaveTemplate={handleSaveTemplate}
            onApplyTemplate={handleApplyTemplate}
            onRenameTemplate={handleRenameTemplate}
            onDeleteTemplate={handleDeleteTemplate}
            onPickFavoriteProject={handleApplyFavoriteProject}
          />
        );
      case "recent":
        return (
          <RecentView
            recentCreated={recentCreated}
            onOpenRecent={(ticket) => openExternal(ticket.url)}
            onReuseRecent={handleReuseRecent}
          />
        );
      case "settings":
        return (
          <SettingsView
            settings={settings}
            setSettings={setSettings}
            navigationItems={visibleNavigation}
            projects={projects}
            lastSyncedAt={lastSyncedAtLabel}
            syncProjects={`${projects.length}개 프로젝트`}
            syncPeople={`${users.length}명 사용자`}
            syncEpics={`${epics.length}개 에픽`}
            onSync={() => void runSync(false)}
            onSave={handleSaveSettings}
            onTestConnection={() => void handleTestConnection()}
            onClearCache={() => void handleClearCache()}
            onRemoveAssignmentMenu={handleRemoveAssignmentMenu}
            connectionState={connectionState}
            configured={configured}
            assignmentMenuUnlocked={assignmentMenuUnlocked}
            lastError={lastError}
          />
        );
      default:
        return null;
    }
  }

  return (
    <div className="app-shell">
      <div className="ambient ambient-left" aria-hidden="true" />
      <div className="ambient ambient-right" aria-hidden="true" />
      <aside className="sidebar glass-panel">
        <div className="brand-block">
          <button
            className="brand-logo-button"
            type="button"
            onClick={handleLogoClick}
            aria-label="JiraMove"
          >
            <img className="brand-logo" src="/logo.png" alt="JiraMove" />
          </button>
          <div className="brand-copy">
            <span className="eyebrow">개인용 JIRA 퀵 매니저</span>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="주요 메뉴">
          {visibleNavigation.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-item ${item.id === activeView ? "active" : ""}`}
              onClick={() => setActiveView(item.id)}
            >
              <span className="nav-kicker">{item.kicker}</span>
              <strong>{item.label}</strong>
            </button>
          ))}
        </nav>

        <div className="sidebar-card">
          <div className="sidebar-card-head">
            <span className="eyebrow">동기화 현황</span>
            <span
              className={`pill sidebar-pill ${connectionState === "connected" ? "success" : connectionState === "error" ? "danger" : "neutral"}`}
            >
              {connectionState === "connected"
                ? "Jira 연결됨"
                : connectionState === "testing"
                  ? "연결 확인 중"
                  : connectionState === "error"
                    ? "연결 오류"
                    : "연결 필요"}
            </span>
          </div>
          <strong className="sidebar-timestamp">{lastSyncedAtLabel}</strong>
          <div className="sync-row">
            <span>프로젝트 {projects.length}개</span>
            <span>사용자 {users.length}명</span>
            <span>에픽 {epics.length}개</span>
          </div>
          <button
            className={`button ${syncState === "syncing" ? "warning" : "secondary"} wide`}
            type="button"
            onClick={() => void runSync(false)}
            disabled={syncState === "syncing"}
          >
            {syncState === "syncing" ? "동기화 중..." : "다시 동기화"}
          </button>
        </div>
      </aside>

      <main className="main-content">

        <section className="view-stage">{renderView()}</section>
      </main>

      {toast ? <div className="toast">{toast}</div> : null}
      {unlockModalOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setUnlockModalOpen(false)}>
          <section
            className="modal-card glass-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="assignment-unlock-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-head">
              <h3 id="assignment-unlock-title">업무할당 메뉴 해금</h3>
              <button
                className="button tertiary"
                type="button"
                onClick={() => setUnlockModalOpen(false)}
              >
                닫기
              </button>
            </div>
            <div className="modal-body">
              <label className="modal-field">
                <span>비밀번호</span>
                <input
                  type="password"
                  value={unlockPassword}
                  autoFocus
                  placeholder="비밀번호 입력"
                  onChange={(event) => {
                    setUnlockPassword(event.target.value);
                    if (unlockError) {
                      setUnlockError(null);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleUnlockAssignmentMenu();
                    }
                  }}
                />
              </label>
              {unlockError ? <p className="error-text">{unlockError}</p> : null}
              <div className="button-row">
                <button className="button primary" type="button" onClick={handleUnlockAssignmentMenu}>
                  해금
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function isCurrentCacheVersion(cache: JiraCache): boolean {
  return cache.cacheVersion === CACHE_VERSION;
}

function isActiveView(value: string): value is ViewId {
  return ACTIVE_VIEWS.includes(value as ViewId);
}

function useLoadStoredState({
  setSettings,
  setGroupMode,
  setActiveView,
  setJiraCache,
  setConnectionState,
  setIsLoaded,
}: {
  setSettings: Dispatch<SetStateAction<SettingsState>>;
  setGroupMode: Dispatch<SetStateAction<GroupMode>>;
  setActiveView: Dispatch<SetStateAction<ViewId>>;
  setJiraCache: Dispatch<SetStateAction<JiraCache>>;
  setConnectionState: Dispatch<SetStateAction<"idle" | "testing" | "connected" | "error">>;
  setIsLoaded: Dispatch<SetStateAction<boolean>>;
}) {
  useEffect(() => {
    let cancelled = false;

    async function loadState() {
      const [storedSettings, storedCache, storedView] = await Promise.all([
        getStoredValue<SettingsState>(SETTINGS_KEY),
        getStoredValue<JiraCache>(CACHE_KEY),
        getStoredValue<ViewId>(VIEW_KEY),
      ]);

      if (cancelled) {
        return;
      }

      if (storedSettings) {
        const normalizedSettings = {
          ...defaultSettings,
          ...storedSettings,
          defaultView: isActiveView(String(storedSettings.defaultView))
            ? storedSettings.defaultView
            : defaultSettings.defaultView,
          favoriteProjects: storedSettings.favoriteProjects ?? defaultSettings.favoriteProjects,
          createTemplates: storedSettings.createTemplates ?? defaultSettings.createTemplates,
        };
        setSettings(normalizedSettings);
        setGroupMode(normalizedSettings.defaultGrouping);
      }

      if (storedCache) {
        if (isCurrentCacheVersion(storedCache)) {
          setJiraCache(storedCache);
          if (storedCache.currentUser && hasSavedCredentials(storedSettings ?? defaultSettings)) {
            setConnectionState("connected");
          }
        } else {
          await deleteStoredValue(CACHE_KEY);
        }
      }

      if (storedView && isActiveView(String(storedView))) {
        setActiveView(storedView);
      } else if (storedSettings?.defaultView && isActiveView(String(storedSettings.defaultView))) {
        setActiveView(storedSettings.defaultView);
      } else {
        setActiveView(defaultSettings.defaultView);
      }

      setIsLoaded(true);
    }

    void loadState();

    return () => {
      cancelled = true;
    };
  }, [setActiveView, setConnectionState, setGroupMode, setIsLoaded, setJiraCache, setSettings]);
}

function usePersistentState({
  isLoaded,
  settings,
  activeView,
  jiraCache,
}: {
  isLoaded: boolean;
  settings: SettingsState;
  activeView: ViewId;
  jiraCache: JiraCache;
}) {
  useEffect(() => {
    if (isLoaded) {
      void setStoredValue(SETTINGS_KEY, settings);
    }
  }, [isLoaded, settings]);

  useEffect(() => {
    if (isLoaded) {
      void setStoredValue(CACHE_KEY, jiraCache);
    }
  }, [isLoaded, jiraCache]);

  useEffect(() => {
    if (isLoaded) {
      void setStoredValue(VIEW_KEY, activeView);
    }
  }, [activeView, isLoaded]);
}

function isEpicParentField(
  field: CreateFieldMetadata,
  fieldCatalog: JiraCache["fieldCatalog"],
): boolean {
  return (
    field.fieldId === "parent" ||
    field.key === "parent" ||
    (fieldCatalog.epicLinkFieldId !== null &&
      (field.fieldId === fieldCatalog.epicLinkFieldId || field.key === fieldCatalog.epicLinkFieldId))
  );
}

function isEpicIssueType(issueType: IssueType | null): boolean {
  if (!issueType) {
    return false;
  }

  const normalizedName = issueType.name.trim().toLowerCase();
  return normalizedName === "epic" || normalizedName.includes("에픽");
}

function isTemplateSavable(form: CreateFormState): boolean {
  return Boolean(
    form.projectCode ||
      form.issueTypeId ||
      form.assigneeId ||
      form.epicId ||
      form.title.trim() ||
      form.description.trim(),
  );
}

function createLocalId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `template-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function mergeEpics(existing: Epic[], incoming: Epic[]): Epic[] {
  const merged = new Map(existing.map((epic) => [epic.key, epic]));

  incoming.forEach((epic) => {
    const previous = merged.get(epic.key);
    merged.set(epic.key, previous ? { ...epic, recentUses: previous.recentUses } : epic);
  });

  return Array.from(merged.values());
}

function getErrorMessage(error: unknown): string {
  if (error instanceof JiraRequestError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "요청을 처리하는 중 알 수 없는 오류가 발생했습니다.";
}

export default App;


