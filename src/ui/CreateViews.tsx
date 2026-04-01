import { useEffect, useMemo, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import type {
  CreateFieldMetadata,
  CreateFormState,
  CreateTemplate,
  Epic,
  FavoriteProject,
  GroupMode,
  IssueType,
  Person,
  Project,
  SettingsState,
  ViewId,
} from "../types";

type FavoriteProjectView = FavoriteProject & {
  projectName: string;
  projectDescription: string;
};

type CreateTemplateView = CreateTemplate & {
  projectName: string;
  issueTypeName: string;
  assigneeName: string;
  epicName: string;
  titlePreview: string;
};

function formatEpicLabel(epic: Epic): string {
  return `[${epic.key}] ${epic.name}`;
}

function formatPersonLabel(person: Person): string {
  return person.email ? `${person.name} (${person.email})` : person.name;
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

export function CreateFormPanel({
  createForm,
  setCreateForm,
  projects,
  issueTypes,
  people,
  epics,
  createState,
  configured,
  createFieldsLoading,
  epicsLoading,
  epicFieldAvailable,
  epicSelectionRequired,
  createFields,
  onCreate,
  onOpenTemplateSave,
}: {
  createForm: CreateFormState;
  setCreateForm: Dispatch<SetStateAction<CreateFormState>>;
  projects: Project[];
  issueTypes: IssueType[];
  people: Person[];
  epics: Epic[];
  createState: "idle" | "creating";
  configured: boolean;
  createFieldsLoading: boolean;
  epicsLoading: boolean;
  epicFieldAvailable: boolean;
  epicSelectionRequired: boolean;
  createFields: CreateFieldMetadata[];
  onCreate: (openAfterCreate: boolean) => void;
  onOpenTemplateSave?: () => void;
}) {
  const fieldNames = createFields.map((field) => field.name).join(", ");
  const hasProjects = projects.length > 0;
  const hasIssueTypes = issueTypes.length > 0;
  const hasPeople = people.length > 0;
  const hasEpics = epics.length > 0;
  const canCreate =
    configured &&
    hasProjects &&
    hasIssueTypes &&
    (!epicSelectionRequired || Boolean(createForm.epicId)) &&
    !createFieldsLoading &&
    createState !== "creating";
  const canSaveTemplate = Boolean(
    createForm.projectCode ||
      createForm.issueTypeId ||
      createForm.assigneeId ||
      createForm.epicId ||
      createForm.title.trim() ||
      createForm.description.trim(),
  );

  let summaryText = "Jira에서 추가 생성 메타데이터를 확인하지 못했습니다.";

  if (!configured) {
    summaryText = "Jira를 연결하고 실제 데이터를 동기화하면 이슈를 만들 수 있습니다.";
  } else if (!hasProjects) {
    summaryText = "동기화된 프로젝트가 없습니다. 먼저 동기화를 실행해주세요.";
  } else if (!hasIssueTypes) {
    summaryText = "선택한 프로젝트의 이슈 유형을 불러오는 중입니다.";
  } else if (createFieldsLoading) {
    summaryText = "Jira 생성 메타데이터를 불러오는 중입니다.";
  } else if (epicsLoading) {
    summaryText = "선택한 프로젝트의 에픽 목록을 불러오는 중입니다.";
  } else if (epicFieldAvailable && !hasEpics) {
    summaryText =
      "이 이슈 유형에서 사용할 에픽을 아직 찾지 못했습니다. 다시 동기화해보세요.";
  } else if (createFields.length > 0) {
    summaryText = `사용 가능한 Jira 필드: ${fieldNames}`;
  }

  const epicPlaceholder = epicsLoading
    ? "에픽 불러오는 중..."
    : epicFieldAvailable
      ? epicSelectionRequired
        ? "에픽을 선택하세요"
        : "키 또는 제목으로 에픽 검색"
      : "이 이슈 유형은 에픽 선택이 없습니다";
  const assigneePlaceholder = hasPeople
    ? "이름 또는 이메일로 담당자 검색"
    : "먼저 사용자 동기화를 해주세요";

  return (
    <div className="form-grid">
      <label>
        <span>프로젝트</span>
        <select
          value={createForm.projectCode}
          disabled={!hasProjects}
          onChange={(event) =>
            setCreateForm((previous) => ({
              ...previous,
              projectCode: event.target.value,
            }))
          }
        >
          {!hasProjects ? <option value="">먼저 프로젝트를 동기화하세요</option> : null}
          {projects.map((project) => (
            <option key={project.id} value={project.key}>
              {project.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span>이슈 유형</span>
        <select
          value={createForm.issueTypeId}
          disabled={!hasIssueTypes}
          onChange={(event) =>
            setCreateForm((previous) => ({
              ...previous,
              issueTypeId: event.target.value,
            }))
          }
        >
          {!hasIssueTypes ? <option value="">프로젝트를 먼저 선택해주세요</option> : null}
          {issueTypes.map((issueType) => (
            <option key={issueType.id} value={issueType.id}>
              {issueType.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span>담당자</span>
        <AssigneeSearchField
          people={people}
          selectedAssigneeId={createForm.assigneeId}
          setCreateForm={setCreateForm}
          disabled={!hasPeople}
          placeholder={assigneePlaceholder}
        />
      </label>

      <label>
        <span>에픽</span>
        <EpicSearchField
          epics={epics}
          selectedEpicId={createForm.epicId}
          setCreateForm={setCreateForm}
          disabled={epicsLoading || !epicFieldAvailable || (epicFieldAvailable && !hasEpics)}
          placeholder={epicPlaceholder}
          loading={epicsLoading}
        />
      </label>

      <label className="wide-field">
        <span>제목</span>
        <input
          value={createForm.title}
          placeholder="이슈 제목"
          onChange={(event) =>
            setCreateForm((previous) => ({
              ...previous,
              title: event.target.value,
            }))
          }
        />
      </label>

      <label className="wide-field">
        <span>설명</span>
        <textarea
          rows={6}
          value={createForm.description}
          placeholder="작업 내용이나 요청사항을 입력해주세요"
          onChange={(event) =>
            setCreateForm((previous) => ({
              ...previous,
              description: event.target.value,
            }))
          }
        />
      </label>

      <div className="form-summary wide-field">
        <div>
          <span className="eyebrow">현재 선택</span>
          <strong>
            {projects.find((project) => project.key === createForm.projectCode)?.name ??
              "프로젝트 없음"}{" "}
            /{" "}
            {issueTypes.find((issueType) => issueType.id === createForm.issueTypeId)?.name ??
              "이슈 유형 없음"}
          </strong>
          <p className="support-text">{summaryText}</p>
        </div>
        <div className="button-row wrap-row">
          <button
            className="button primary"
            type="button"
            onClick={() => onCreate(false)}
            disabled={!canCreate}
          >
            {createState === "creating" ? "생성 중..." : "생성"}
          </button>
          <button
            className="button secondary"
            type="button"
            onClick={() => onCreate(true)}
            disabled={!canCreate}
          >
            생성 후 Jira 열기
          </button>
          {onOpenTemplateSave ? (
            <button
              className="button secondary"
              type="button"
              onClick={onOpenTemplateSave}
              disabled={!canSaveTemplate}
            >
              템플릿 저장
            </button>
          ) : null}
          <button
            className="button tertiary"
            type="button"
            onClick={() =>
              setCreateForm((previous) => ({
                ...previous,
                title: "",
                description: "",
              }))
            }
          >
            텍스트 비우기
          </button>
        </div>
      </div>
    </div>
  );
}

function EpicSearchField({
  epics,
  selectedEpicId,
  setCreateForm,
  disabled,
  placeholder,
  loading,
}: {
  epics: Epic[];
  selectedEpicId: string;
  setCreateForm: Dispatch<SetStateAction<CreateFormState>>;
  disabled: boolean;
  placeholder: string;
  loading: boolean;
}) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [showAllOptions, setShowAllOptions] = useState(false);

  const selectedEpic = useMemo(
    () => epics.find((epic) => epic.id === selectedEpicId) ?? null,
    [epics, selectedEpicId],
  );

  useEffect(() => {
    setQuery(selectedEpic ? formatEpicLabel(selectedEpic) : "");
    setShowAllOptions(false);
  }, [selectedEpic]);

  const filteredEpics = useMemo(() => {
    const normalized = showAllOptions ? "" : query.trim().toLowerCase();

    return epics
      .filter((epic) => {
        if (!normalized) {
          return true;
        }

        const keyMatch = epic.key.toLowerCase().includes(normalized);
        const titleMatch = epic.name.toLowerCase().includes(normalized);
        return keyMatch || titleMatch;
      })
      .slice(0, 12);
  }, [epics, query, showAllOptions]);

  useEffect(() => {
    setHighlightedIndex(filteredEpics.length > 0 ? 0 : -1);
  }, [filteredEpics.length, query, showAllOptions]);

  function handleInputChange(value: string) {
    setQuery(value);
    setIsOpen(true);
    setShowAllOptions(false);

    setCreateForm((previous) =>
      previous.epicId === ""
        ? previous
        : {
            ...previous,
            epicId: "",
          },
    );
  }

  function handleSelectEpic(epic: Epic) {
    setCreateForm((previous) => ({
      ...previous,
      epicId: epic.id,
    }));
    setQuery(formatEpicLabel(epic));
    setIsOpen(false);
    setShowAllOptions(false);
  }

  return (
    <div className="search-picker">
      <div className="search-picker-input">
        <input
          type="text"
          value={query}
          placeholder={placeholder}
          disabled={disabled}
          onFocus={() => {
            if (!disabled) {
              setIsOpen(true);
              setShowAllOptions(true);
            }
          }}
          onBlur={() => {
            window.setTimeout(() => {
              setIsOpen(false);
              setShowAllOptions(false);
            }, 120);
          }}
          onChange={(event) => handleInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              if (!isOpen) {
                setIsOpen(true);
                setShowAllOptions(true);
                return;
              }

              if (filteredEpics.length > 0) {
                setHighlightedIndex((previous) => (previous + 1) % filteredEpics.length);
              }
            }

            if (event.key === "ArrowUp") {
              event.preventDefault();
              if (!isOpen) {
                setIsOpen(true);
                setShowAllOptions(true);
                return;
              }

              if (filteredEpics.length > 0) {
                setHighlightedIndex((previous) =>
                  previous <= 0 ? filteredEpics.length - 1 : previous - 1,
                );
              }
            }

            if (event.key === "Enter" && filteredEpics.length > 0) {
              event.preventDefault();
              handleSelectEpic(filteredEpics[Math.max(highlightedIndex, 0)]);
            }

            if (event.key === "Escape") {
              setIsOpen(false);
              setShowAllOptions(false);
            }
          }}
        />
        {isOpen ? (
          filteredEpics.length > 0 ? (
            <div className="search-picker-list">
              {filteredEpics.map((epic, index) => (
                <button
                  key={epic.id}
                  className={`search-picker-option ${
                    highlightedIndex === index ? "active" : ""
                  } ${selectedEpicId === epic.id ? "selected" : ""}`}
                  type="button"
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onMouseDown={() => handleSelectEpic(epic)}
                >
                  <strong>{formatEpicLabel(epic)}</strong>
                  <span>{epic.projectCode}</span>
                </button>
              ))}
            </div>
          ) : !loading ? (
            <div className="search-picker-empty">검색 결과가 없습니다.</div>
          ) : null
        ) : null}
      </div>

      {false && !selectedEpic ? (
        <span className="search-picker-help">키 또는 제목으로 에픽을 검색해서 선택하세요.</span>
      ) : null}
    </div>
  );
}

function AssigneeSearchField({
  people,
  selectedAssigneeId,
  setCreateForm,
  disabled,
  placeholder,
}: {
  people: Person[];
  selectedAssigneeId: string;
  setCreateForm: Dispatch<SetStateAction<CreateFormState>>;
  disabled: boolean;
  placeholder: string;
}) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [showAllOptions, setShowAllOptions] = useState(false);

  const selectedAssignee = useMemo(
    () => people.find((person) => person.accountId === selectedAssigneeId) ?? null,
    [people, selectedAssigneeId],
  );

  useEffect(() => {
    setQuery(selectedAssignee ? formatPersonLabel(selectedAssignee) : "");
    setShowAllOptions(false);
  }, [selectedAssignee]);

  const filteredPeople = useMemo(() => {
    const normalized = showAllOptions ? "" : query.trim().toLowerCase();

    return people
      .filter((person) => {
        if (!normalized) {
          return true;
        }

        const nameMatch = person.name.toLowerCase().includes(normalized);
        const emailMatch = (person.email ?? "").toLowerCase().includes(normalized);
        return nameMatch || emailMatch;
      })
      .slice(0, 12);
  }, [people, query, showAllOptions]);

  useEffect(() => {
    setHighlightedIndex(filteredPeople.length > 0 ? 0 : -1);
  }, [filteredPeople.length, query, showAllOptions]);

  function handleInputChange(value: string) {
    setQuery(value);
    setIsOpen(true);
    setShowAllOptions(false);

    setCreateForm((previous) =>
      previous.assigneeId === ""
        ? previous
        : {
            ...previous,
            assigneeId: "",
          },
    );
  }

  function handleSelectAssignee(person: Person) {
    setCreateForm((previous) => ({
      ...previous,
      assigneeId: person.accountId,
    }));
    setQuery(formatPersonLabel(person));
    setIsOpen(false);
    setShowAllOptions(false);
  }

  return (
    <div className="search-picker">
      <div className="search-picker-input">
        <input
          type="text"
          value={query}
          placeholder={placeholder}
          disabled={disabled}
          onFocus={() => {
            if (!disabled) {
              setIsOpen(true);
              setShowAllOptions(true);
            }
          }}
          onBlur={() => {
            window.setTimeout(() => {
              setIsOpen(false);
              setShowAllOptions(false);
            }, 120);
          }}
          onChange={(event) => handleInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              if (!isOpen) {
                setIsOpen(true);
                setShowAllOptions(true);
                return;
              }

              if (filteredPeople.length > 0) {
                setHighlightedIndex((previous) => (previous + 1) % filteredPeople.length);
              }
            }

            if (event.key === "ArrowUp") {
              event.preventDefault();
              if (!isOpen) {
                setIsOpen(true);
                setShowAllOptions(true);
                return;
              }

              if (filteredPeople.length > 0) {
                setHighlightedIndex((previous) =>
                  previous <= 0 ? filteredPeople.length - 1 : previous - 1,
                );
              }
            }

            if (event.key === "Enter" && filteredPeople.length > 0) {
              event.preventDefault();
              handleSelectAssignee(filteredPeople[Math.max(highlightedIndex, 0)]);
            }

            if (event.key === "Escape") {
              setIsOpen(false);
              setShowAllOptions(false);
            }
          }}
        />
        {isOpen ? (
          filteredPeople.length > 0 ? (
            <div className="search-picker-list">
              {filteredPeople.map((person, index) => (
                <button
                  key={person.accountId}
                  className={`search-picker-option ${
                    highlightedIndex === index ? "active" : ""
                  } ${selectedAssigneeId === person.accountId ? "selected" : ""}`}
                  type="button"
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onMouseDown={() => handleSelectAssignee(person)}
                >
                  <strong>{person.name}</strong>
                  <span>
                    {person.email
                      ? `${person.email}${person.role ? ` / ${person.role}` : ""}`
                      : person.role}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="search-picker-empty">검색 결과가 없습니다.</div>
          )
        ) : null}
      </div>

      {!selectedAssignee ? (
        <span className="search-picker-help">
          이름 또는 이메일로 담당자를 검색해서 선택하세요.
        </span>
      ) : null}
    </div>
  );
}

function TemplateNameModal({
  title,
  confirmLabel,
  initialValue,
  onClose,
  onConfirm,
}: {
  title: string;
  confirmLabel: string;
  initialValue: string;
  onClose: () => void;
  onConfirm: (name: string) => void;
}) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  return (
    <ModalShell title={title} onClose={onClose}>
      <label className="modal-field">
        <span>템플릿 이름</span>
        <input
          value={value}
          placeholder="템플릿 이름을 입력하세요"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && value.trim()) {
              event.preventDefault();
              onConfirm(value.trim());
            }
          }}
        />
      </label>
      <div className="button-row">
        <button className="button tertiary" type="button" onClick={onClose}>
          취소
        </button>
        <button
          className="button primary"
          type="button"
          disabled={!value.trim()}
          onClick={() => onConfirm(value.trim())}
        >
          {confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}

function ConfirmModal({
  title,
  description,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalShell title={title} onClose={onClose}>
      <p className="modal-description">{description}</p>
      <div className="button-row">
        <button className="button tertiary" type="button" onClick={onClose}>
          취소
        </button>
        <button className="button primary" type="button" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal-card glass-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <strong>{title}</strong>
          <button
            className="template-icon-button"
            type="button"
            aria-label="닫기"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

function isTemplateSelected(form: CreateFormState, templateForm: CreateFormState): boolean {
  return (
    form.projectCode === templateForm.projectCode &&
    form.issueTypeId === templateForm.issueTypeId &&
    form.assigneeId === templateForm.assigneeId &&
    form.epicId === templateForm.epicId &&
    form.title === templateForm.title &&
    form.description === templateForm.description
  );
}

export function EpicView({
  epics,
  createForm,
  setCreateForm,
  projects,
  issueTypes,
  people,
  createState,
  configured,
  createFieldsLoading,
  epicsLoading,
  epicFieldAvailable,
  epicSelectionRequired,
  createFields,
  onCreate,
  onPickEpic,
}: {
  epics: Epic[];
  createForm: CreateFormState;
  setCreateForm: Dispatch<SetStateAction<CreateFormState>>;
  projects: Project[];
  issueTypes: IssueType[];
  people: Person[];
  createState: "idle" | "creating";
  configured: boolean;
  createFieldsLoading: boolean;
  epicsLoading: boolean;
  epicFieldAvailable: boolean;
  epicSelectionRequired: boolean;
  createFields: CreateFieldMetadata[];
  onCreate: (openAfterCreate: boolean) => void;
  onPickEpic: (epic: Epic) => void;
}) {
  return (
    <div className="epic-layout">
      <section className="glass-panel panel-section epic-rail">
        <div className="section-head">
          <div>
            <span className="eyebrow">에픽 기준</span>
            <h3>동기화된 에픽</h3>
          </div>
        </div>
        {epics.length > 0 ? (
          <div className="epic-list">
            {epics.map((epic) => (
              <button
                key={epic.id}
                className={`epic-card ${createForm.epicId === epic.id ? "active" : ""}`}
                type="button"
                onClick={() => onPickEpic(epic)}
              >
                <span className="pill info">{epic.projectCode}</span>
                <strong>{formatEpicLabel(epic)}</strong>
                <p>{epic.cadence}</p>
                <span className="mini-note">최근 사용 {epic.recentUses}회</span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            title="동기화된 에픽 없음"
            description="동기화 후 실제 Jira 에픽만 여기에 표시됩니다."
          />
        )}
      </section>

      <section className="glass-panel panel-section epic-create-panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">에픽 기반 생성</span>
            <h3>에픽 기준으로 생성하기</h3>
          </div>
          <span className="mini-note">프로젝트와 에픽은 동기화된 데이터 기준으로 유지됩니다.</span>
        </div>
        <CreateFormPanel
          createForm={createForm}
          setCreateForm={setCreateForm}
          projects={projects}
          issueTypes={issueTypes}
          people={people}
          epics={epics}
          createState={createState}
          configured={configured}
          createFieldsLoading={createFieldsLoading}
          epicsLoading={epicsLoading}
          epicFieldAvailable={epicFieldAvailable}
          epicSelectionRequired={epicSelectionRequired}
          createFields={createFields}
          onCreate={onCreate}
        />
      </section>
    </div>
  );
}

export function SettingsView({
  settings,
  setSettings,
  navigationItems,
  projects,
  lastSyncedAt,
  syncProjects,
  syncPeople,
  syncEpics,
  onSync,
  onSave,
  onTestConnection,
  onClearCache,
  onRemoveAssignmentMenu,
  connectionState,
  configured,
  assignmentMenuUnlocked,
  lastError,
}: {
  settings: SettingsState;
  setSettings: Dispatch<SetStateAction<SettingsState>>;
  navigationItems: Array<{ id: ViewId; label: string; kicker: string }>;
  projects: Project[];
  lastSyncedAt: string;
  syncProjects: string;
  syncPeople: string;
  syncEpics: string;
  onSync: () => void;
  onSave: () => void;
  onTestConnection: () => void;
  onClearCache: () => void;
  onRemoveAssignmentMenu: () => void;
  connectionState: "idle" | "testing" | "connected" | "error";
  configured: boolean;
  assignmentMenuUnlocked: boolean;
  lastError: string | null;
}) {
  const [favoriteProjectCode, setFavoriteProjectCode] = useState("");
  const [favoriteLabel, setFavoriteLabel] = useState("");

  useEffect(() => {
    if (projects.length === 0) {
      setFavoriteProjectCode("");
      return;
    }

    if (!projects.some((project) => project.key === favoriteProjectCode)) {
      setFavoriteProjectCode(projects[0]?.key ?? "");
    }
  }, [favoriteProjectCode, projects]);

  const favoriteProjectDetails = useMemo(() => {
    return settings.favoriteProjects.map((favorite) => {
      const project = projects.find((candidate) => candidate.key === favorite.projectCode);
      return {
        ...favorite,
        projectName: project?.name ?? "사용할 수 없는 프로젝트",
        isAvailable: Boolean(project),
      };
    });
  }, [projects, settings.favoriteProjects]);

  function handleSaveFavoriteProject() {
    if (!favoriteProjectCode || !favoriteLabel.trim()) {
      return;
    }

    const nextFavorite: FavoriteProject = {
      projectCode: favoriteProjectCode,
      label: favoriteLabel.trim(),
    };

    setSettings((previous) => ({
      ...previous,
      favoriteProjects: [
        ...previous.favoriteProjects.filter(
          (favorite) => favorite.projectCode !== nextFavorite.projectCode,
        ),
        nextFavorite,
      ],
    }));
    setFavoriteLabel("");
  }

  function handleRemoveFavoriteProject(projectCode: string) {
    setSettings((previous) => ({
      ...previous,
      favoriteProjects: previous.favoriteProjects.filter(
        (favorite) => favorite.projectCode !== projectCode,
      ),
    }));
  }

  return (
    <div className="settings-grid">
      <section className="glass-panel panel-section">
        <div className="section-head">
          <div>
            <span className="eyebrow">연결</span>
            <h3>Jira 연결 설정</h3>
          </div>
          <span
            className={`pill ${
              connectionState === "connected"
                ? "success"
                : connectionState === "error"
                  ? "danger"
                  : "neutral"
            }`}
          >
            {connectionState === "connected"
              ? "연결됨"
              : connectionState === "testing"
                ? "테스트 중"
                : connectionState === "error"
                  ? "오류"
                  : "대기"}
          </span>
        </div>

        <div className="form-grid">
          <label>
            <span>도메인 prefix</span>
            <div className="input-with-suffix">
              <input
                placeholder="예: lendingmachine"
                value={settings.domainPrefix}
                onChange={(event) =>
                  setSettings((previous) => ({
                    ...previous,
                    domainPrefix: event.target.value,
                  }))
                }
              />
              <small>.atlassian.net</small>
            </div>
          </label>

          <label>
            <span>이메일</span>
            <input
              placeholder="이메일 주소"
              value={settings.email}
              onChange={(event) =>
                setSettings((previous) => ({
                  ...previous,
                  email: event.target.value,
                }))
              }
            />
          </label>

          <label>
            <span>API 토큰</span>
            <input
              type="password"
              placeholder="Atlassian API 토큰"
              value={settings.apiToken}
              onChange={(event) =>
                setSettings((previous) => ({
                  ...previous,
                  apiToken: event.target.value,
                }))
              }
            />
            <a
              className="field-help-link"
              href="https://id.atlassian.com/manage-profile/security/api-tokens"
              target="_blank"
              rel="noreferrer"
            >
              Atlassian API 토큰 발급 페이지 열기
            </a>
          </label>

          <label className="wide-field">
            <span>프록시 URL</span>
            <input
              placeholder="예: http://218.155.108.163:8787"
              value={settings.proxyUrl}
              onChange={(event) =>
                setSettings((previous) => ({
                  ...previous,
                  proxyUrl: event.target.value,
                }))
              }
            />
            <p className="support-text">
              GitHub Pages 배포본은 이 주소를 통해 Jira API를 우회 호출합니다.
            </p>
          </label>

        </div>

        <div className="button-row">
          <button className="button primary" type="button" onClick={onSave}>
            저장
          </button>
          <button className="button secondary" type="button" onClick={onTestConnection}>
            연결 테스트
          </button>
        </div>
        {!configured ? (
          <p className="support-text">
            입력한 연결 정보는 이 브라우저에만 저장되며 Jira API 호출에 사용됩니다.
          </p>
        ) : null}
        {lastError ? <p className="support-text error-text">{lastError}</p> : null}
      </section>

      <section className="glass-panel panel-section">
        <div className="section-head">
          <div>
            <span className="eyebrow">데이터 캐시</span>
            <h3>동기화된 Jira 데이터</h3>
          </div>
        </div>
        <div className="meta-grid">
          <article className="meta-card">
            <strong>{syncProjects}</strong>
            <span>프로젝트</span>
          </article>
          <article className="meta-card">
            <strong>{syncPeople}</strong>
            <span>사용자</span>
          </article>
          <article className="meta-card">
            <strong>{syncEpics}</strong>
            <span>에픽</span>
          </article>
        </div>
        <div className="button-row">
          <button className="button primary" type="button" onClick={onSync}>
            Jira 데이터 동기화
          </button>
          <button className="button tertiary" type="button" onClick={onClearCache}>
            캐시 초기화
          </button>
        </div>
        <p className="support-text">마지막 동기화: {lastSyncedAt}</p>
      </section>

      <section className="glass-panel panel-section settings-wide">
        <div className="section-head">
          <div>
            <span className="eyebrow">프로젝트 바로가기</span>
            <h3>자주 쓰는 프로젝트</h3>
          </div>
        </div>

        <div className="favorite-form">
          <label>
            <span>프로젝트</span>
            <select
              value={favoriteProjectCode}
              disabled={projects.length === 0}
              onChange={(event) => setFavoriteProjectCode(event.target.value)}
            >
              {projects.length === 0 ? <option value="">먼저 프로젝트를 동기화하세요</option> : null}
              {projects.map((project) => (
                <option key={project.id} value={project.key}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>바로가기 이름</span>
            <input
              value={favoriteLabel}
              placeholder="예: 운영 이슈"
              onChange={(event) => setFavoriteLabel(event.target.value)}
            />
          </label>

          <button
            className="button primary"
            type="button"
            onClick={handleSaveFavoriteProject}
            disabled={!favoriteProjectCode || favoriteLabel.trim().length === 0}
          >
            바로가기 저장
          </button>
        </div>

        {favoriteProjectDetails.length > 0 ? (
          <div className="favorite-list">
            {favoriteProjectDetails.map((favorite) => (
              <article className="favorite-row" key={favorite.projectCode}>
                <div>
                  <strong>{favorite.label}</strong>
                  <p>
                    {favorite.projectCode} / {favorite.projectName}
                  </p>
                </div>
                <div className="button-row">
                  {!favorite.isAvailable ? <span className="pill danger">사용 불가</span> : null}
                  <button
                    className="button tertiary"
                    type="button"
                    onClick={() => handleRemoveFavoriteProject(favorite.projectCode)}
                  >
                    삭제
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="저장된 바로가기 없음"
            description="자주 쓰는 프로젝트를 저장하면 빠른 생성 화면에서 바로 선택할 수 있습니다."
          />
        )}
      </section>

      <section className="glass-panel panel-section">
        <div className="section-head">
          <div>
            <span className="eyebrow">기본값</span>
            <h3>앱 기본 설정</h3>
          </div>
        </div>

        <div className="form-grid compact">
          <label>
            <span>기본 화면</span>
            <select
              value={settings.defaultView}
              onChange={(event) =>
                setSettings((previous) => ({
                  ...previous,
                  defaultView: event.target.value as ViewId,
                }))
              }
            >
              {navigationItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>기본 묶음 기준</span>
            <select
              value={settings.defaultGrouping}
              onChange={(event) =>
                setSettings((previous) => ({
                  ...previous,
                  defaultGrouping: event.target.value as GroupMode,
                }))
              }
            >
              <option value="project">프로젝트</option>
              <option value="status">상태</option>
              <option value="epic">에픽</option>
            </select>
          </label>
        </div>
        {assignmentMenuUnlocked ? (
          <div className="button-row">
            <button className="button tertiary" type="button" onClick={onRemoveAssignmentMenu}>
              업무할당 메뉴 삭제
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

export function CreateView({
  favoriteProjects,
  templates,
  createForm,
  setCreateForm,
  projects,
  issueTypes,
  people,
  epics,
  createState,
  configured,
  createFieldsLoading,
  epicsLoading,
  epicFieldAvailable,
  epicSelectionRequired,
  createFields,
  onCreate,
  onSaveTemplate,
  onApplyTemplate,
  onRenameTemplate,
  onDeleteTemplate,
  onPickFavoriteProject,
}: {
  favoriteProjects: FavoriteProjectView[];
  templates: CreateTemplateView[];
  createForm: CreateFormState;
  setCreateForm: Dispatch<SetStateAction<CreateFormState>>;
  projects: Project[];
  issueTypes: IssueType[];
  people: Person[];
  epics: Epic[];
  createState: "idle" | "creating";
  configured: boolean;
  createFieldsLoading: boolean;
  epicsLoading: boolean;
  epicFieldAvailable: boolean;
  epicSelectionRequired: boolean;
  createFields: CreateFieldMetadata[];
  onCreate: (openAfterCreate: boolean) => void;
  onSaveTemplate: (name: string) => void;
  onApplyTemplate: (template: CreateTemplate) => void;
  onRenameTemplate: (templateId: string, name: string) => void;
  onDeleteTemplate: (templateId: string) => void;
  onPickFavoriteProject: (favorite: FavoriteProject) => void;
}) {
  const [templateModalState, setTemplateModalState] = useState<
    | { mode: "create"; templateId?: never; initialName: string }
    | { mode: "rename"; templateId: string; initialName: string }
    | null
  >(null);
  const [templateToDelete, setTemplateToDelete] = useState<CreateTemplateView | null>(null);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [editingTemplateName, setEditingTemplateName] = useState("");

  const suggestedTemplateName = useMemo(() => {
    const trimmedTitle = createForm.title.trim();
    if (trimmedTitle) {
      return trimmedTitle;
    }

    const selectedProject = projects.find((project) => project.key === createForm.projectCode);
    return selectedProject ? `${selectedProject.name} 템플릿` : "새 템플릿";
  }, [createForm.projectCode, createForm.title, projects]);

  function startTemplateRename(template: CreateTemplateView) {
    setEditingTemplateId(template.id);
    setEditingTemplateName(template.name);
  }

  function cancelTemplateRename() {
    setEditingTemplateId(null);
    setEditingTemplateName("");
  }

  function submitTemplateRename() {
    const nextName = editingTemplateName.trim();

    if (editingTemplateId && nextName) {
      onRenameTemplate(editingTemplateId, nextName);
    }

    cancelTemplateRename();
  }

  return (
    <>
      <div className="create-layout">
        <div className="create-side">
          <section className="glass-panel panel-section suggestion-panel">
            <div className="section-head">
              <div>
                <span className="eyebrow">템플릿</span>
                <h3>빠른 생성 템플릿</h3>
              </div>
            </div>
            {templates.length > 0 ? (
              <div className="template-grid">
                {templates.map((template) => (
                  <article
                    key={template.id}
                    className={`template-card ${
                      isTemplateSelected(createForm, template.form) ? "active" : ""
                    }`}
                    role="button"
                    tabIndex={editingTemplateId === template.id ? -1 : 0}
                    onClick={() => {
                      if (editingTemplateId !== template.id) {
                        onApplyTemplate(template);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (editingTemplateId === template.id) {
                        return;
                      }

                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onApplyTemplate(template);
                      }
                    }}
                  >
                    <div className="template-card-head">
                      <div className="template-card-title-row">
                        {editingTemplateId === template.id ? (
                          <input
                            className="template-name-input"
                            value={editingTemplateName}
                            autoFocus
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => setEditingTemplateName(event.target.value)}
                            onBlur={() => submitTemplateRename()}
                            onKeyDown={(event) => {
                              event.stopPropagation();

                              if (event.key === "Enter") {
                                event.preventDefault();
                                submitTemplateRename();
                              }

                              if (event.key === "Escape") {
                                event.preventDefault();
                                cancelTemplateRename();
                              }
                            }}
                          />
                        ) : (
                          <>
                            <strong className="template-card-name">{template.name}</strong>
                            <button
                              className="template-icon-button template-rename-button"
                              type="button"
                              aria-label={`${template.name} 이름 수정`}
                              onClick={(event) => {
                                event.stopPropagation();
                                startTemplateRename(template);
                              }}
                            >
                              ✎
                            </button>
                          </>
                        )}
                      </div>
                      <button
                        className="template-icon-button template-delete-button"
                        type="button"
                        aria-label={`${template.name} 템플릿 삭제`}
                        onClick={(event) => {
                          event.stopPropagation();
                          cancelTemplateRename();
                          setTemplateToDelete(template);
                        }}
                      >
                        ×
                      </button>
                    </div>
                    <div className="template-card-actions">
                      <button
                        className="button tertiary"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          startTemplateRename(template);
                        }}
                      >
                        이름 수정
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState
                title="저장된 템플릿 없음"
                description="작성 중인 티켓을 템플릿으로 저장하면 여기에서 바로 불러올 수 있습니다."
              />
            )}
          </section>

          <section className="glass-panel panel-section suggestion-panel">
            <div className="section-head">
              <div>
                <span className="eyebrow">프로젝트 바로가기</span>
                <h3>자주 쓰는 프로젝트</h3>
              </div>
            </div>
            {favoriteProjects.length > 0 ? (
              <div className="favorite-grid">
                {favoriteProjects.map((favorite) => (
                  <button
                    key={favorite.projectCode}
                    className={`favorite-card ${
                      createForm.projectCode === favorite.projectCode ? "active" : ""
                    }`}
                    type="button"
                    onClick={() =>
                      onPickFavoriteProject({
                        projectCode: favorite.projectCode,
                        label: favorite.label,
                      })
                    }
                  >
                    <span className="pill info">{favorite.projectCode}</span>
                    <strong>{favorite.label}</strong>
                    <p>{favorite.projectName}</p>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState
                title="저장된 프로젝트 바로가기 없음"
                description="설정에서 자주 쓰는 프로젝트를 저장하면 빠르게 선택할 수 있습니다."
              />
            )}
          </section>

        </div>

        <section className="glass-panel panel-section">
          <div className="section-head">
            <div>
              <span className="eyebrow">빠른 생성</span>
              <h3>Jira 이슈 만들기</h3>
            </div>
            <span className="mini-note">실제 Jira 메타데이터 기준으로 입력합니다.</span>
          </div>
          <CreateFormPanel
            createForm={createForm}
            setCreateForm={setCreateForm}
            projects={projects}
            issueTypes={issueTypes}
            people={people}
            epics={epics}
            createState={createState}
            configured={configured}
            createFieldsLoading={createFieldsLoading}
            epicsLoading={epicsLoading}
            epicFieldAvailable={epicFieldAvailable}
            epicSelectionRequired={epicSelectionRequired}
            createFields={createFields}
            onCreate={onCreate}
            onOpenTemplateSave={() =>
              setTemplateModalState({
                mode: "create",
                initialName: suggestedTemplateName,
              })
            }
          />
        </section>
      </div>

      {templateModalState ? (
        <TemplateNameModal
          title={templateModalState.mode === "create" ? "템플릿 저장" : "템플릿 이름 수정"}
          confirmLabel={templateModalState.mode === "create" ? "저장" : "수정"}
          initialValue={templateModalState.initialName}
          onClose={() => setTemplateModalState(null)}
          onConfirm={(name) => {
            if (templateModalState.mode === "create") {
              onSaveTemplate(name);
            } else {
              onRenameTemplate(templateModalState.templateId, name);
            }
            setTemplateModalState(null);
          }}
        />
      ) : null}

      {templateToDelete ? (
        <ConfirmModal
          title="템플릿 삭제"
          description={`"${templateToDelete.name}" 템플릿을 삭제하시겠습니까?`}
          confirmLabel="삭제"
          onClose={() => setTemplateToDelete(null)}
          onConfirm={() => {
            onDeleteTemplate(templateToDelete.id);
            setTemplateToDelete(null);
          }}
        />
      ) : null}
    </>
  );
}
