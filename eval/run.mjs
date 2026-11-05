// PLAN 작업 19: 국유재산 관리업무 시험 세트를 실행해 성공 기준 1~6을 점검한다.
// 사용: 개발 서버(npm run dev, 포트는 BASE로 지정)를 켠 상태에서  node eval/run.mjs
//   BASE=http://localhost:3100  ONLY=1,3  CONCURRENCY=3  node eval/run.mjs
// 결과: eval/results/case-N.json (사례별 원자료)와 eval/report.md (사람이 읽는 보고서).
// 사례는 모두 지어낸 것이다(개인정보 없음). 앱의 API를 실제 사용자처럼 호출한다.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const BASE = process.env.BASE || "http://localhost:3100";
const ONLY = process.env.ONLY ? process.env.ONLY.split(",").map(Number) : null;
const CONCURRENCY = Number(process.env.CONCURRENCY || 3);
const dir = path.dirname(fileURLToPath(import.meta.url));

async function post(url, body) {
  try {
    const res = await fetch(BASE + url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json();
    return { status: res.status, ...json };
  } catch (e) {
    return { status: 0, error: { message: String(e.message || e) } };
  }
}

// 화면(results.ts)과 같은 열쇠
const keyOf = (i) => (i.kind === "law" ? `law:${i.source}:${i.id}:${i.article ?? ""}` : i.kind === "case" ? `case:${i.source}:${i.id}` : `${i.kind}:${i.id}`);
const GROUPS = { statutes: "법령", ordinances: "조례·규칙", cases: "판례", interpretations: "법령해석례", tribunals: "행정심판례" };

function merge(results, verified) {
  const out = { statutes: [], ordinances: [], cases: [], interpretations: [], tribunals: [] };
  const kindOf = (i) => (i.kind === "law" ? (i.source === "ordin" ? "ordinances" : "statutes") : i.kind === "case" ? "cases" : i.kind === "interpretation" ? "interpretations" : "tribunals");
  const seen = new Set();
  for (const i of [...verified, ...Object.values(results).flat()]) {
    const k = keyOf(i);
    if (seen.has(k)) continue;
    seen.add(k);
    if (out[kindOf(i)].length < 8) out[kindOf(i)].push(i);
  }
  return out;
}

const citation = (i) =>
  i.kind === "law" ? `${i.lawType} · ${i.authority}${i.article ? ` · ${i.article}` : ""} · 시행 ${i.effectiveDate}` : i.kind === "case" ? `${i.court} ${i.decisionDate} ${i.caseNumber}` : `${i.authority} ${i.decisionDate} ${i.caseNumber}`;

const refOf = (i) => (i.kind === "law" ? { kind: "law", source: i.source, id: i.id, ...(i.article ? { article: i.article } : {}) } : i.kind === "case" ? { kind: "case", source: i.source, id: i.id } : { kind: i.kind, id: i.id });

async function runCase(c) {
  const t0 = Date.now();
  const input = { facts: c.facts, issue: c.issue, field: c.field };
  const rec = { id: c.id, title: c.title, negative: !!c.negative, errors: [] };

  // ① 검색과 웹 단서 확인(화면과 똑같이 동시에 요청)
  const [s, w] = await Promise.all([post("/api/search", input), post("/api/clues", input)]);
  if (!s.data) rec.errors.push(`검색 실패: ${s.error?.message}`);
  if (!w.data) rec.errors.push(`웹 단서 실패: ${w.error?.message}`);
  const results = s.data?.results ?? { statutes: [], ordinances: [], cases: [], interpretations: [], tribunals: [] };
  const verified = w.data?.verified ?? [];
  const merged = merge(results, verified);
  const items = Object.entries(merged).flatMap(([g, list]) => list.map((i) => ({ group: GROUPS[g], web: verified.some((v) => keyOf(v) === keyOf(i)), item: i })));
  rec.terms = s.data?.terms;
  rec.foundNothing = items.length === 0;
  rec.notices = [...(s.data?.notices ?? []), ...(w.data?.notices ?? [])];
  rec.failedClues = (w.data?.failed ?? []).length;
  rec.references = (w.data?.references ?? []).length;

  // ② 항목별 자동 점검
  rec.items = [];
  const kw = c.expect ?? [];
  for (const { group, web, item } of items) {
    const row = { group, web, key: keyOf(item), title: item.title, citation: citation(item), sourceUrl: item.sourceUrl };
    row.hasSource = typeof item.sourceUrl === "string" && /^https:\/\/www\.law\.go\.kr\//.test(item.sourceUrl) && !/OC=/i.test(item.sourceUrl) && !!item.title && citation(item).length > 5;
    row.proxyRelevant = kw.length === 0 ? null : kw.some((k) => item.title.includes(k) || (item.article ?? "").includes(k));
    if (item.kind === "law") {
      row.currentLabel = !item.isCurrent ? "현행 아님" : item.notYetEffective ? "시행 예정" : "현행";
    }
    // 존재·번호 재확인: 법제처에서 다시 가져와 대조(바뀌면 corrected, 없으면 removed)
    const f = await post("/api/feedback", { reason: "wrong", item });
    row.recheck = f.data?.outcome ?? `오류(${f.error?.message})`;
    row.recheckChanges = f.data?.changes ?? [];
    if (item.kind === "law") {
      const o = await post("/api/feedback", { reason: "outdated", item });
      row.currentRecheck = o.data?.outcome ?? `오류(${o.error?.message})`;
      if (o.data?.item) row.currentMismatch = o.data.item.isCurrent !== item.isCurrent || o.data.item.notYetEffective !== item.notYetEffective;
    }
    rec.items.push(row);
  }

  // ③ 판단 후보·회신 초안: 담당자가 고르듯 근거를 고른다.
  //   - cases.json의 articles: 담당자가 근거로 정한 법령 조문(법령은 조문을 정해야 근거가 된다)
  //   - 그 밖에 목록에서 사례 핵심어가 제목에 있는 판례·해석례를 채워 최대 3건
  const order = { law: 0, case: 1, interpretation: 2, tribunal: 3 };
  const picks = [];
  for (const { law, article } of c.articles ?? []) {
    const hit = items.map((x) => x.item).find((i) => i.kind === "law" && i.source === "law" && i.title === law && i.isCurrent && !i.notYetEffective);
    if (hit && picks.length < 2) picks.push({ ...hit, article });
  }
  const rest = items.map((x) => x.item).filter((i) => i.kind !== "law" && kw.some((k) => i.title.includes(k)));
  for (const i of rest.sort((x, y) => order[x.kind] - order[y.kind])) if (picks.length < 3) picks.push(i);
  rec.picks = picks.map((p) => `${p.title}${p.article ? ` ${p.article}` : ""}`);
  if (picks.length > 0) {
    const refs = picks.map(refOf);
    const cand = await post("/api/candidates", { input, picks: refs });
    if (!cand.data) {
      rec.candidates = { error: cand.error?.message };
    } else {
      rec.candidates = cand.data;
      const toP = (ps) => ps.map((p) => ({ text: p.text, quote: p.quote, sourceId: p.source.id }));
      const shown = cand.data.candidates.map((x) => ({ title: x.title, reasons: toP(x.reasons), counterpoints: toP(x.counterpoints) }));
      if (shown.length > 0) {
        const d = await post("/api/draft", { input, picks: refs, candidate: shown[0] });
        rec.draft = d.data ? d.data : { error: d.error?.message };
      }
    }
  }

  // ④ 원문 요약(상위 2건): 원문과 어긋나는 문장이 화면에 나가는지 — 서버가 이미 걸러 낸 뒤의 문장을 한 번 더 점검
  rec.summaries = [];
  for (const p of picks.slice(0, 2)) {
    const q = new URLSearchParams({ kind: p.kind, id: p.id, summary: "1" });
    if (p.source) q.set("source", p.source);
    if (p.article) q.set("article", p.article);
    try {
      const r = await (await fetch(`${BASE}/api/document?${q}`)).json();
      rec.summaries.push({ title: p.title, sentences: r.data?.sentences?.length ?? 0, dropped: r.data?.droppedCount ?? 0, error: r.error?.message });
    } catch (e) {
      rec.summaries.push({ title: p.title, error: String(e.message || e) });
    }
  }

  rec.seconds = Math.round((Date.now() - t0) / 1000);
  return rec;
}

// ── 실행 ──────────────────────────────────────────────────
const cases = JSON.parse(await readFile(path.join(dir, "cases.json"), "utf8")).filter((c) => !ONLY || ONLY.includes(c.id));
await mkdir(path.join(dir, "results"), { recursive: true });
const recs = [];
let next = 0;
async function worker() {
  while (next < cases.length) {
    const c = cases[next++];
    console.log(`시작 ${c.id}. ${c.title}`);
    const r = await runCase(c);
    await writeFile(path.join(dir, "results", `case-${c.id}.json`), JSON.stringify(r, null, 2), "utf8");
    console.log(`끝   ${c.id}. ${c.title} (${r.seconds}초, 항목 ${r.items.length}건${r.errors.length ? `, 오류 ${r.errors.length}` : ""})`);
    recs.push(r);
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, cases.length) }, worker));
recs.sort((a, b) => a.id - b.id);

// ── 보고서 ────────────────────────────────────────────────
const real = recs.filter((r) => !r.negative);
const all = real.flatMap((r) => r.items);
const pct = (a, b) => (b === 0 ? "해당 없음" : `${a}/${b} (${Math.round((a / b) * 100)}%)`);
const L = [];
L.push("# 국유재산 시험 세트 결과 (PLAN 작업 19번)", "");
L.push(`실행 시각: ${new Date().toISOString()} · 사례 ${real.length}건 + 음성 시험 ${recs.length - real.length}건 · 항목 ${all.length}건`, "");
L.push("> 자동 점검은 사람의 확인을 돕는 것이다. **성공 기준 1~5의 최종 판정은 담당자가 아래 목록을 보고 직접 한다.**", "");
L.push("## 한눈에 보기", "");
L.push("| 성공 기준 | 자동 점검 결과 | 사람이 확인할 것 |", "|---|---|---|");
L.push(`| 1 환각 0건 | 법제처에서 다시 가져왔을 때 없는 자료(removed): **${all.filter((i) => i.recheck === "removed").length}건** / 번호·날짜가 달라 고쳐진 자료(corrected): ${all.filter((i) => i.recheck === "corrected").length}건 | 아래 목록의 제목이 실제 자료인지 |`);
L.push(`| 2 출처 표기율 | ${pct(all.filter((i) => i.hasSource).length, all.length)} | 링크가 열리는지(표본) |`);
L.push(`| 3 인용 일치 | 화면에 나간 후보·초안 문장은 모두 근거 구절이 원문에 글자 그대로 있는 것만이다(걸러진 문장: 후보 ${real.reduce((n, r) => n + (r.candidates?.droppedCount ?? 0), 0)}개, 초안 ${real.reduce((n, r) => n + (r.draft?.droppedCount ?? 0), 0)}개) | 후보·초안 문장이 근거 구절의 뜻과 맞는지 |`);
const laws = all.filter((i) => i.currentLabel);
L.push(`| 4 현행 여부 | 법령 ${laws.length}건 중 현행 표시가 법제처 재조회와 다른 것: **${laws.filter((i) => i.currentMismatch).length}건**, 현행 아님/시행 예정으로 표시된 것: ${laws.filter((i) => i.currentLabel !== "현행").length}건 | 현행 아님 표시가 맞는지 |`);
const rel = all.filter((i) => i.proxyRelevant !== null);
L.push(`| 5 관련성(80% 이상) | 제목·조문에 사례 핵심어가 있는 비율(참고 추정): ${pct(rel.filter((i) => i.proxyRelevant).length, rel.length)} | **사람이 항목마다 관련 여부를 표시** |`);
const neg = recs.find((r) => r.negative);
L.push(`| 6 찾지 못하면 "찾지 못했다" | ${neg ? (neg.foundNothing ? "음성 시험: 항목 0건 → '찾지 못했다' 표시 (통과)" : `음성 시험: 항목 ${neg.items.length}건이 나옴 (아래 확인)`) : "음성 시험 안 함"} | |`);
L.push("");
L.push("## 사례별 결과", "");
for (const r of recs) {
  L.push(`### ${r.id}. ${r.title}${r.negative ? " (음성 시험)" : ""} — ${r.seconds}초`, "");
  if (r.errors.length) L.push(`- ⚠ 오류: ${r.errors.join(" / ")}`);
  L.push(`- AI가 뽑은 검색어: 법령명 ${JSON.stringify(r.terms?.lawNames ?? [])}, 키워드 ${JSON.stringify(r.terms?.keywords ?? [])}`);
  L.push(`- 확인된 자료 ${r.items.length}건 · 검증 실패 단서 ${r.failedClues}건 · 참고(검증 안 됨) 링크 ${r.references}건`);
  if (r.items.length) {
    L.push("", "| 관련? (O/X) | 구분 | 제목 | 출처 | 현행 | 다시 대조 | 웹 단서 |", "|---|---|---|---|---|---|---|");
    for (const i of r.items) {
      L.push(`| ☐ | ${i.group} | ${i.title.replace(/\|/g, "/")} | ${i.citation.replace(/\|/g, "/")} | ${i.currentLabel ?? "-"} | ${i.recheck}${i.recheckChanges.length ? ` (${i.recheckChanges.join("; ")})` : ""} | ${i.web ? "예" : ""} |`);
    }
  }
  L.push("");
  if (r.picks?.length) {
    L.push(`- 근거로 고른 자료(자동): ${r.picks.join(" / ")}`);
    if (r.candidates?.error) L.push(`- ⚠ 판단 후보 실패: ${r.candidates.error}`);
    else if (r.candidates) {
      L.push(`- 판단 후보 ${r.candidates.candidates.length}개 (근거 구절 확인에서 빠진 문장 ${r.candidates.droppedCount}개)`);
      for (const c of r.candidates.candidates) {
        L.push(`  - **${c.title}**`);
        for (const p of c.reasons) L.push(`    - 근거: ${p.text} _(원문: “${p.quote.slice(0, 60)}…”, ${p.source.title})_`);
        for (const p of c.counterpoints) L.push(`    - 엇갈림: ${p.text}`);
      }
    }
    if (r.draft?.error) L.push(`- ⚠ 회신 초안 실패: ${r.draft.error}`);
    else if (r.draft?.title) {
      L.push(`- 회신 초안 「${r.draft.title}」 — 경위 ${r.draft.background.length}문장 / 검토 결과 ${r.draft.review.length}문장 / 회신 내용 ${r.draft.reply.length}문장 (빠진 문장 ${r.draft.droppedCount})`);
      for (const [h, xs] of [["경위", r.draft.background], ["검토 결과", r.draft.review], ["회신 내용", r.draft.reply]]) for (const s of xs) L.push(`  - [${h}] ${s.text}`);
    }
  } else if (!r.negative) {
    L.push("- 근거로 자동 선택할 자료가 없어 판단 후보·초안은 시험하지 못했다(조문이 정해진 법령·판례 등이 없음).");
  }
  if (r.summaries?.length) L.push(`- 원문 요약: ${r.summaries.map((s) => `${s.title.slice(0, 20)} → ${s.error ? "오류 " + s.error : `${s.sentences}문장(빠진 ${s.dropped})`}`).join(" / ")}`);
  L.push("");
}
await writeFile(path.join(dir, "report.md"), L.join("\n"), "utf8");
console.log("보고서: eval/report.md");
