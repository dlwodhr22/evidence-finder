// PLAN 작업 5: 개인정보 감지·자동 가림 도구.
// 사안 내용이 AI·웹검색으로 나가기 전에 이 도구로 먼저 가린다.
//
// Design Ref: §4.1 데이터 흐름 — 사안 입력 → [서버] 개인정보 감지·가림 → AI 검색어 추출 …
// PRD 7번: 이름·전화번호·주민등록번호 등의 패턴을 감지하면 자동으로 가린 뒤 진행한다.
//
// 원칙
// - 형식이 분명한 것(주민등록번호, 전화번호, 이메일, 사업자등록번호, 동·호수 등)은 확실히 가린다.
// - 한글 이름은 정해진 형식이 없어 정확히 찾기 어렵다. "홍길동 씨/님/귀하"처럼 호칭이 붙은
//   경우만 가린다. 이름에 대해서는 입력창의 안내문이 주된 보호 수단이고, 자동 가림은 보조다.
// - 가린 원래 값은 어디에도 돌려주지 않는다(종류와 개수만 알려준다).

/** 가리는 개인정보 종류 */
export type PiiKind =
  | "resident-id" // 주민등록번호·외국인등록번호
  | "phone" // 휴대전화·일반전화
  | "email" // 이메일
  | "business-id" // 사업자등록번호
  | "address" // 주소의 자세한 부분(도로명+건물번호, 번지, 동·호수)
  | "name"; // 호칭이 붙은 이름

interface PiiRule {
  kind: PiiKind;
  label: string; // 화면에 보일 이름이자 가린 자리에 들어갈 표시
  pattern: RegExp;
}

// 숫자 앞뒤가 다른 숫자에 붙어 있지 않을 때만 찾는다(사건번호·날짜 등과 헷갈리지 않게).
const NOT_DIGIT_BEFORE = "(?<!\\d)";
const NOT_DIGIT_AFTER = "(?!\\d)";

// 흔한 성씨(한 글자·두 글자). 호칭 앞의 낱말이 이름인지 판단할 때 쓴다.
const SURNAMES =
  "남궁|황보|제갈|선우|독고|사공|서문|" +
  "김|이|박|최|정|강|조|윤|장|임|한|오|서|신|권|황|안|송|류|유|전|홍|고|문|양|손|배|백|허|남|심|노|하|곽|성|차|주|우|구|민|진|나|지|엄|채|원|천|방|공|현|함|변|염|여|추|도|소|석|선|설|마|길|연|위|표|명|기|반|왕|금|옥|육|인|맹|제|모|탁|국|어|은|편|용|예|봉|경|사|부|태|피|승|빈|감|라|낭|당|동|두|목|묵|미|범|복|빙|상|순|시|아|애|야|양|엽|영|온|요|운|웅|음|이|자|잠|장|저|점|좌|중|증|창|초|춘|탄|판|팽|평|포|풍|필|학|해|형|호|화|환|후|흥";

// 호칭 뒤에 올 수 있는 조사. 이름 뒤가 이것이거나 글자가 아닐 때만 이름으로 본다("솜씨가" 같은 낱말 제외).
const PARTICLE_AFTER =
  "(?=$|[^가-힣]|은|는|이|가|을|를|의|에게|께|께서|도|와|과|로|으로|에|이랑|랑|한테|만)";

// 이름처럼 보여도 사람 이름이 아닌 낱말(호칭과 자주 붙어 쓰임)
const NOT_NAMES = new Set([
  "민원인", "신청인", "청구인", "고객", "담당자", "주무관", "선생", "사장", "대표", "관계자",
  "점유자", "사용자", "이용자", "소유자", "임차인", "임대인", "당사자", "대상자", "부과대상자",
  "여러분", "어르신", "본인", "당신", "귀하", "회원", "의원", "위원", "과장", "팀장", "국장",
  "실장", "부장", "차장", "대리", "주임", "계장", "소장", "원장", "시장", "구청장", "군수",
  "어머", "아버", "아드", "사모", "선배", "후배", "기사", "박사", "이사", "전무", "상무",
]);

const RULES: PiiRule[] = [
  {
    kind: "email",
    label: "이메일",
    // 전화번호보다 먼저 찾는다(이메일 앞부분의 숫자가 전화번호로 잘리지 않게).
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  },
  {
    kind: "resident-id",
    label: "주민등록번호",
    // 예: 900101-1234567, 9001011234567 (뒷자리 첫 숫자 1~8)
    pattern: new RegExp(`${NOT_DIGIT_BEFORE}\\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\\d|3[01])\\s?-?\\s?[1-8]\\d{6}${NOT_DIGIT_AFTER}`, "g"),
  },
  {
    kind: "business-id",
    label: "사업자등록번호",
    // 예: 123-45-67890 (구분 기호가 있는 경우만. 숫자만 10자리는 다른 번호와 헷갈림)
    pattern: new RegExp(`${NOT_DIGIT_BEFORE}\\d{3}-\\d{2}-\\d{5}${NOT_DIGIT_AFTER}`, "g"),
  },
  {
    kind: "phone",
    label: "전화번호",
    // 예: 010-1234-5678, 01012345678, +82 10-1234-5678, 02-123-4567, 031 123 4567
    // 국가번호(+82)가 없으면 반드시 0으로 시작해야 전화번호로 본다.
    pattern: new RegExp(
      `(?:\\+82[-.\\s]?0?|${NOT_DIGIT_BEFORE}0)(1[016789]|2|[3-6][1-5]|70)[-.\\s)]?\\d{3,4}[-.\\s]?\\d{4}${NOT_DIGIT_AFTER}`,
      "g",
    ),
  },
  {
    kind: "address",
    label: "주소",
    // 예: 세종대로 110, 테헤란로 12길 34, 123-4번지, 101동 1203호
    // 숫자 뒤에는 조사("110에", "34의")만 허용한다. "진입로 2곳", "창고로 3년"처럼
    // 수량을 나타내는 글자가 붙으면 주소로 보지 않는다.
    pattern: new RegExp(
      [
        `[가-힣0-9]+(로|길)\\s?\\d+(-\\d+)?(번?길\\s?\\d+(-\\d+)?)?(?=$|[^가-힣0-9]|에|의|로|으로|까지|부터|은|는|이|가|을|를|와|과|도)`,
        `${NOT_DIGIT_BEFORE}\\d+(-\\d+)?\\s?번지`,
        `${NOT_DIGIT_BEFORE}\\d+\\s?동\\s?\\d+\\s?호`,
      ].join("|"),
      "g",
    ),
  },
  {
    kind: "name",
    label: "이름",
    // 예: 홍길동 씨, 김영희님, 남궁민수 귀하, 이철수 씨는
    pattern: new RegExp(`(?<![가-힣])((?:${SURNAMES})[가-힣]{1,3})\\s?(씨|님|귀하)${PARTICLE_AFTER}`, "g"),
  },
];

const LABELS: Record<PiiKind, string> = Object.fromEntries(
  RULES.map((rule) => [rule.kind, rule.label]),
) as Record<PiiKind, string>;

export interface PiiFinding {
  kind: PiiKind;
  label: string; // 예: "전화번호"
  count: number; // 가린 개수
}

export interface MaskResult {
  text: string; // 개인정보를 가린 글
  findings: PiiFinding[]; // 무엇을 몇 개 가렸는지(원래 값은 없음)
}

/**
 * 글에서 개인정보를 찾아 "[전화번호]"처럼 바꾼다.
 * 원래 값은 돌려주지 않고, 종류와 개수만 알려준다.
 */
export function maskPii(input: string): MaskResult {
  const counts = new Map<PiiKind, number>();
  let text = input;

  for (const rule of RULES) {
    text = text.replace(rule.pattern, (match: string, ...groups: unknown[]) => {
      if (rule.kind === "name") {
        const name = typeof groups[0] === "string" ? groups[0] : "";
        const honorific = typeof groups[1] === "string" ? groups[1] : "";
        // 이름이 아닌 낱말("민원인 님" 등)은 그대로 둔다.
        if (NOT_NAMES.has(name)) return match;
        counts.set(rule.kind, (counts.get(rule.kind) ?? 0) + 1);
        const space = match.includes(" ") ? " " : "";
        return `[${rule.label}]${space}${honorific}`;
      }
      counts.set(rule.kind, (counts.get(rule.kind) ?? 0) + 1);
      return `[${rule.label}]`;
    });
  }

  const findings: PiiFinding[] = [...counts.entries()].map(([kind, count]) => ({
    kind,
    label: LABELS[kind],
    count,
  }));

  return { text, findings };
}

/** 가린 결과를 화면에 보여줄 한 줄 안내. 가린 것이 없으면 빈 글. */
export function describeFindings(findings: PiiFinding[]): string {
  if (findings.length === 0) return "";
  const parts = findings.map((f) => `${f.label} ${f.count}건`);
  return `개인정보로 보이는 부분을 가렸습니다: ${parts.join(", ")}`;
}

/** 입력창에 늘 보여줄 안내문(PRD 7번) */
export const PII_NOTICE =
  "개인정보(이름, 주소, 전화번호, 주민등록번호 등)는 입력하지 마세요. 앱이 일부를 자동으로 가리지만 모두 찾아내지는 못합니다.";
