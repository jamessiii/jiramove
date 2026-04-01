import type { ViewId } from "./types";

export const navigation: Array<{ id: ViewId; label: string; kicker: string }> = [
  { id: "dashboard", label: "대시보드", kicker: "개요" },
  { id: "assignment", label: "업무할당", kicker: "할당" },
  { id: "create", label: "빠른 생성", kicker: "생성" },
  { id: "recent", label: "최근 생성", kicker: "기록" },
  { id: "settings", label: "설정", kicker: "연결" },
];
