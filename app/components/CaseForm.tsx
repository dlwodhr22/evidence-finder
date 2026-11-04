"use client";
// PLAN 작업 9: ① 사안 입력 화면.
// Design Ref: §3.3 ① — 입력 칸 4개(사안 내용·쟁점·관련 분야·관련 지자체(선택)), 개인정보 안내, 근거 찾기 버튼,
//                     개인정보가 가려졌으면 "일부를 가렸습니다"를 알려준다.
// 개인정보는 보내기 전에 이 화면에서 먼저 가린다. 원래 글은 이 브라우저 밖으로 나가지 않는다.
import { useId, useMemo, useState } from "react";
import {
  CASE_LABELS,
  CASE_LIMITS,
  maskCaseInput,
  validateCaseInput,
  type CaseField,
  type CaseInput,
  type CaseInputErrors,
} from "../lib/case-input";
import { describeFindings, maskPii, PII_NOTICE } from "../lib/pii";
import type { SearchResponse, SearchResults } from "../lib/search";

const EMPTY: CaseInput = { facts: "", issue: "", field: "", localGov: "" };

// 결과 요약에 쓸 자료 종류 이름
const RESULT_LABELS: Record<keyof SearchResults, string> = {
  statutes: "법령",
  ordinances: "조례·규칙",
  cases: "판례·헌재 결정",
  interpretations: "법령해석례",
  tribunals: "행정심판례",
};

type SearchState =
  | { status: "idle" }
  | { status: "loading"; piiNotice: string }
  | { status: "done"; piiNotice: string; data: SearchResponse }
  | { status: "error"; message: string };

// 칸별 안내 문구와 예시
const FIELD_INFO: Record<CaseField, { placeholder: string; hint?: string; required: boolean; rows?: number }> = {
  facts: {
    placeholder:
      "예: 국유지인 도로 부지 일부를 10년 넘게 창고 앞마당으로 써 온 민원인에게 변상금을 부과했습니다. 민원인은 예전부터 써 왔고 허가가 필요한 줄 몰랐다며 이의를 제기했습니다.",
    hint: "언제, 무엇을, 왜 다투는지 적어 주세요. 이름·주소 대신 '민원인', '해당 토지'처럼 적어 주세요.",
    required: true,
    rows: 6,
  },
  issue: {
    placeholder: "예: 오래 써 온 경우에도 변상금 부과가 정당한지, 감면할 수 있는지",
    required: true,
    rows: 2,
  },
  field: { placeholder: "예: 국유재산 관리", required: false },
  localGov: {
    placeholder: "예: 순천시",
    hint: "적으면 그 지역 조례를 먼저 찾습니다. 비워 두면 전국에서 찾습니다.",
    required: false,
  },
};

const FIELDS: CaseField[] = ["facts", "issue", "field", "localGov"];

export default function CaseForm() {
  const idPrefix = useId();
  const [values, setValues] = useState<CaseInput>(EMPTY);
  const [errors, setErrors] = useState<CaseInputErrors>({});
  const [search, setSearch] = useState<SearchState>({ status: "idle" });

  // 칸마다 지금 적힌 글에서 가려질 개인정보 안내(적는 동안 바로 보여준다)
  const liveNotices = useMemo(() => {
    const notices: Partial<Record<CaseField, string>> = {};
    for (const field of FIELDS) {
      const { findings } = maskPii(values[field]);
      if (findings.length > 0) {
        notices[field] = `${findings.map((f) => `${f.label} ${f.count}건`).join(", ")}이(가) 가려진 채로 전달됩니다.`;
      }
    }
    return notices;
  }, [values]);

  function update(field: CaseField, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (search.status === "loading") return;
    const checked = validateCaseInput(values);
    if (!checked.ok) {
      setErrors(checked.errors);
      setSearch({ status: "idle" });
      return;
    }
    // 보내기 전에 화면에서 개인정보를 먼저 가린다. 가린 내용만 서버로 보낸다.
    const { masked, findings } = maskCaseInput(checked.data);
    const piiNotice = describeFindings(findings);
    setErrors({});
    setSearch({ status: "loading", piiNotice });

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(masked),
      });
      const json: unknown = await res.json();
      if (!res.ok || typeof json !== "object" || json === null || !("data" in json)) {
        const message =
          typeof json === "object" && json !== null && "error" in json
            ? String((json as { error: { message?: string } }).error.message ?? "")
            : "";
        setSearch({ status: "error", message: message || "근거를 찾지 못했습니다. 잠시 뒤 다시 시도해 주세요." });
        return;
      }
      setSearch({ status: "done", piiNotice, data: (json as { data: SearchResponse }).data });
    } catch {
      setSearch({ status: "error", message: "서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요." });
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      {/* 개인정보 안내(늘 보임) */}
      <p
        role="note"
        className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
      >
        ⚠ {PII_NOTICE}
      </p>

      {FIELDS.map((field) => {
        const info = FIELD_INFO[field];
        const id = `${idPrefix}-${field}`;
        const limit = CASE_LIMITS[field].max;
        const error = errors[field];
        const describedBy = [info.hint ? `${id}-hint` : "", error ? `${id}-error` : "", liveNotices[field] ? `${id}-pii` : ""]
          .filter(Boolean)
          .join(" ");
        const inputClass =
          "w-full rounded-md border px-3 py-2 text-base outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-zinc-900 " +
          (error ? "border-red-500" : "border-black/20 dark:border-white/25");

        return (
          <div key={field} className="flex flex-col gap-1">
            <label htmlFor={id} className="font-medium">
              {CASE_LABELS[field]}
              {info.required ? (
                <span className="ml-1 text-red-600" aria-hidden="true">*</span>
              ) : (
                <span className="ml-1 text-sm font-normal text-zinc-500">(선택)</span>
              )}
            </label>
            {info.rows ? (
              <textarea
                id={id}
                rows={info.rows}
                maxLength={limit}
                value={values[field]}
                placeholder={info.placeholder}
                required={info.required}
                aria-invalid={Boolean(error)}
                aria-describedby={describedBy || undefined}
                onChange={(e) => update(field, e.target.value)}
                className={inputClass}
              />
            ) : (
              <input
                id={id}
                type="text"
                maxLength={limit}
                value={values[field]}
                placeholder={info.placeholder}
                aria-invalid={Boolean(error)}
                aria-describedby={describedBy || undefined}
                onChange={(e) => update(field, e.target.value)}
                className={inputClass}
              />
            )}
            <div className="flex justify-between gap-2 text-xs text-zinc-500">
              <span id={`${id}-hint`}>{info.hint ?? ""}</span>
              <span aria-hidden="true">
                {values[field].length}/{limit}
              </span>
            </div>
            {liveNotices[field] && (
              <p id={`${id}-pii`} className="text-xs text-amber-700 dark:text-amber-300">
                개인정보로 보이는 부분이 있습니다: {liveNotices[field]}
              </p>
            )}
            {error && (
              <p id={`${id}-error`} role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}
          </div>
        );
      })}

      <button
        type="submit"
        disabled={search.status === "loading"}
        aria-busy={search.status === "loading"}
        className="self-start rounded-md bg-blue-700 px-5 py-2.5 font-semibold text-white hover:bg-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-wait disabled:bg-zinc-400"
      >
        {search.status === "loading" ? "근거를 찾는 중…" : "근거 찾기"}
      </button>

      <div aria-live="polite">
        {search.status === "loading" && (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            법제처에서 법령·판례·해석례·행정심판례를 찾고 있습니다. 10~30초쯤 걸릴 수 있습니다.
          </p>
        )}

        {search.status === "error" && (
          <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {search.message}
          </p>
        )}

        {search.status === "done" && (
          <section className="rounded-md border border-black/10 bg-zinc-50 p-4 text-sm dark:border-white/15 dark:bg-zinc-900">
            <h3 className="font-semibold">찾은 결과 요약</h3>
            {search.piiNotice && <p className="mt-1 text-amber-700 dark:text-amber-300">{search.piiNotice}</p>}
            {search.data.notices.map((n) => (
              <p key={n} className="mt-1 text-amber-700 dark:text-amber-300">
                {n}
              </p>
            ))}

            <p className="mt-2">
              <span className="text-zinc-500">찾은 검색어{search.data.terms.source === "fallback" ? "(입력 내용에서)" : "(AI가 뽑음)"}: </span>
              {[...search.data.terms.lawNames, ...search.data.terms.keywords].join(", ") || "없음"}
            </p>

            {search.data.foundNothing ? (
              <p className="mt-2 font-medium">
                법제처에서 확인된 자료를 찾지 못했습니다. 사안을 조금 더 구체적으로 적거나 쟁점을 바꿔 다시 찾아 보세요.
              </p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1">
                {(Object.keys(RESULT_LABELS) as (keyof SearchResults)[]).map((kind) => (
                  <li key={kind}>
                    {RESULT_LABELS[kind]} <strong>{search.data.results[kind].length}건</strong>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-zinc-500">
              모두 법제처 검색 결과에서 나온 자료입니다. 자료 목록 화면은 PLAN 작업 13번에서 만듭니다.
            </p>
          </section>
        )}
      </div>
    </form>
  );
}
