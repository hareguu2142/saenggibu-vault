"use client";

import {
  ArrowLeft, BookOpen, Check, ChevronRight, Clipboard, Clock3, Download,
  FileDown, FileSpreadsheet, History, LogOut, Plus, RotateCcw, Search,
  Settings, ShieldCheck, Trash2, Upload, Users, X,
} from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { FormEvent, MouseEvent, useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";

type Session = { token: string; role: "student" | "teacher"; name: string; studentId?: string; expiresAt?: number };
type View = "records" | "detail" | "settings";
type Filters = { className: string; number: string; name: string; subject: string; content: string };

const neatBytes = (text: string) => {
  const chars = Array.from(text).length;
  let lenB = 0;
  for (const ch of text) lenB += (ch.codePointAt(0) ?? 0) <= 0x7f ? 1 : 2;
  return 2 * lenB - chars;
};

const downloadWorkbook = (rows: Record<string, unknown>[], fileName: string, sheetName: string) => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), sheetName);
  XLSX.writeFile(workbook, fileName);
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
      const next = result as Session;
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
          {session.role === "teacher" && <button className={`nav-button ${view === "settings" ? "active" : ""}`} onClick={() => setView("settings")}><Settings size={17} /> 교사 설정</button>}
          <span className={`role-chip ${session.role}`}><ShieldCheck size={15} />{session.role === "teacher" ? "교사" : "학생"}</span>
          <span className="user-name">{session.name}</span>
          <button className="icon-button" onClick={logout} aria-label="로그아웃"><LogOut size={18} /></button>
        </div>
      </header>
      {view === "records" && <RecordsView session={session} onOpen={(id) => { setRecordId(id); setView("detail"); }} notify={notify} />}
      {view === "detail" && recordId && <DetailView session={session} recordId={recordId} onBack={() => setView("records")} notify={notify} />}
      {view === "settings" && session.role === "teacher" && <SettingsView session={session} notify={notify} onBack={() => setView("records")} />}
      {toast && <div className="toast"><Check size={17} />{toast}</div>}
    </main>
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

function RecordsView({ session, onOpen, notify }: { session: Session; onOpen: (id: string) => void; notify: (s: string) => void }) {
  const empty: Filters = { className: "", number: "", name: "", subject: "", content: "" };
  const [filters, setFilters] = useState<Filters>(empty);
  const records = useQuery(api.records.list, { sessionToken: session.token, filters }) as any[] | undefined;
  const copy = async (event: MouseEvent, content: string) => { event.stopPropagation(); await navigator.clipboard.writeText(content); notify("내용을 복사했습니다."); };
  const fields: Array<[keyof Filters, string, string]> = [["className", "반", "예: 1"], ["number", "번호", "예: 12"], ["name", "이름", "학생 이름"], ["subject", "과목", "과목명"], ["content", "내용", "내용에서 검색"]];
  return (
    <div className="page-container">
      <div className="page-heading">
        <div><span className="eyebrow">RECORD LIBRARY</span><h1>{session.role === "teacher" ? "생활기록부 모아보기" : `${session.name}님의 생활기록부`}</h1><p>{session.role === "teacher" ? "학생들의 소중한 기록을 한눈에 확인하고 관리하세요." : "과목별로 쌓인 나의 성장 기록을 확인해 보세요."}</p></div>
        <div className="count-card"><span>전체 기록</span><strong>{records?.length ?? 0}</strong><small>건</small></div>
      </div>
      <section className="records-card">
        <div className="search-title"><Search size={18} /><b>기록 검색</b><span>원하는 항목을 빠르게 찾아보세요.</span></div>
        <div className="filter-grid">
          {fields.map(([key, label, placeholder]) => <label key={key}><span>{label}</span><input value={filters[key]} onChange={(e) => setFilters({ ...filters, [key]: e.target.value })} placeholder={placeholder} /></label>)}
          <button className="clear-button" onClick={() => setFilters(empty)}><X size={15} /> 초기화</button>
        </div>
        <div className="table-wrap">
          <table><thead><tr><th>반</th><th>번호</th><th>이름</th><th>과목</th><th>내용</th><th>바이트 수</th><th /></tr></thead>
            <tbody>
              {!records && <tr><td colSpan={7} className="empty-cell">기록을 불러오는 중입니다…</td></tr>}
              {records?.length === 0 && <tr><td colSpan={7} className="empty-cell">조건에 맞는 기록이 없습니다.</td></tr>}
              {records?.map((record) => <tr key={record._id} onClick={() => onOpen(record._id)}>
                <td>{record.classNumber}</td><td>{record.studentNumber}</td><td><b>{record.studentName}</b></td><td><span className="subject-pill">{record.subjectLabel}</span></td>
                <td><span className="content-preview">{record.content || "아직 작성된 내용이 없습니다."}</span></td><td><b className="byte-number">{neatBytes(record.content)}</b> bytes</td>
                <td><button className="copy-button" onClick={(e) => copy(e, record.content)}><Clipboard size={15} /> 복사</button></td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function DetailView({ session, recordId, onBack, notify }: { session: Session; recordId: string; onBack: () => void; notify: (s: string) => void }) {
  const record = useQuery(api.records.get, { sessionToken: session.token, recordId: recordId as any }) as any;
  const update = useMutation(api.records.update);
  const restore = useMutation(api.records.restore);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [selectedHistory, setSelectedHistory] = useState<any>(null);
  const initialized = useRef("");
  useEffect(() => {
    if (record && initialized.current !== record._id + record.updatedAt) {
      setContent(record.content); initialized.current = record._id + record.updatedAt;
    }
  }, [record]);
  if (!record) return <div className="page-container"><button className="back-button" onClick={onBack}><ArrowLeft size={17} /> 목록으로</button><div className="loading-card">기록을 불러오는 중입니다…</div></div>;
  const save = async () => {
    setSaving(true);
    try { await update({ sessionToken: session.token, recordId: recordId as any, content }); notify("수정 내용을 저장했습니다."); } finally { setSaving(false); }
  };
  const doRestore = async (historyId: string) => {
    await restore({ sessionToken: session.token, historyId: historyId as any }); notify("선택한 버전으로 되돌렸습니다."); setSelectedHistory(null);
  };
  return (
    <div className="page-container detail-page">
      <button className="back-button" onClick={onBack}><ArrowLeft size={17} /> 기록 목록</button>
      <div className="detail-title">
        <div><span className="subject-pill">{record.subjectLabel}</span><h1>{record.studentName} 학생의 기록</h1><p>{record.classNumber}반 {record.studentNumber}번 · 마지막 수정 {new Date(record.updatedAt).toLocaleString("ko-KR")}</p></div>
        <div className="detail-tools"><div><span>나이스 바이트</span><b>{neatBytes(content)}</b><small> bytes</small></div><button className="copy-button large" onClick={async () => { await navigator.clipboard.writeText(content); notify("내용을 복사했습니다."); }}><Clipboard size={16} /> 내용 복사</button></div>
      </div>
      <div className="detail-grid">
        <section className="editor-card">
          <div className="section-title"><div><BookOpen size={18} /><b>생활기록부 내용</b></div><span>{Array.from(content).length}자</span></div>
          <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="생활기록부 내용을 작성해 주세요." />
          <div className="editor-footer"><span>제출할 때마다 수정 이력이 자동으로 남습니다.</span><button className="primary-button" onClick={save} disabled={saving || content === record.content}>{saving ? "저장 중…" : "수정 내용 제출"}<Check size={17} /></button></div>
        </section>
        <aside className="history-card">
          <div className="section-title"><div><History size={18} /><b>수정 이력</b></div><span>{record.histories.length}개</span></div>
          <div className="history-list">
            {record.histories.length === 0 && <div className="empty-history"><Clock3 size={23} /><p>아직 수정 이력이 없습니다.</p></div>}
            {record.histories.map((item: any, index: number) => <button key={item._id} className={`history-item ${selectedHistory?._id === item._id ? "selected" : ""}`} onClick={() => setSelectedHistory(item)}>
              <span className="history-dot" /><span className="history-main"><b>{index === 0 ? "최근 수정" : `${record.histories.length - index}번째 수정`}</b><small>{new Date(item.createdAt).toLocaleString("ko-KR")} · {item.actorName}</small><em><i>+ {item.addedCount}자</i><i>- {item.removedCount}자</i></em></span><ChevronRight size={17} />
            </button>)}
          </div>
        </aside>
      </div>
      {selectedHistory && <section className="compare-card">
        <div className="section-title"><div><History size={18} /><b>버전 비교</b></div><button className="icon-button" onClick={() => setSelectedHistory(null)}><X size={18} /></button></div>
        <div className="diff-grid"><div><span className="diff-label removed">수정 전</span><pre>{selectedHistory.beforeContent || "(내용 없음)"}</pre></div><div><span className="diff-label added">수정 후</span><pre>{selectedHistory.afterContent || "(내용 없음)"}</pre></div></div>
        <div className="compare-footer"><span><i className="added">추가 {selectedHistory.addedCount}자</i><i className="removed">삭제 {selectedHistory.removedCount}자</i></span><button className="outline-button" onClick={() => doRestore(selectedHistory._id)}><RotateCcw size={16} /> 이 버전으로 되돌리기</button></div>
      </section>}
    </div>
  );
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
  const students = useQuery(api.admin.listStudents, { sessionToken: session.token }) as any[] | undefined;
  const upsert = useMutation(api.admin.upsertStudent);
  const remove = useMutation(api.admin.removeStudent);
  const bulk = useMutation(api.admin.importStudents);
  const [editing, setEditing] = useState<any>(null);
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
    const rows = XLSX.utils.sheet_to_json<any>(workbook.Sheets[workbook.SheetNames[0]]);
    await bulk({ sessionToken: session.token, students: rows.map((r) => ({ classNumber: Number(r["반"]), studentNumber: Number(r["번호"]), name: String(r["이름"] ?? ""), code: String(r["코드"] ?? "") })) });
    notify(`${rows.length}명의 명단을 불러왔습니다.`);
  };
  return <section className="settings-card">
    <div className="settings-toolbar"><div><h2>학생 명단</h2><p>학생의 이름과 입장 코드를 관리합니다.</p></div><div>
      <input ref={fileRef} hidden type="file" accept=".xlsx,.xls" onChange={(e) => importFile(e.target.files?.[0])} />
      <button className="outline-button" onClick={() => fileRef.current?.click()}><Upload size={16} /> 엑셀 불러오기</button>
      <button className="outline-button" onClick={() => downloadWorkbook([{ 반: 1, 번호: 1, 이름: "홍길동", 코드: "ABC123" }], "학생명단_샘플.xlsx", "학생명단")}><FileDown size={16} /> 샘플</button>
      <button className="dark-button" onClick={() => downloadWorkbook((students ?? []).map((s) => ({ 반: s.classNumber, 번호: s.studentNumber, 이름: s.name, 코드: "" })), "학생명단.xlsx", "학생명단")}><Download size={16} /> 내보내기</button>
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
  const subjects = useQuery(api.admin.listSubjects, { sessionToken: session.token }) as any[] | undefined;
  const addSubject = useMutation(api.admin.upsertSubject);
  const removeSubject = useMutation(api.admin.removeSubject);
  const importRecords = useMutation(api.admin.importRecords);
  const exportRows = useQuery(api.admin.exportRecords, { sessionToken: session.token }) as any[] | undefined;
  const [label, setLabel] = useState("");
  const [selected, setSelected] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!selected && subjects?.[0]) setSelected(subjects[0]._id); }, [subjects, selected]);
  const selectedSubject = subjects?.find((s) => s._id === selected);
  const importFile = async (file?: File) => {
    if (!file || !selected) return;
    const workbook = XLSX.read(await file.arrayBuffer());
    const rows = XLSX.utils.sheet_to_json<any>(workbook.Sheets[workbook.SheetNames[0]]);
    await importRecords({ sessionToken: session.token, subjectId: selected as any, records: rows.map((r) => ({ classNumber: Number(r["반"]), studentNumber: Number(r["번호"]), name: String(r["이름"] ?? ""), content: String(r["내용"] ?? "") })) });
    notify(`${rows.length}건의 기록을 불러왔습니다.`);
  };
  return <section className="settings-card">
    <div className="settings-toolbar"><div><h2>과목 설정</h2><p>과목을 관리하고 과목별 생활기록부를 엑셀로 옮깁니다.</p></div></div>
    <form className="subject-add" onSubmit={async (e) => { e.preventDefault(); await addSubject({ sessionToken: session.token, label }); setLabel(""); notify("과목을 추가했습니다."); }}><label>새 과목<input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="예: 국어" required /></label><button className="primary-button"><Plus size={16} /> 과목 추가</button></form>
    <div className="subject-list">{subjects?.map((subject) => <SubjectRow key={subject._id} subject={subject} session={session} onRemove={async () => { try { await removeSubject({ sessionToken: session.token, subjectId: subject._id }); notify("과목을 삭제했습니다."); } catch (e) { notify(e instanceof Error ? e.message : "기록이 있는 과목은 삭제할 수 없습니다."); } }} notify={notify} />)}</div>
    <div className="excel-zone">
      <div><FileSpreadsheet size={23} /><span><b>과목별 기록 엑셀 관리</b><small>선택한 과목의 기록만 불러오거나 내보냅니다.</small></span></div>
      <select value={selected} onChange={(e) => setSelected(e.target.value)} aria-label="과목 선택">{subjects?.map((s) => <option key={s._id} value={s._id}>{s.label}</option>)}</select>
      <input ref={fileRef} hidden type="file" accept=".xlsx,.xls" onChange={(e) => importFile(e.target.files?.[0])} />
      <button className="outline-button" disabled={!selected} onClick={() => fileRef.current?.click()}><Upload size={16} /> 불러오기</button>
      <button className="outline-button" onClick={() => downloadWorkbook([{ 반: 1, 번호: 1, 이름: "홍길동", 내용: "생활기록부 내용을 입력하세요." }], "생활기록부_샘플.xlsx", "생활기록부")}><FileDown size={16} /> 샘플</button>
      <button className="dark-button" disabled={!selected} onClick={() => downloadWorkbook((exportRows ?? []).filter((r) => r.subjectId === selected).map((r) => ({ 반: r.classNumber, 번호: r.studentNumber, 이름: r.studentName, 내용: r.content })), `${selectedSubject?.label ?? "과목"}_생활기록부.xlsx`, selectedSubject?.label ?? "생활기록부")}><Download size={16} /> 내보내기</button>
    </div>
  </section>;
}

function SubjectRow({ subject, session, onRemove, notify }: { subject: any; session: Session; onRemove: () => void; notify: (s: string) => void }) {
  const upsert = useMutation(api.admin.upsertSubject);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(subject.label);
  return <div className="subject-row"><span className="subject-icon"><BookOpen size={18} /></span>{editing ? <input value={label} onChange={(e) => setLabel(e.target.value)} /> : <b>{subject.label}</b>}<span>{subject.recordCount}건의 기록</span><div>{editing ? <><button className="text-button" onClick={async () => { await upsert({ sessionToken: session.token, subjectId: subject._id, label }); setEditing(false); notify("과목명을 수정했습니다."); }}>저장</button><button className="text-button" onClick={() => { setLabel(subject.label); setEditing(false); }}>취소</button></> : <button className="text-button" onClick={() => setEditing(true)}>label 수정</button>}<button className="danger-button" onClick={onRemove} disabled={subject.recordCount > 0} title={subject.recordCount > 0 ? "생활기록부가 있어 삭제할 수 없습니다." : "과목 삭제"}><Trash2 size={15} /> 삭제</button></div></div>;
}
