// 화면에 링크를 걸어도 되는 주소인지 확인하는 작은 도구(키가 없어 화면에서도 쓴다).
// Design Ref: §10 보안 — 화면에는 법제처 공개 주소와 정부 사이트 주소만 링크로 건다.
//   서버가 이미 걸러 보내지만, 화면에서 한 번 더 확인해 이상한 주소(javascript: 등)는 링크로 만들지 않는다.

/** 법제처 공개 화면 주소인지(인증키가 들어 있으면 안 됨) */
export function isLawGoKrUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "www.law.go.kr" && !u.searchParams.has("OC");
  } catch {
    return false;
  }
}

/** 정부 사이트 주소인지(.go.kr, korea.kr) */
export function isGovernmentLink(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    return (u.protocol === "https:" || u.protocol === "http:") && (host.endsWith(".go.kr") || host === "korea.kr" || host.endsWith(".korea.kr"));
  } catch {
    return false;
  }
}

/** 사이트 이름만(예: www.molit.go.kr) */
export function siteName(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
