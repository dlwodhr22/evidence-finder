// PLAN 작업 11: 웹검색으로 관련 사례의 "단서"만 뽑는다.
// 단서 = 사건번호·법원·선고일(판례), 안건번호·회신일(해석례), 사건번호·재결일(행정심판례), 법령명·조문.
//
// PRD 5번 A — 웹검색은 단서를 찾는 용도로만 쓴다. 웹 문장·요약은 화면에 쓰지 않는다.
//            단서는 작업 12번에서 법제처에 다시 조회해, 일치하는 것만 화면에 올린다.
// PRD 5번 A(예외) — 부처 질의회신·유권해석은 법제처에서 검증할 수 없으므로 "참고, 검증 안 됨"으로
//            제목과 링크만 보여준다.
// 문서 검토 7번 — 질의회신 링크는 AI가 실제로 검색한 페이지 주소만, 정부 사이트(go.kr 등)만 쓴다.
//            제목도 검색 기록에 있는 제목만 쓰고, 없으면 사이트 이름으로 대신한다(AI가 쓴 제목은 쓰지 않음).
//
// 이 파일은 서버 전용이다.
import { z } from "zod";
import { askAiJsonWithWebSearch, type WebSource } from "./ai";
import type { CaseInput } from "./case-input";
import { normalizeCaseNumber, normalizeDate } from "./cases";
import { parseArticleLabel } from "./laws";

/** 단서가 가리키는 자료 종류 */
export type ClueKind = "prec" | "detc" | "expc" | "decc" | "law";

/** 웹에서 찾은 단서 한 건(아직 확인되지 않음) */
export interface WebClue {
  kind: ClueKind;
  caseNumber: string; // 사건번호·안건번호(법령이면 빈 글)
  court: string; // 법원(판례일 때만)
  decisionDate: string; // 선고일·회신일·재결일 YYYY-MM-DD(법령이면 빈 글)
  lawName: string; // 법령명(법령일 때만)
  article: string; // 조문(예: 제72조, 법령일 때만)
}

/** 법제처에서 검증할 수 없는 부처 질의회신 — 제목과 링크만 */
export interface ReferenceLink {
  title: string; // 검색 기록의 제목, 없으면 사이트 이름
  url: string; // 실제로 검색된 정부 사이트 주소
}

export interface WebClueResult {
  clues: WebClue[];
  references: ReferenceLink[];
  notice?: string; // 웹검색을 하지 못했을 때 안내
}

const MAX_CLUES = 10;
const MAX_REFERENCES = 5;
// 질의회신 링크로 인정하는 정부 사이트 주소 끝부분
const GOVERNMENT_DOMAINS = [".go.kr", "korea.kr"];

// ─────────────────────────────────────────────────────────────
// AI 답의 모양
// ─────────────────────────────────────────────────────────────

const clueSchema = z.object({
  kind: z.enum(["prec", "detc", "expc", "decc", "law"]).describe(
    "prec=법원 판례, detc=헌법재판소 결정, expc=법제처 법령해석례, decc=행정심판례, law=법령 조문",
  ),
  caseNumber: z.string().describe("사건번호 또는 안건번호. 없으면 빈 글"),
  court: z.string().describe("판례의 법원 이름. 해당 없으면 빈 글"),
  decisionDate: z.string().describe("선고일·결정일·회신일·재결일(예: 2024.6.27). 모르면 빈 글"),
  lawName: z.string().describe("법령 조문 단서일 때 법령 정식 이름. 아니면 빈 글"),
  article: z.string().describe("법령 조문 단서일 때 조문 번호(예: 제72조). 아니면 빈 글"),
});

const answerSchema = z.object({
  clues: z.array(clueSchema),
  references: z
    .array(z.object({ url: z.string().describe("질의회신이 실린 정부 사이트 페이지 주소") }))
    .describe("법제처에 없는 중앙부처·지자체의 질의회신·유권해석 페이지"),
});

const INSTRUCTIONS = [
  "웹에서 이 사안과 관련된 실제 사례를 찾고, 사례를 식별하는 정보만 뽑는다. 문장이나 요약은 쓰지 않는다.",
  "검색할 때는 사안의 법률 용어로만 검색한다. 사람 이름·주소·연락처는 검색어에 넣지 않는다.",
  "clues: 웹 페이지에서 실제로 본 판례·헌재 결정·법령해석례·행정심판례의 번호와 날짜, 또는 법령 조문.",
  "  - 판례(prec)는 사건번호·법원·선고일을 모두 적는다. 해석례(expc)는 안건번호·회신일, 행정심판례(decc)는 사건번호·재결일.",
  "  - 페이지에서 확인하지 못한 칸은 빈 글로 둔다. 기억이나 추측으로 채우지 않는다.",
  `  - 최대 ${MAX_CLUES}건.`,
  `references: 법제처에 없는 부처 질의회신·유권해석이 실린 정부 사이트 페이지 주소. 최대 ${MAX_REFERENCES}건.`,
].join("\n");

// ─────────────────────────────────────────────────────────────
// 정리 (자동 시험 대상)
// ─────────────────────────────────────────────────────────────

type RawAnswer = z.infer<typeof answerSchema>;

/** AI가 준 단서를 정리한다. 종류별로 필수 칸이 없는 단서는 버린다(어차피 검증할 수 없으므로). */
export function sanitizeClues(raw: RawAnswer["clues"]): WebClue[] {
  const out: WebClue[] = [];
  const seen = new Set<string>();
  for (const c of raw) {
    const clue: WebClue = {
      kind: c.kind,
      caseNumber: normalizeCaseNumber(c.caseNumber),
      court: c.court.replace(/\s+/g, " ").trim(),
      decisionDate: normalizeDate(c.decisionDate),
      lawName: c.lawName.replace(/[「」]/g, "").replace(/\s+/g, " ").trim(),
      article: c.article.replace(/\s+/g, ""),
    };
    const usable =
      clue.kind === "law"
        ? Boolean(clue.lawName && parseArticleLabel(clue.article))
        : clue.kind === "prec"
          ? Boolean(clue.caseNumber && clue.court && clue.decisionDate)
          : Boolean(clue.caseNumber && clue.decisionDate);
    if (!usable) continue;
    if (clue.kind !== "law") {
      clue.lawName = "";
      clue.article = "";
    }
    if (clue.kind !== "prec") clue.court = clue.kind === "detc" ? "헌법재판소" : "";
    const key = `${clue.kind}|${clue.caseNumber}|${clue.lawName}|${clue.article}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clue);
    if (out.length >= MAX_CLUES) break;
  }
  return out;
}

/** 주소의 사이트 이름(예: www.molit.go.kr) */
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** 정부 사이트 주소인지 */
export function isGovernmentUrl(url: string): boolean {
  const host = hostOf(url);
  return host !== "" && GOVERNMENT_DOMAINS.some((d) => host.endsWith(d));
}

/** 주소 비교용: 끝의 / 와 #뒤 부분, http/https 차이를 없앤다 */
function urlKey(url: string): string {
  return url.replace(/^http:\/\//i, "https://").replace(/#.*$/, "").replace(/\/$/, "");
}

/**
 * 질의회신 링크를 정리한다.
 * - AI가 실제로 검색한 페이지(sources)에 있는 주소만 남긴다(지어낸 링크 차단).
 * - 정부 사이트 주소만 남긴다. 법제처(law.go.kr) 주소는 이미 법제처 조회로 다루므로 뺀다.
 * - 제목은 검색 기록의 제목만 쓰고, 없으면 사이트 이름을 쓴다.
 */
export function sanitizeReferences(raw: RawAnswer["references"], sources: WebSource[]): ReferenceLink[] {
  const known = new Map(sources.map((s) => [urlKey(s.url), s]));
  const out: ReferenceLink[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const key = urlKey(r.url.trim());
    const source = known.get(key);
    if (!source || seen.has(key)) continue;
    const host = hostOf(source.url);
    if (!isGovernmentUrl(source.url) || host.endsWith("law.go.kr")) continue;
    seen.add(key);
    out.push({ title: source.title ?? `${host} 자료`, url: source.url });
    if (out.length >= MAX_REFERENCES) break;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// 웹검색
// ─────────────────────────────────────────────────────────────

/**
 * 웹검색으로 단서를 찾는다. 입력은 개인정보를 가린 사안이어야 한다.
 * 실패해도 오류로 멈추지 않고, 단서 없이 안내만 돌려준다(법제처 직접 검색 결과는 그대로 쓰도록).
 */
export async function findWebClues(maskedInput: CaseInput, keywords: string[]): Promise<WebClueResult> {
  const result = await askAiJsonWithWebSearch({
    instructions: INSTRUCTIONS,
    input: [
      `사안 내용: ${maskedInput.facts}`,
      `판단해야 할 쟁점: ${maskedInput.issue}`,
      maskedInput.field ? `관련 분야: ${maskedInput.field}` : "",
      keywords.length ? `참고 검색어: ${keywords.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
    schema: answerSchema,
    schemaName: "web_clues",
  });

  if (!result.ok) {
    return {
      clues: [],
      references: [],
      notice: `웹에서 사례 단서를 찾지 못했습니다(${result.error.message}). 법제처에서 직접 찾은 결과만 보여드립니다.`,
    };
  }

  return {
    clues: sanitizeClues(result.data.answer.clues),
    references: sanitizeReferences(result.data.answer.references, result.data.sources),
  };
}
