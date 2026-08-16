"use client";

import {
  ArrowLeft, BookOpen, Check, ChevronRight, Clipboard, Clock3, Download,
  FileDown, FileSpreadsheet, History, LogOut, Plus, RotateCcw, Search,
  PencilLine, Settings, ShieldCheck, Trash2, Upload, Users, X,
} from "lucide-react";
import { useConvex, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { neatBytes } from "@/lib/neisBytes";
import { FormEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

type Session = { token: string; role: "student" | "teacher"; name: string; studentId?: string; expiresAt?: number };
type View = "records" | "detail" | "scratchpad" | "settings";
type Filters = { className: string; number: string; name: string; subject: string; content: string };
type ExportableRecord = {
  classNumber: number;
  studentNumber: number;
  studentName: string;
  subjectLabel: string;
  content: string;
  updatedAt?: number;
};
type RecordListRow = {
  _id: string;
  classNumber: number;
  studentNumber: number;
  studentName: string;
  subjectLabel: string;
  content?: string;
  contentPreview?: string;
  contentBytes?: number;
  updatedAt: number;
};
type HistoryEntry = {
  _id: Id<"histories">;
  beforeContent: string;
  afterContent: string;
  addedCount: number;
  removedCount: number;
  actorName: string;
  createdAt: number;
};
type RecordDetail = {
  _id: Id<"records">;
  studentName: string;
  classNumber: number;
  studentNumber: number;
  subjectLabel: string;
  content: string;
  updatedAt: number;
};
type StudentAdminRow = {
  _id: Id<"students">;
  classNumber: number;
  studentNumber: number;
  name: string;
  updatedAt: number;
};
type SubjectAdminRow = {
  _id: Id<"subjects">;
  label: string;
  recordCount: number;
};
type SheetRow = Record<string, unknown>;

const RECORD_EXPORT_HEADERS = ["반", "번호", "이름", "내용", "나이스 바이트", "마지막 수정"];
type DiffPart = { kind: "same" | "removed" | "added"; text: string };

const safeFileName = (value: string) => value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "생활기록부.xlsx";
const safeSheetName = (value: string) => value.replace(/[:\\/?*\[\]]/g, "_").trim().slice(0, 31) || "생활기록부";

const createWorksheet = (rows: Record<string, unknown>[], headers?: string[]) => {
  const worksheet = XLSX.utils.json_to_sheet(rows, headers ? { header: headers } : undefined);
  const resolvedHeaders = headers ?? (rows[0] ? Object.keys(rows[0]) : []);
  if (worksheet["!ref"]) worksheet["!autofilter"] = { ref: worksheet["!ref"] };
  worksheet["!cols"] = resolvedHeaders.map((header) => {
    const longest = rows.reduce((width, row) => Math.max(width, Array.from(String(row[header] ?? "")).length), Array.from(header).length);
    return { wch: Math.min(Math.max(longest + 2, 8), header === "내용" ? 60 : 24) };
  });
  return worksheet;
};

const characterDiff = (before: string, after: string): DiffPart[] => {
  const oldChars = Array.from(before);
  const newChars = Array.from(after);
  if (before === after) return before ? [{ kind: "same", text: before }] : [];
  if (!oldChars.length) return [{ kind: "added", text: after }];
  if (!newChars.length) return [{ kind: "removed", text: before }];

  const trace: Map<number, number>[] = [];
  const frontier = new Map<number, number>([[1, 0]]);
  let finalDepth = 0;

  search: for (let depth = 0; depth <= oldChars.length + newChars.length; depth += 1) {
    trace.push(new Map(frontier));
    for (let diagonal = -depth; diagonal <= depth; diagonal += 2) {
      const left = frontier.get(diagonal - 1) ?? Number.NEGATIVE_INFINITY;
      const right = frontier.get(diagonal + 1) ?? Number.NEGATIVE_INFINITY;
      let oldIndex = diagonal === -depth || (diagonal !== depth && left < right) ? right : left + 1;
      if (!Number.isFinite(oldIndex)) oldIndex = 0;
      let newIndex = oldIndex - diagonal;
      while (oldIndex < oldChars.length && newIndex < newChars.length && oldChars[oldIndex] === newChars[newIndex]) {
        oldIndex += 1;
        newIndex += 1;
      }
      frontier.set(diagonal, oldIndex);
      if (oldIndex >= oldChars.length && newIndex >= newChars.length) {
        finalDepth = depth;
        break search;
      }
    }
  }

  const operations: Array<{ kind: DiffPart["kind"]; char: string }> = [];
  let oldIndex = oldChars.length;
  let newIndex = newChars.length;
  for (let depth = finalDepth; depth >= 0; depth -= 1) {
    const previous = trace[depth];
    const diagonal = oldIndex - newIndex;
    const left = previous.get(diagonal - 1) ?? Number.NEGATIVE_INFINITY;
    const right = previous.get(diagonal + 1) ?? Number.NEGATIVE_INFINITY;
    const previousDiagonal = diagonal === -depth || (diagonal !== depth && left < right) ? diagonal + 1 : diagonal - 1;
    const previousOldIndex = previous.get(previousDiagonal) ?? 0;
    const previousNewIndex = previousOldIndex - previousDiagonal;

    while (oldIndex > previousOldIndex && newIndex > previousNewIndex) {
      operations.push({ kind: "same", char: oldChars[oldIndex - 1] });
      oldIndex -= 1;
      newIndex -= 1;
    }
    if (depth === 0) break;
    if (oldIndex === previousOldIndex) {
      operations.push({ kind: "added", char: newChars[newIndex - 1] });
      newIndex -= 1;
    } else {
      operations.push({ kind: "removed", char: oldChars[oldIndex - 1] });
      oldIndex -= 1;
    }
  }

  const result: DiffPart[] = [];
  for (const operation of operations.reverse()) {
    const last = result[result.length - 1];
    if (last?.kind === operation.kind) last.text += operation.char;
    else result.push({ kind: operation.kind, text: operation.char });
  }
  return result;
};

const downloadWorkbook = (rows: Record<string, unknown>[], fileName: string, sheetName: string, headers?: string[]) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, createWorksheet(rows, headers), safeSheetName(sheetName));
  XLSX.writeFile(workbook, safeFileName(fileName));
};

const toRecordExportRow = (record: ExportableRecord) => ({
  반: record.classNumber,
  번호: record.studentNumber,
  이름: record.studentName,
  내용: record.content,
  "나이스 바이트": neatBytes(record.content),
  "마지막 수정": record.updatedAt ? new Date(record.updatedAt).toLocaleString("ko-KR") : "",
});

const downloadRecordsBySubject = (records: ExportableRecord[], fileName: string) => {
  const workbook = XLSX.utils.book_new();
  const grouped = new Map<string, ExportableRecord[]>();
  for (const record of records) {
    const subject = record.subjectLabel.trim() || "과목 미지정";
    grouped.set(subject, [...(grouped.get(subject) ?? []), record]);
  }

  const usedSheetNames = new Set<string>();
  for (const [subject, subjectRecords] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b, "ko"))) {
    const baseName = safeSheetName(subject);
    let sheetName = baseName;
    let suffix = 2;
    while (usedSheetNames.has(sheetName)) {
      const suffixText = `_${suffix++}`;
      sheetName = `${baseName.slice(0, 31 - suffixText.length)}${suffixText}`;
    }
    usedSheetNames.add(sheetName);
    XLSX.utils.book_append_sheet(
      workbook,
      createWorksheet(subjectRecords.map(toRecordExportRow), RECORD_EXPORT_HEADERS),
      sheetName,
    );
  }

  XLSX.writeFile(workbook, safeFileName(fileName));
};

const copyToClipboard = async (text: string) => {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("clipboard copy failed");
};

export default function Home() {
  const login = useMutation(api.auth.login);
  const logoutMutation = useMutation(api.auth.logout);
  const [session, setSession] = useState<Session | null>(null);
  const validatedSession = useQuery(
    api.auth.me,
    session ? { sessionToken: session.token } : "skip",
  );
  const [ready, setReady] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [view, setView] = useState<View>("records");
  const [recordId, setRecordId] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = window.localStorage.getItem("recorddam-session");
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as Session;
          if (parsed.expiresAt && parsed.expiresAt <= Date.now()) {
            window.localStorage.removeItem("recorddam-session");
          } else {
            setSession(parsed);
          }
        } catch {
          window.localStorage.removeItem("recorddam-session");
        }
      }
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!session || validatedSession === undefined) return;
    if (validatedSession === null) {
      const timer = window.setTimeout(() => {
        setSession(null);
        setView("records");
        setRecordId(null);
        window.localStorage.removeItem("recorddam-session");
      }, 0);
      return () => window.clearTimeout(timer);
    }
    if (session.expiresAt !== validatedSession.expiresAt) {
      const timer = window.setTimeout(() => {
        const next: Session = {
          token: session.token,
          role: validatedSession.role,
          name: validatedSession.name,
          studentId: validatedSession.studentId,
          expiresAt: validatedSession.expiresAt,
        };
        setSession(next);
        window.localStorage.setItem("recorddam-session", JSON.stringify(next));
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [session, validatedSession]);

  useEffect(() => {
    if (!session?.expiresAt) return;
    const remaining = session.expiresAt - Date.now();
    const expire = () => {
      setSession(null);
      setView("records");
      setRecordId(null);
      window.localStorage.removeItem("recorddam-session");
    };
    if (remaining <= 0) {
      expire();
      return;
    }
    const timer = window.setTimeout(expire, remaining);
    return () => window.clearTimeout(timer);
  }, [session]);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  };

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoginError("");
    setLoggingIn(true);
    try {
      const result = await login({ name: String(form.get("name") ?? "").trim(), code: String(form.get("code") ?? "").trim() });
      if (!result.ok) {
        setLoginError(result.error);
        return;
      }
      const next: Session = { token: result.token, role: result.role, name: result.name, studentId: result.studentId, expiresAt: result.expiresAt };
      setSession(next);
      window.localStorage.setItem("recorddam-session", JSON.stringify(next));
      setView("records");
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "이름 또는 코드를 확인해 주세요.");
    } finally { setLoggingIn(false); }
  };

  const logout = async () => {
    if (session) await logoutMutation({ sessionToken: session.token }).catch(() => undefined);
    setSession(null); setView("records"); setRecordId(null);
    window.localStorage.removeItem("recorddam-session");
  };

  if (!ready) return <main className="loading-screen">기록담을 여는 중입니다…</main>;
  if (!session) return <LoginScreen onSubmit={handleLogin} error={loginError} loading={loggingIn} />;
  if (validatedSession === undefined || validatedSession === null) {
    return <main className="loading-screen">로그인 정보를 확인하는 중입니다…</main>;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand-button" onClick={() => setView("records")} aria-label="기록 목록으로">
          <span className="brand-mark"><BookOpen size={20} /></span>
          <span><b>기록담</b><small>생활기록부 공유 공간</small></span>
        </button>
        <div className="top-actions">
          <button className={`nav-button scratchpad-nav ${view === "scratchpad" ? "active" : ""}`} onClick={() => setView("scratchpad")} aria-label="연습장"><PencilLine size={17} /><span>연습장</span></button>
          {session.role === "teacher" && <button className={`nav-button ${view === "settings" ? "active" : ""}`} onClick={() => setView("settings")}><Settings size={17} /> 교사 설정</button>}
          <span className={`role-chip ${session.role}`}><ShieldCheck size={15} />{session.role === "teacher" ? "교사" : "학생"}</span>
          <span className="user-name">{session.name}</span>
          <button className="icon-button" onClick={logout} aria-label="로그아웃"><LogOut size={18} /></button>
        </div>
      </header>
      {view === "records" && <RecordsView session={session} onOpen={(id) => { setRecordId(id); setView("detail"); }} notify={notify} />}
      {view === "detail" && recordId && <DetailView session={session} recordId={recordId} onBack={() => setView("records")} notify={notify} />}
      {view === "scratchpad" && <ScratchpadView notify={notify} />}
      {view === "settings" && session.role === "teacher" && <SettingsView session={session} notify={notify} onBack={() => setView("records")} />}
      {toast && <div className="toast"><Check size={17} />{toast}</div>}
    </main>
  );
}

function ScratchpadView({ notify }: { notify: (s: string) => void }) {
  const [content, setContent] = useState("");
  const characters = Array.from(content).length;

  return (
    <div className="page-container scratchpad-page">
      <div className="page-heading">
        <div><span className="eyebrow">SCRATCHPAD</span><h1>연습장</h1><p>문장을 자유롭게 다듬고 글자 수와 나이스 바이트를 바로 확인하세요.</p></div>
        <div className="scratchpad-note"><ShieldCheck size={16} /><span><b>저장되지 않아요</b><small>작성 내용은 데이터베이스로 전송되지 않습니다.</small></span></div>
      </div>
      <section className="scratchpad-card">
        <div className="scratchpad-stats">
          <div><span>글자 수</span><strong>{characters.toLocaleString("ko-KR")}</strong><small>자</small></div>
          <div><span>나이스 바이트</span><strong>{neatBytes(content).toLocaleString("ko-KR")}</strong><small>bytes</small></div>
          <div><span>공백 제외</span><strong>{Array.from(content.replace(/\s/g, "")).length.toLocaleString("ko-KR")}</strong><small>자</small></div>
        </div>
        <label className="scratchpad-editor">
          <span>내용</span>
          <textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder="글자 수를 확인할 내용을 입력하세요." autoFocus aria-label="연습장 내용" />
        </label>
        <div className="scratchpad-footer">
          <span>연습장을 닫거나 새로고침하면 작성한 내용이 사라집니다.</span>
          <div>
            <button className="outline-button" onClick={() => setContent("")} disabled={!content}><Trash2 size={16} /> 모두 지우기</button>
            <button className="primary-button" onClick={async () => { await navigator.clipboard.writeText(content); notify("연습장 내용을 복사했습니다."); }} disabled={!content}><Clipboard size={16} /> 내용 복사</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function LoginScreen({ onSubmit, error, loading }: { onSubmit: (e: FormEvent<HTMLFormElement>) => void; error: string; loading: boolean }) {
  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="login-brand"><span className="brand-mark"><BookOpen size={20} /></span><b>기록담</b></div>
        <form className="login-card" onSubmit={onSubmit}>
          <h1>로그인</h1>
          <label>이름<input name="name" autoComplete="name" required placeholder="이름을 입력하세요" /></label>
          <label>입장 코드<input name="code" autoComplete="current-password" required placeholder="영문과 숫자 조합" /></label>
          {error && <div className="form-error">{error}</div>}
          <button className="primary-button login-submit" disabled={loading}>{loading ? "확인 중…" : "로그인"}</button>
        </form>
      </section>
    </main>
  );
}

const EMPTY_FILTERS: Filters = { className: "", number: "", name: "", subject: "", content: "" };

function matchesRecord(record: RecordListRow, filters: Filters, includeContent: boolean) {
  return (!filters.className || String(record.classNumber).includes(filters.className))
    && (!filters.number || String(record.studentNumber).includes(filters.number))
    && (!filters.name || record.studentName.toLowerCase().includes(filters.name.toLowerCase()))
    && (!filters.subject || record.subjectLabel === filters.subject)
    && (!includeContent || !filters.content || String(record.content ?? "").toLowerCase().includes(filters.content.toLowerCase()));
}

function RecordsView({ session, onOpen, notify }: { session: Session; onOpen: (id: string) => void; notify: (s: string) => void }) {
  const convex = useConvex();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [debouncedContent, setDebouncedContent] = useState("");
  const summaries = useQuery(api.records.listSummaries, session.role === "teacher" ? { sessionToken: session.token } : "skip") as RecordListRow[] | undefined;
  const mine = useQuery(api.records.listMine, session.role === "student" ? { sessionToken: session.token } : "skip") as RecordListRow[] | undefined;
  const ensureSummaries = useMutation(api.records.ensureSummaries);
  const summarySyncStarted = useRef(false);

  useEffect(() => {
    if (session.role !== "teacher" || summarySyncStarted.current) return;
    summarySyncStarted.current = true;
    ensureSummaries({ sessionToken: session.token }).catch(() => notify("기록 목록 최적화를 준비하지 못했습니다."));
  }, [ensureSummaries, notify, session.role, session.token]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedContent(filters.content.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [filters.content]);

  const contentSearch = usePaginatedQuery(
    api.records.searchContent,
    session.role === "teacher" && debouncedContent ? { sessionToken: session.token, search: debouncedContent } : "skip",
    { initialNumItems: 30 },
  );
  const teacherSource: RecordListRow[] | undefined = debouncedContent ? contentSearch.results as RecordListRow[] : summaries;
  const records = useMemo<RecordListRow[] | undefined>(() => {
    const source = session.role === "teacher" ? teacherSource : mine;
    if (!source) return undefined;
    return source.filter((record) => matchesRecord(record, filters, session.role === "student"));
  }, [filters, mine, session.role, teacherSource]);
  const subjectOptions = useMemo(() => {
    const source = session.role === "teacher" ? summaries : mine;
    return [...new Set((source ?? []).map((record) => record.subjectLabel).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "ko"));
  }, [mine, session.role, summaries]);
  const searchPending = session.role === "teacher" && filters.content.trim() !== debouncedContent;

  const copy = async (event: MouseEvent, content: string) => {
    event.stopPropagation();
    try {
      await copyToClipboard(content);
      notify("학생 기록을 복사했습니다.");
    } catch {
      notify("복사하지 못했습니다. 브라우저 권한을 확인해 주세요.");
    }
  };

  const exportBySubject = async () => {
    try {
      const rows = session.role === "teacher"
        ? await convex.query(api.admin.exportRecords, { sessionToken: session.token })
        : mine ?? [];
      const filtered: ExportableRecord[] = rows
        .filter((record) => matchesRecord(record, filters, true))
        .map((record) => ({
          classNumber: record.classNumber,
          studentNumber: record.studentNumber,
          studentName: record.studentName,
          subjectLabel: record.subjectLabel,
          content: String(record.content ?? ""),
          updatedAt: record.updatedAt,
        }));
      if (!filtered.length) {
        notify("내보낼 기록이 없습니다.");
        return;
      }
      downloadRecordsBySubject(filtered, `${session.role === "teacher" ? "전체_학생" : session.name}_과목별_생활기록부.xlsx`);
      notify("과목별 Excel 파일을 내보냈습니다.");
    } catch {
      notify("Excel 파일을 만들지 못했습니다.");
    }
  };
  const fields: Array<[keyof Filters, string, string]> = [["className", "반", "예: 1"], ["number", "번호", "예: 12"], ["name", "이름", "학생 이름"]];
  return (
    <div className="page-container">
      <div className="page-heading">
        <div><span className="eyebrow">RECORD LIBRARY</span><h1>{session.role === "teacher" ? "생활기록부 모아보기" : `${session.name}님의 생활기록부`}</h1><p>{session.role === "teacher" ? "목록은 실시간으로 갱신되고 검색은 필요한 범위에서만 처리됩니다." : "과목별로 쌓인 나의 성장 기록을 확인해 보세요."}</p></div>
        <div className="heading-actions">
          <button className="dark-button records-export-button" onClick={exportBySubject} disabled={!records?.length}><FileSpreadsheet size={16} /> 검색 결과를 Excel로 저장</button>
          <div className="count-card"><span>{debouncedContent ? "불러온 검색 결과" : "검색된 기록"}</span><strong>{records?.length ?? 0}</strong><small>건</small></div>
        </div>
      </div>
      <section className="records-card">
        <div className="search-title"><Search size={18} /><b>기록 검색</b><span>{session.role === "teacher" ? "이름·과목은 브라우저에서, 내용은 검색 인덱스에서 찾습니다." : "내 기록 안에서 빠르게 찾아보세요."}</span></div>
        <div className="filter-grid">
          {fields.map(([key, label, placeholder]) => <label key={key}><span>{label}</span><input value={filters[key]} onChange={(e) => setFilters({ ...filters, [key]: e.target.value })} placeholder={placeholder} /></label>)}
          <label><span>과목</span><select value={filters.subject} onChange={(e) => setFilters({ ...filters, subject: e.target.value })} aria-label="과목 선택"><option value="">전체 과목</option>{subjectOptions.map((subject) => <option key={subject} value={subject}>{subject}</option>)}</select></label>
          <label><span>내용</span><input value={filters.content} onChange={(e) => setFilters({ ...filters, content: e.target.value })} placeholder="내용에서 검색" /></label>
          <button className="clear-button" onClick={() => setFilters(EMPTY_FILTERS)}><X size={15} /> 초기화</button>
        </div>
        <div className="table-wrap">
          <table><thead><tr><th>반</th><th>번호</th><th>이름</th><th>과목</th><th>내용</th><th>바이트 수</th><th /></tr></thead>
            <tbody>
              {(!records || searchPending) && <tr><td colSpan={7} className="empty-cell">{searchPending ? "검색어 입력을 기다리는 중입니다…" : "기록을 불러오는 중입니다…"}</td></tr>}
              {!searchPending && records?.length === 0 && <tr><td colSpan={7} className="empty-cell">조건에 맞는 기록이 없습니다.</td></tr>}
              {!searchPending && records?.map((record) => {
                const content = String(record.content ?? "");
                const preview = content || record.contentPreview || (session.role === "teacher" ? "상세 화면에서 내용을 확인하세요." : "아직 작성된 내용이 없습니다.");
                const bytes = typeof record.contentBytes === "number" ? record.contentBytes : neatBytes(content);
                return <tr key={record._id} onClick={() => onOpen(record._id)}>
                  <td>{record.classNumber}</td><td>{record.studentNumber}</td><td><b>{record.studentName}</b></td><td><span className="subject-pill">{record.subjectLabel}</span></td>
                  <td><span className="content-preview">{preview}</span></td><td><b className="byte-number">{bytes}</b> bytes</td>
                  <td>{session.role === "student" ? <button className="copy-button" onClick={(e) => copy(e, content)} disabled={!content} aria-label={`${record.studentName} 학생의 ${record.subjectLabel} 기록 복사`}><Clipboard size={15} /> 복사</button> : <span className="detail-hint">상세 보기</span>}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
        {session.role === "teacher" && debouncedContent && contentSearch.status !== "Exhausted" && <div className="pagination-footer"><button className="outline-button" disabled={contentSearch.status !== "CanLoadMore"} onClick={() => contentSearch.loadMore(30)}>{contentSearch.status === "LoadingMore" ? "불러오는 중…" : "검색 결과 더 보기"}</button></div>}
      </section>
    </div>
  );
}

function DetailView({ session, recordId, onBack, notify }: { session: Session; recordId: string; onBack: () => void; notify: (s: string) => void }) {
  const record = useQuery(api.records.get, { sessionToken: session.token, recordId: recordId as Id<"records"> }) as RecordDetail | undefined;
  const update = useMutation(api.records.update);
  const restore = useMutation(api.records.restore);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [selectedHistory, setSelectedHistory] = useState<HistoryEntry | null>(null);
  const initialized = useRef("");
  useEffect(() => {
    if (record && initialized.current !== record._id + record.updatedAt) {
      setContent(record.content); initialized.current = record._id + record.updatedAt;
    }
  }, [record]);
  if (!record) return <div className="page-container"><button className="back-button" onClick={onBack}><ArrowLeft size={17} /> 목록으로</button><div className="loading-card">기록을 불러오는 중입니다…</div></div>;
  const save = async () => {
    if (session.role !== "teacher") return;
    setSaving(true);
    try { await update({ sessionToken: session.token, recordId: recordId as Id<"records">, content }); notify("수정 내용을 저장했습니다."); } finally { setSaving(false); }
  };
  const doRestore = async (historyId: string) => {
    if (session.role !== "teacher") return;
    await restore({ sessionToken: session.token, historyId: historyId as Id<"histories"> }); notify("선택한 버전으로 되돌렸습니다."); setSelectedHistory(null);
  };
  const copyContent = async () => {
    try {
      await copyToClipboard(content);
      notify("학생 기록을 복사했습니다.");
    } catch {
      notify("복사하지 못했습니다. 브라우저 권한을 확인해 주세요.");
    }
  };
  return (
    <div className="page-container detail-page">
      <button className="back-button" onClick={onBack}><ArrowLeft size={17} /> 기록 목록</button>
      <div className="detail-title">
        <div><span className="subject-pill">{record.subjectLabel}</span><h1>{record.studentName} 학생의 기록</h1><p>{record.classNumber}반 {record.studentNumber}번 · 마지막 수정 {new Date(record.updatedAt).toLocaleString("ko-KR")}</p></div>
        <div className="detail-tools"><div><span>나이스 바이트</span><b>{neatBytes(content)}</b><small> bytes</small></div><button className="copy-button large" onClick={copyContent} disabled={!content} title={content ? "학생 기록 복사" : "복사할 내용이 없습니다."}><Clipboard size={16} /> 기록 복사</button></div>
      </div>
      <div className="detail-grid">
        <section className="editor-card">
          <div className="section-title"><div><BookOpen size={18} /><b>생활기록부 내용</b></div><span>{Array.from(content).length}자</span></div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="생활기록부 내용을 작성해 주세요."
            readOnly={session.role !== "teacher"}
            aria-label={session.role === "teacher" ? "생활기록부 내용 편집" : "생활기록부 내용"}
          />
          <div className="editor-footer">
            <span>{session.role === "teacher" ? "제출할 때마다 수정 이력이 자동으로 남습니다." : "생활기록부는 선생님만 수정할 수 있습니다."}</span>
            {session.role === "teacher" && <button className="primary-button" onClick={save} disabled={saving || content === record.content}>{saving ? "저장 중…" : "수정 내용 제출"}<Check size={17} /></button>}
          </div>
        </section>
        <aside className="history-card">
          <div className="section-title"><div><History size={18} /><b>수정 이력</b></div><button className="text-button" onClick={() => { setShowHistory((value) => !value); setSelectedHistory(null); }}>{showHistory ? "닫기" : "이력 불러오기"}</button></div>
          {showHistory
            ? <HistoryPanel session={session} recordId={recordId} selectedHistory={selectedHistory} onSelect={setSelectedHistory} />
            : <div className="empty-history"><Clock3 size={23} /><p>필요할 때만 이력을 불러와<br />데이터 사용량을 줄입니다.</p></div>}
        </aside>
      </div>
      {selectedHistory && <section className="compare-card">
        <div className="section-title"><div><History size={18} /><b>버전 비교</b></div><button className="icon-button" onClick={() => setSelectedHistory(null)}><X size={18} /></button></div>
        <VersionDiff before={selectedHistory.beforeContent} after={selectedHistory.afterContent} />
        <div className="compare-footer"><span><i className="added">추가 {selectedHistory.addedCount}자</i><i className="removed">삭제 {selectedHistory.removedCount}자</i></span>{session.role === "teacher" && <button className="outline-button" onClick={() => doRestore(selectedHistory._id)}><RotateCcw size={16} /> 이 버전으로 되돌리기</button>}</div>
      </section>}
    </div>
  );
}

function HistoryPanel({ session, recordId, selectedHistory, onSelect }: { session: Session; recordId: string; selectedHistory: HistoryEntry | null; onSelect: (history: HistoryEntry) => void }) {
  const histories = useQuery(api.records.listHistories, { sessionToken: session.token, recordId: recordId as Id<"records"> }) as HistoryEntry[] | undefined;
  return <div className="history-list">
    {!histories && <div className="empty-history"><Clock3 size={23} /><p>수정 이력을 불러오는 중입니다…</p></div>}
    {histories?.length === 0 && <div className="empty-history"><Clock3 size={23} /><p>아직 수정 이력이 없습니다.</p></div>}
    {histories?.map((item, index) => <button key={item._id} className={`history-item ${selectedHistory?._id === item._id ? "selected" : ""}`} onClick={() => onSelect(item)}>
      <span className="history-dot" /><span className="history-main"><b>{index === 0 ? "최근 수정" : `${histories.length - index}번째 수정`}</b><small>{new Date(item.createdAt).toLocaleString("ko-KR")} · {item.actorName}</small><em><i>+ {item.addedCount}자</i><i>- {item.removedCount}자</i></em></span><ChevronRight size={17} />
    </button>)}
  </div>;
}

function VersionDiff({ before, after }: { before: string; after: string }) {
  const parts = characterDiff(before, after);
  const oldCount = before ? before.split("\n").length : 0;
  const newCount = after ? after.split("\n").length : 0;

  return <div className="unified-diff" aria-label="수정 전후 내용 비교">
    <div className="diff-file-header"><span>--- 수정 전</span><span>+++ 수정 후</span></div>
    <div className="diff-hunk">@@ -1,{oldCount} +1,{newCount} @@</div>
    <div className="word-diff-legend"><span className="removed">삭제</span><span className="added">추가</span><small>글자 단위 비교</small></div>
    <code className="word-diff-content">{parts.map((part, index) => part.kind === "same"
      ? <span key={index}>{part.text}</span>
      : part.kind === "removed"
        ? <del key={index}>{part.text}</del>
        : <ins key={index}>{part.text}</ins>)}</code>
    {parts.length === 0 && <div className="diff-empty">변경된 내용이 없습니다.</div>}
  </div>;
}

function SettingsView({ session, notify, onBack }: { session: Session; notify: (s: string) => void; onBack: () => void }) {
  const [tab, setTab] = useState<"students" | "subjects">("students");
  return <div className="page-container settings-page">
    <button className="back-button" onClick={onBack}><ArrowLeft size={17} /> 기록 목록</button>
    <div className="page-heading"><div><span className="eyebrow">TEACHER SETTINGS</span><h1>교사 설정</h1><p>학생 명단과 과목별 생활기록부를 관리하세요.</p></div></div>
    <div className="subtabs"><button className={tab === "students" ? "active" : ""} onClick={() => setTab("students")}><Users size={17} /> 학생 명단</button><button className={tab === "subjects" ? "active" : ""} onClick={() => setTab("subjects")}><BookOpen size={17} /> 과목 설정</button></div>
    {tab === "students" ? <StudentsSettings session={session} notify={notify} /> : <SubjectsSettings session={session} notify={notify} />}
  </div>;
}

function StudentsSettings({ session, notify }: { session: Session; notify: (s: string) => void }) {
  const students = useQuery(api.admin.listStudents, { sessionToken: session.token }) as StudentAdminRow[] | undefined;
  const upsert = useMutation(api.admin.upsertStudent);
  const remove = useMutation(api.admin.removeStudent);
  const bulk = useMutation(api.admin.importStudents);
  const [editing, setEditing] = useState<StudentAdminRow | null>(null);
  const [formKey, setFormKey] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const data = new FormData(e.currentTarget);
    await upsert({ sessionToken: session.token, studentId: editing?._id, classNumber: Number(data.get("classNumber")), studentNumber: Number(data.get("studentNumber")), name: String(data.get("name")), code: String(data.get("code") || "") });
    setEditing(null); setFormKey((v) => v + 1); notify("학생 정보를 저장했습니다.");
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    const workbook = XLSX.read(await file.arrayBuffer());
    const rows = XLSX.utils.sheet_to_json<SheetRow>(workbook.Sheets[workbook.SheetNames[0]]);
    await bulk({ sessionToken: session.token, students: rows.map((r) => ({ classNumber: Number(r["반"]), studentNumber: Number(r["번호"]), name: String(r["이름"] ?? ""), code: String(r["코드"] ?? "") })) });
    notify(`${rows.length}명의 명단을 불러왔습니다.`);
  };
  return <section className="settings-card">
    <div className="settings-toolbar"><div><h2>학생 명단</h2><p>학생의 이름과 입장 코드를 관리합니다.</p></div><div>
      <input ref={fileRef} hidden type="file" accept=".xlsx,.xls" onChange={(e) => importFile(e.target.files?.[0])} />
      <button className="outline-button" onClick={() => fileRef.current?.click()}><Upload size={16} /> 엑셀 불러오기</button>
      <button className="outline-button" onClick={() => downloadWorkbook([{ 반: 1, 번호: 1, 이름: "홍길동", 코드: "ABC123" }], "학생명단_샘플.xlsx", "학생명단", ["반", "번호", "이름", "코드"])}><FileDown size={16} /> 샘플</button>
      <button className="dark-button" onClick={() => downloadWorkbook((students ?? []).map((s) => ({ 반: s.classNumber, 번호: s.studentNumber, 이름: s.name, 코드: "" })), "학생명단.xlsx", "학생명단", ["반", "번호", "이름", "코드"])}><Download size={16} /> 내보내기</button>
    </div></div>
    <form key={`${formKey}-${editing?._id ?? "new"}`} className="inline-form" onSubmit={submit}>
      <label>반<input name="classNumber" type="number" min="1" required defaultValue={editing?.classNumber} /></label>
      <label>번호<input name="studentNumber" type="number" min="1" required defaultValue={editing?.studentNumber} /></label>
      <label>이름<input name="name" required defaultValue={editing?.name} /></label>
      <label>입장 코드<input name="code" required={!editing} placeholder={editing ? "변경할 때만 입력" : "영문+숫자"} /></label>
      <button className="primary-button">{editing ? "수정 저장" : "학생 추가"}<Plus size={16} /></button>{editing && <button type="button" className="clear-button" onClick={() => setEditing(null)}>취소</button>}
    </form>
    <div className="table-wrap"><table><thead><tr><th>반</th><th>번호</th><th>이름</th><th>코드</th><th /></tr></thead><tbody>
      {students?.map((s) => <tr key={s._id}><td>{s.classNumber}</td><td>{s.studentNumber}</td><td><b>{s.name}</b></td><td>••••••</td><td className="row-actions"><button className="text-button" onClick={() => setEditing(s)}>수정</button><button className="danger-button" onClick={async () => { if (confirm(`${s.name} 학생과 관련 기록을 삭제할까요?`)) { await remove({ sessionToken: session.token, studentId: s._id }); notify("학생을 삭제했습니다."); } }}><Trash2 size={15} /> 삭제</button></td></tr>)}
    </tbody></table></div>
  </section>;
}

function SubjectsSettings({ session, notify }: { session: Session; notify: (s: string) => void }) {
  const convex = useConvex();
  const subjects = useQuery(api.admin.listSubjects, { sessionToken: session.token }) as SubjectAdminRow[] | undefined;
  const addSubject = useMutation(api.admin.upsertSubject);
  const removeSubject = useMutation(api.admin.removeSubject);
  const importRecords = useMutation(api.admin.importRecords);
  const [label, setLabel] = useState("");
  const [selected, setSelected] = useState("");
  const [exporting, setExporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const selectedSubjectId = selected || subjects?.[0]?._id || "";
  const selectedSubject = subjects?.find((s) => s._id === selectedSubjectId);
  const importFile = async (file?: File) => {
    if (!file || !selectedSubjectId) return;
    const workbook = XLSX.read(await file.arrayBuffer());
    const rows = XLSX.utils.sheet_to_json<SheetRow>(workbook.Sheets[workbook.SheetNames[0]]);
    await importRecords({ sessionToken: session.token, subjectId: selectedSubjectId as Id<"subjects">, records: rows.map((r) => ({ classNumber: Number(r["반"]), studentNumber: Number(r["번호"]), name: String(r["이름"] ?? ""), content: String(r["내용"] ?? "") })) });
    notify(`${rows.length}건의 기록을 불러왔습니다.`);
  };
  return <section className="settings-card">
    <div className="settings-toolbar"><div><h2>과목 설정</h2><p>과목을 관리하고 과목별 생활기록부를 엑셀로 옮깁니다.</p></div></div>
    <form className="subject-add" onSubmit={async (e) => { e.preventDefault(); await addSubject({ sessionToken: session.token, label }); setLabel(""); notify("과목을 추가했습니다."); }}><label>새 과목<input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="예: 국어" required /></label><button className="primary-button"><Plus size={16} /> 과목 추가</button></form>
    <div className="subject-list">{subjects?.map((subject) => <SubjectRow key={subject._id} subject={subject} session={session} onRemove={async () => { try { await removeSubject({ sessionToken: session.token, subjectId: subject._id }); notify("과목을 삭제했습니다."); } catch (e) { notify(e instanceof Error ? e.message : "기록이 있는 과목은 삭제할 수 없습니다."); } }} notify={notify} />)}</div>
    <div className="excel-zone">
      <div><FileSpreadsheet size={23} /><span><b>과목별 기록 엑셀 관리</b><small>선택한 과목의 기록만 불러오거나 내보냅니다.</small></span></div>
      <select value={selectedSubjectId} onChange={(e) => setSelected(e.target.value)} aria-label="과목 선택">{subjects?.map((s) => <option key={s._id} value={s._id}>{s.label}</option>)}</select>
      <input ref={fileRef} hidden type="file" accept=".xlsx,.xls" onChange={(e) => importFile(e.target.files?.[0])} />
      <button className="outline-button" disabled={!selectedSubjectId} onClick={() => fileRef.current?.click()}><Upload size={16} /> 불러오기</button>
      <button className="outline-button" onClick={() => downloadWorkbook([{ 반: 1, 번호: 1, 이름: "홍길동", 내용: "생활기록부 내용을 입력하세요." }], "생활기록부_샘플.xlsx", "생활기록부", ["반", "번호", "이름", "내용"])}><FileDown size={16} /> 샘플</button>
      <button className="dark-button" disabled={!selectedSubjectId || exporting} onClick={async () => {
        setExporting(true);
        try {
          const exportRows = await convex.query(api.admin.exportRecords, { sessionToken: session.token });
          const rows = exportRows.filter((r) => r.subjectId === selectedSubjectId).map((r) => toRecordExportRow({
            classNumber: r.classNumber,
            studentNumber: r.studentNumber,
            studentName: r.studentName,
            subjectLabel: selectedSubject?.label ?? "",
            content: r.content,
            updatedAt: r.updatedAt,
          }));
          downloadWorkbook(rows, `${selectedSubject?.label ?? "과목"}_생활기록부.xlsx`, selectedSubject?.label ?? "생활기록부", RECORD_EXPORT_HEADERS);
          notify(`${selectedSubject?.label ?? "선택한 과목"} 기록을 Excel로 내보냈습니다.`);
        } finally {
          setExporting(false);
        }
      }}><Download size={16} /> {exporting ? "내보내는 중…" : "내보내기"}</button>
    </div>
  </section>;
}

function SubjectRow({ subject, session, onRemove, notify }: { subject: SubjectAdminRow; session: Session; onRemove: () => void; notify: (s: string) => void }) {
  const upsert = useMutation(api.admin.upsertSubject);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(subject.label);
  return <div className="subject-row"><span className="subject-icon"><BookOpen size={18} /></span>{editing ? <input value={label} onChange={(e) => setLabel(e.target.value)} /> : <b>{subject.label}</b>}<span>{subject.recordCount}건의 기록</span><div>{editing ? <><button className="text-button" onClick={async () => { await upsert({ sessionToken: session.token, subjectId: subject._id, label }); setEditing(false); notify("과목명을 수정했습니다."); }}>저장</button><button className="text-button" onClick={() => { setLabel(subject.label); setEditing(false); }}>취소</button></> : <button className="text-button" onClick={() => setEditing(true)}>label 수정</button>}<button className="danger-button" onClick={onRemove} disabled={subject.recordCount > 0} title={subject.recordCount > 0 ? "생활기록부가 있어 삭제할 수 없습니다." : "과목 삭제"}><Trash2 size={15} /> 삭제</button></div></div>;
}
