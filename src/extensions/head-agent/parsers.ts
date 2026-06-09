/**
 * Response parsers for the autonomous debug loop.
 */

export function parseFindingsFromResponse(text: string): Array<{ file: string; line: string; issueType: string; description: string; hash: string }> {
  const lines: string[] = text.match(/^FINDING:\s*.+$/gm) || [];
  return lines.map(line => {
    const clean = line.replace(/^FINDING:\s*/, "");
    const dashIdx = clean.indexOf("\u2014");
    const desc = dashIdx >= 0 ? clean.slice(dashIdx + 1).trim() : "";
    const parts = dashIdx >= 0 ? clean.slice(0, dashIdx).trim() : clean;

    // Normalize backslashes to forward slashes for consistent parsing.
    // Windows paths like C:\Users\src\file.ts become C:/Users/src/file.ts.
    const normalized = parts.replace(/\\/g, "/");
    const segments = normalized.split(":");

    // We need at least 2 segments: <file|path>:<issueType>
    // 2 segments → file:issueType  (no line number — use "0")
    // 3 segments → file:line:issueType
    // 4+ segments → likely a Windows drive letter (C:) prefix — reassemble
    if (segments.length < 2) return null;

    const issueType = (segments.pop() ?? "").trim();
    if (!issueType) return null;

    // Check if the last remaining segment is a line number
    let lineNum = "0";
    const tail = segments[segments.length - 1]?.trim() ?? "";
    if (/^\d+$/.test(tail)) {
      lineNum = (segments.pop() ?? "0").trim();
    }

    // Re-join remaining segments with ":" to restore drive-letter paths
    let file = segments.join(":").trim();
    if (!file) return null;

    // Restore original backslashes if the source used them
    if (parts.includes("\\")) {
      const rawSegments = parts.split(":");
      const popCount = 1 + (lineNum !== "0" ? 1 : 0);
      const fileSegments = rawSegments.slice(0, rawSegments.length - popCount);
      file = fileSegments.join(":");
    }

    return { file, line: lineNum, issueType, description: desc || clean, hash: "" };
  }).filter((x): x is NonNullable<typeof x> => x !== null);
}

export function parseTriageResults(text: string): Array<{ hash: string; issueNumber: string | null; wontfix: boolean }> {
  const results: Array<{ hash: string; issueNumber: string | null; wontfix: boolean }> = [];
  for (const line of (text.match(/^TRIAGE_RESULT:\s*.+$/gm) || [])) {
    const clean = line.replace(/^TRIAGE_RESULT:\s*/, "");
    const hash = clean.split(":")[0]?.trim();
    if (!hash) continue;
    if (clean.includes("wontfix")) results.push({ hash, issueNumber: null, wontfix: true });
    else {
      const m = clean.match(/issue=(\d+)/);
      results.push({ hash, issueNumber: m?.[1] || null, wontfix: false });
    }
  }
  return results;
}

export function parseFixResults(text: string): Array<{ hash: string; success: boolean; prNumber: string | null }> {
  const results: Array<{ hash: string; success: boolean; prNumber: string | null }> = [];
  for (const line of (text.match(/^FIX_RESULT:\s*.+$/gm) || [])) {
    const clean = line.replace(/^FIX_RESULT:\s*/, "");
    const hash = clean.split(":")[0]?.trim();
    if (!hash) continue;
    results.push({ hash, success: clean.includes("status=success"), prNumber: clean.match(/pr=(\d+)/)?.[1] || null });
  }
  return results;
}

export function parseTestResults(text: string): Array<{ suite: string; passed: boolean; failures: number }> {
  const results: Array<{ suite: string; passed: boolean; failures: number }> = [];
  for (const line of (text.match(/^TEST_RESULT:\s*.+$/gm) || [])) {
    const clean = line.replace(/^TEST_RESULT:\s*/, "");
    const suite = clean.split(":")[0]?.trim() || "unknown";
    results.push({ suite, passed: clean.includes("status=pass"), failures: parseInt(clean.match(/failures=(\d+)/)?.[1] || "0", 10) });
  }
  return results;
}

export function parseReflection(text: string): string {
  return text.match(/^REFLECT:\s*(.+)$/m)?.[1] || text.split("\n").filter(l => l.trim()).slice(-1)[0] || "No summary";
}
