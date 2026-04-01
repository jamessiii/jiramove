import { useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { GroupMode, RecentTicket, Ticket, TicketScope } from "../types";

const priorityTone: Record<Ticket["priority"], string> = {
  Low: "neutral",
  Medium: "info",
  High: "warning",
  Urgent: "danger",
};

const priorityLabel: Record<Ticket["priority"], string> = {
  Low: "낮음",
  Medium: "보통",
  High: "높음",
  Urgent: "긴급",
};

type DashboardCardId = "all" | "mine" | "mentions" | "review" | "recent";

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

export function DashboardView({
  dashboardCards,
  allTickets,
  assignedTickets,
  reviewTickets,
  recentCreated,
  mentionTickets,
  onGoToCreate,
  onOpenIssue,
  onOpenRecent,
  onReuseRecent,
}: {
  dashboardCards: Array<{
    id: DashboardCardId;
    label: string;
    value: number;
    tone: string;
  }>;
  allTickets: Ticket[];
  assignedTickets: Ticket[];
  reviewTickets: Ticket[];
  recentCreated: RecentTicket[];
  mentionTickets: Ticket[];
  onGoToCreate: () => void;
  onOpenIssue: (ticket: Ticket) => void;
  onOpenRecent: (ticket: RecentTicket) => void;
  onReuseRecent: (ticket: RecentTicket) => void;
}) {
  const [selectedCard, setSelectedCard] = useState<DashboardCardId>("all");

  const selectedView = useMemo(() => {
    switch (selectedCard) {
      case "mine":
        return {
          eyebrow: "내 작업",
          title: "내 담당 이슈",
          countLabel: `${assignedTickets.length}건`,
          tickets: assignedTickets,
          recentTickets: [] as RecentTicket[],
        };
      case "mentions":
        return {
          eyebrow: "언급 현황",
          title: "언급된 이슈",
          countLabel: `${mentionTickets.length}건`,
          tickets: mentionTickets,
          recentTickets: [] as RecentTicket[],
        };
      case "review":
        return {
          eyebrow: "리뷰",
          title: "리뷰가 필요한 이슈",
          countLabel: `${reviewTickets.length}건`,
          tickets: reviewTickets,
          recentTickets: [] as RecentTicket[],
        };
      case "recent":
        return {
          eyebrow: "최근 생성",
          title: "최근 만든 이슈",
          countLabel: `${recentCreated.length}건`,
          tickets: [] as Ticket[],
          recentTickets: recentCreated,
        };
      case "all":
      default:
        return {
          eyebrow: "전체",
          title: "전체 이슈",
          countLabel: `${allTickets.length}건`,
          tickets: allTickets,
          recentTickets: [] as RecentTicket[],
        };
    }
  }, [allTickets, assignedTickets, mentionTickets, recentCreated, reviewTickets, selectedCard]);

  const isRecentView = selectedCard === "recent";

  return (
    <div className="dashboard-grid">
      <section className="panel-section glass-panel dashboard-summary-panel">
        <div className="dashboard-summary-grid">
          {dashboardCards.map((card) => (
            <button
              key={card.id}
              type="button"
              className={`dashboard-summary-card ${selectedCard === card.id ? "active" : ""}`}
              onClick={() => setSelectedCard(card.id)}
            >
              <span className={`pill ${card.tone}`}>{card.label}</span>
              <strong>{card.value}</strong>
              <span className="dashboard-summary-caption">
                {card.id === "recent" ? "최근 생성 이슈" : "동기화된 이슈"}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel-section glass-panel dashboard-results-panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">{selectedView.eyebrow}</span>
            <h3>{selectedView.title}</h3>
          </div>
          <div className="dashboard-results-actions">
            <span className="mini-note">{selectedView.countLabel}</span>
            <button className="button secondary" type="button" onClick={onGoToCreate}>
              이슈 생성
            </button>
          </div>
        </div>

        <div className="dashboard-ticket-grid">
          {isRecentView ? (
            selectedView.recentTickets.length > 0 ? (
              selectedView.recentTickets.map((ticket, index) => (
                <RecentTicketCard
                  key={`${ticket.key}-${index}`}
                  ticket={ticket}
                  onOpen={() => onOpenRecent(ticket)}
                  onReuse={() => onReuseRecent(ticket)}
                />
              ))
            ) : (
              <EmptyState
                title="최근 생성 이슈가 없습니다"
                description="이슈를 하나 생성하면 여기에서 바로 다시 확인할 수 있습니다."
              />
            )
          ) : selectedView.tickets.length > 0 ? (
            selectedView.tickets.map((ticket) => (
              <TicketCard key={ticket.id} ticket={ticket} onOpen={() => onOpenIssue(ticket)} />
            ))
          ) : (
            <EmptyState
              title="표시할 이슈가 없습니다"
              description="동기화를 다시 실행하거나 다른 카드를 선택해 보세요."
            />
          )}
        </div>
      </section>
    </div>
  );
}

export function AssignmentView({
  tickets,
  onOpenIssue,
}: {
  tickets: Ticket[];
  onOpenIssue: (ticket: Ticket) => void;
}) {
  const [selectedDevelopers, setSelectedDevelopers] = useState<string[]>([]);

  const developerOptions = useMemo(() => {
    const labels = tickets.flatMap((ticket) =>
      ticket.developmentAssignees.length > 0 ? ticket.developmentAssignees : ["미지정"],
    );

    return Array.from(new Set(labels)).sort((left, right) => {
      if (left === "미지정") {
        return 1;
      }
      if (right === "미지정") {
        return -1;
      }
      return left.localeCompare(right, "ko");
    });
  }, [tickets]);

  const filteredTickets = useMemo(() => {
    return tickets.filter((ticket) => {
      const developers =
        ticket.developmentAssignees.length > 0 ? ticket.developmentAssignees : ["미지정"];

      return (
        selectedDevelopers.length === 0 ||
        developers.some((developer) => selectedDevelopers.includes(developer))
      );
    });
  }, [selectedDevelopers, tickets]);

  function toggleDeveloper(developer: string) {
    setSelectedDevelopers((previous) =>
      previous.includes(developer)
        ? previous.filter((candidate) => candidate !== developer)
        : [...previous, developer],
    );
  }

  return (
    <div className="stack-layout">
      <section className="glass-panel panel-section assignment-filter-panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">업무할당</span>
            <h3>개발 담당자 기준 보기</h3>
          </div>
          <div className="assignment-filter-meta">
            <span className="mini-note">{filteredTickets.length}개 이슈</span>
          </div>
        </div>

        <div className="chip-group">
          <button
            type="button"
            className={`chip-button ${selectedDevelopers.length === 0 ? "active" : ""}`}
            onClick={() => setSelectedDevelopers([])}
          >
            전체
          </button>
          {developerOptions.map((developer) => (
            <button
              key={developer}
              type="button"
              className={`chip-button ${selectedDevelopers.includes(developer) ? "active" : ""}`}
              onClick={() => toggleDeveloper(developer)}
            >
              {developer}
            </button>
          ))}
        </div>
      </section>

      <section className="glass-panel panel-section">
        <div className="section-head">
          <div>
            <span className="eyebrow">결과</span>
            <h3>{selectedDevelopers.length > 0 ? "선택한 담당자 이슈" : "전체 업무 이슈"}</h3>
          </div>
          <span className="mini-note">상태는 개발 요청, 요청 필드는 완료 제외</span>
        </div>

        <div className="dashboard-ticket-grid">
          {filteredTickets.length > 0 ? (
            filteredTickets.map((ticket) => (
              <AssignmentTicketCard
                key={ticket.id}
                ticket={ticket}
                onOpen={() => onOpenIssue(ticket)}
              />
            ))
          ) : (
            <EmptyState
              title="조건에 맞는 이슈가 없습니다"
              description="개발 담당자 선택을 조정하거나 다시 동기화해 보세요."
            />
          )}
        </div>
      </section>
    </div>
  );
}

export function TicketsView({
  filteredTickets,
  ticketGroups,
  ticketScope,
  setTicketScope,
  groupMode,
  setGroupMode,
  onlyMine,
  setOnlyMine,
  onlyMentioned,
  setOnlyMentioned,
  onOpenIssue,
  onCopyIssueKey,
}: {
  filteredTickets: Ticket[];
  ticketGroups: Record<string, Ticket[]>;
  ticketScope: TicketScope;
  setTicketScope: Dispatch<SetStateAction<TicketScope>>;
  groupMode: GroupMode;
  setGroupMode: Dispatch<SetStateAction<GroupMode>>;
  onlyMine: boolean;
  setOnlyMine: Dispatch<SetStateAction<boolean>>;
  onlyMentioned: boolean;
  setOnlyMentioned: Dispatch<SetStateAction<boolean>>;
  onOpenIssue: (ticket: Ticket) => void;
  onCopyIssueKey: (ticket: Ticket) => void;
}) {
  const scopes: Array<[TicketScope, string]> = [
    ["all", "전체"],
    ["mine", "내 것"],
    ["in-progress", "진행 중"],
    ["waiting", "대기"],
    ["done", "완료"],
    ["mentioned", "언급됨"],
  ];

  return (
    <div className="stack-layout">
      <section className="glass-panel panel-section filter-bar">
        <div className="chip-group">
          {scopes.map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`chip-button ${ticketScope === id ? "active" : ""}`}
              onClick={() => setTicketScope(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="toolbar-row">
          <select value={groupMode} onChange={(event) => setGroupMode(event.target.value as GroupMode)}>
            <option value="project">프로젝트별</option>
            <option value="status">상태별</option>
            <option value="epic">에픽별</option>
          </select>
          <label className="toggle">
            <input
              type="checkbox"
              checked={onlyMine}
              onChange={(event) => setOnlyMine(event.target.checked)}
            />
            <span>내 것만</span>
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={onlyMentioned}
              onChange={(event) => setOnlyMentioned(event.target.checked)}
            />
            <span>언급된 것만</span>
          </label>
          <span className="mini-note">{filteredTickets.length}개 이슈</span>
        </div>
      </section>

      <section className="ticket-groups">
        {Object.keys(ticketGroups).length > 0 ? (
          Object.entries(ticketGroups).map(([group, groupTickets]) => (
            <article className="glass-panel panel-section" key={group}>
              <div className="section-head">
                <div>
                  <span className="eyebrow">그룹</span>
                  <h3>{group}</h3>
                </div>
                <span className="mini-note">{groupTickets.length}건</span>
              </div>
              <div className="ticket-stack">
                {groupTickets.map((ticket) => (
                  <TicketCard
                    key={ticket.id}
                    ticket={ticket}
                    onOpen={() => onOpenIssue(ticket)}
                    onCopy={() => onCopyIssueKey(ticket)}
                  />
                ))}
              </div>
            </article>
          ))
        ) : (
          <section className="glass-panel panel-section">
            <EmptyState
              title="표시할 이슈가 없습니다"
              description="동기화를 다시 실행하거나 필터를 조정해 보세요."
            />
          </section>
        )}
      </section>
    </div>
  );
}

export function StatusView({
  tickets,
  statusColumns,
  onOpenIssue,
  onCopyIssueKey,
}: {
  tickets: Ticket[];
  statusColumns: string[];
  onOpenIssue: (ticket: Ticket) => void;
  onCopyIssueKey: (ticket: Ticket) => void;
}) {
  if (tickets.length === 0) {
    return (
      <section className="glass-panel panel-section">
        <EmptyState
          title="보드 데이터가 없습니다"
          description="먼저 Jira 이슈를 동기화하면 상태별 보드가 채워집니다."
        />
      </section>
    );
  }

  return (
    <div className="board-grid">
      {statusColumns.map((status) => (
        <section className="glass-panel board-column" key={status}>
          <div className="section-head">
            <div>
              <span className="eyebrow">상태</span>
              <h3>{status}</h3>
            </div>
            <span className="pill neutral">
              {tickets.filter((ticket) => ticket.status === status).length}
            </span>
          </div>
          <div className="ticket-stack">
            {tickets
              .filter((ticket) => ticket.status === status)
              .map((ticket) => (
                <TicketCard
                  key={ticket.id}
                  ticket={ticket}
                  compact
                  onOpen={() => onOpenIssue(ticket)}
                  onCopy={() => onCopyIssueKey(ticket)}
                />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function MentionsView({
  tickets,
  onOpenIssue,
}: {
  tickets: Ticket[];
  onOpenIssue: (ticket: Ticket) => void;
}) {
  return (
    <div className="stack-layout">
      <section className="glass-panel panel-section">
        <div className="section-head">
          <div>
            <span className="eyebrow">언급만</span>
            <h3>최근 언급 이슈</h3>
          </div>
          <span className="mini-note">해당 이슈를 Jira에서 바로 열 수 있습니다</span>
        </div>
        <div className="mention-grid">
          {tickets.length > 0 ? (
            tickets.map((ticket) => (
              <article className="mention-card" key={ticket.id}>
                <div className="mention-head">
                  <span className="pill accent">{ticket.key}</span>
                  <span>{ticket.updatedAtLabel}</span>
                </div>
                <strong>{ticket.summary}</strong>
                <p>{ticket.project}</p>
                <div className="mention-meta">
                  <span>동기화된 이슈 데이터에서 언급 내용을 찾았습니다.</span>
                  <button className="button tertiary" type="button" onClick={() => onOpenIssue(ticket)}>
                    Jira에서 열기
                  </button>
                </div>
              </article>
            ))
          ) : (
            <EmptyState
              title="언급된 이슈가 없습니다"
              description="정상적으로 동기화되면 언급된 이슈가 여기에 표시됩니다."
            />
          )}
        </div>
      </section>
    </div>
  );
}

export function RecentView({
  recentCreated,
  onOpenRecent,
  onReuseRecent,
}: {
  recentCreated: RecentTicket[];
  onOpenRecent: (ticket: RecentTicket) => void;
  onReuseRecent: (ticket: RecentTicket) => void;
}) {
  return (
    <section className="glass-panel panel-section">
      <div className="section-head">
        <div>
          <span className="eyebrow">기록</span>
          <h3>최근 만든 이슈</h3>
        </div>
        <span className="mini-note">최근 생성 이슈를 빠르게 다시 불러올 수 있습니다</span>
      </div>
      <div className="recent-table">
        {recentCreated.length > 0 ? (
          recentCreated.map((ticket, index) => (
            <article className="recent-row" key={`${ticket.key}-${index}`}>
              <div className="recent-main">
                <strong>{ticket.key}</strong>
                <p>{ticket.summary}</p>
              </div>
              <span>{ticket.projectCode}</span>
              <span>{ticket.epic || "에픽 미지정"}</span>
              <span>{ticket.createdAt}</span>
              <div className="button-row">
                <button className="button tertiary" type="button" onClick={() => onOpenRecent(ticket)}>
                  Jira에서 열기
                </button>
                <button className="button tertiary" type="button" onClick={() => onReuseRecent(ticket)}>
                  폼에 불러오기
                </button>
              </div>
            </article>
          ))
        ) : (
          <EmptyState
            title="최근 생성 기록이 없습니다"
            description="빠른 생성에서 이슈를 만들면 자동으로 기록됩니다."
          />
        )}
      </div>
    </section>
  );
}

export function TicketCard({
  ticket,
  compact = false,
  onOpen,
  onCopy,
}: {
  ticket: Ticket;
  compact?: boolean;
  onOpen?: () => void;
  onCopy?: () => void;
}) {
  return (
    <article className={`ticket-card ${compact ? "compact" : ""}`}>
      <div className="ticket-head">
        <span className="pill info">{ticket.key}</span>
        <span className={`pill ${priorityTone[ticket.priority]}`}>{priorityLabel[ticket.priority]}</span>
      </div>
      <strong>{ticket.summary}</strong>
      <div className="ticket-meta">
        <span>{ticket.projectCode}</span>
        <span>{ticket.status}</span>
        <span>{ticket.assignee}</span>
      </div>
      <div className="ticket-footer">
        <span>{ticket.epic || "에픽 없음"}</span>
        <span>{ticket.updatedAtLabel}</span>
      </div>
      {onOpen || onCopy ? (
        <div className="ticket-actions">
          {onOpen ? (
            <button className="button tertiary" type="button" onClick={onOpen}>
              Jira에서 열기
            </button>
          ) : null}
          {onCopy ? (
            <button className="button tertiary" type="button" onClick={onCopy}>
              키 복사
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function AssignmentTicketCard({
  ticket,
  onOpen,
}: {
  ticket: Ticket;
  onOpen: () => void;
}) {
  const developmentAssigneeLabel =
    ticket.developmentAssignees.length > 0
      ? ticket.developmentAssignees.join(", ")
      : "미지정";

  return (
    <article className="ticket-card">
      <div className="ticket-head">
        <span className="pill info">{ticket.key}</span>
        <span className="pill warning">{ticket.developmentRequestStatus || "진행 중"}</span>
      </div>
      <strong>{ticket.summary}</strong>
      <div className="ticket-meta">
        <span>{ticket.projectCode}</span>
        <span>{ticket.status}</span>
        <span>{ticket.assignee}</span>
      </div>
      <div className="ticket-footer">
        <span>{ticket.epic || "에픽 없음"}</span>
        <span>{ticket.issueTypeName}</span>
      </div>
      <div className="ticket-footer">
        <span>{`개발 담당자: ${developmentAssigneeLabel}`}</span>
        <span>{ticket.updatedAtLabel}</span>
      </div>
      <div className="ticket-actions">
        <button className="button tertiary" type="button" onClick={onOpen}>
          Jira에서 열기
        </button>
      </div>
    </article>
  );
}

function RecentTicketCard({
  ticket,
  onOpen,
  onReuse,
}: {
  ticket: RecentTicket;
  onOpen: () => void;
  onReuse: () => void;
}) {
  return (
    <article className="ticket-card recent-ticket-card">
      <div className="ticket-head">
        <span className="pill success">{ticket.key}</span>
        <span className="pill neutral">최근 생성</span>
      </div>
      <strong>{ticket.summary}</strong>
      <div className="ticket-meta recent-ticket-meta">
        <span>{ticket.projectCode}</span>
        <span>{ticket.epic || "에픽 미지정"}</span>
        <span>{ticket.createdAt}</span>
      </div>
      <div className="ticket-footer">
        <span>최근 생성 기록</span>
        <span>{ticket.createdAt}</span>
      </div>
      <div className="ticket-actions">
        <button className="button tertiary" type="button" onClick={onOpen}>
          Jira에서 열기
        </button>
        <button className="button tertiary" type="button" onClick={onReuse}>
          폼에 불러오기
        </button>
      </div>
    </article>
  );
}
