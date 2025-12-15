"use server";

import fs from "fs/promises";
import path from "path";

export type TestCase = {
  id: string; // relative path
  name: string; // filename
  category: string; // folder name
  content: string;
  description?: string;
  expectedResult?: "Secure" | "SNI_Violation";
};

export type TestCategory = {
  name: string;
  cases: TestCase[];
};

const CASES_DIR = path.join(process.cwd(), "muasm_case");

async function parseMuasmMetadata(content: string): Promise<{
  description?: string;
  expectedResult?: "Secure" | "SNI_Violation";
}> {
  const lines = content.split("\n");
  let description = "";
  let expectedResult: "Secure" | "SNI_Violation" | undefined;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("%")) {
      // Parse Description
      if (trimmed.includes("概要:")) {
        // Start capturing description? For now, we just take the line or next lines.
        // Simple heuristic: Look for lines that look like description or just aggregate comments.
        // Let's look for specific marker lines.
      }
      
      // Parse Expected Result
      if (trimmed.includes("期待:") || trimmed.includes("Expect:")) {
        if (trimmed.includes("Secure")) expectedResult = "Secure";
        if (trimedHasViolation(trimmed)) expectedResult = "SNI_Violation";
      }
    }
  }

  // extract simple description from top comments
  const commentBlock = lines
    .takeWhile((l) => l.trim().startsWith("%"))
    .map((l) => l.replace(/^%\s?/, "").trim())
    .filter((l) => l.length > 0 && !l.startsWith("期待") && !l.startsWith("Expect"));
  
  if (commentBlock.length > 0) {
    description = commentBlock.join("\n");
  }

  return { description, expectedResult };
}

function trimedHasViolation(s: string) {
  return s.includes("Violation") || s.includes("SNI_Violation");
}

// Helper for Array.takeWhile-like behavior
declare global {
  interface Array<T> {
    takeWhile(predicate: (item: T) => boolean): T[];
  }
}

// Polyfill for takeWhile if not exists (it doesn't in std JS)
// Actually better not to rely on prototype modification in server actions.
function takeWhile<T>(arr: T[], predicate: (item: T) => boolean): T[] {
  const result: T[] = [];
  for (const item of arr) {
    if (!predicate(item)) break;
    result.push(item);
  }
  return result;
}

export async function getTestCases(): Promise<TestCategory[]> {
  try {
    const entries = await fs.readdir(CASES_DIR, { withFileTypes: true });
    const categories: TestCategory[] = [];

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith(".")) {
        const catPath = path.join(CASES_DIR, entry.name);
        const files = await fs.readdir(catPath);
        const cases: TestCase[] = [];

        for (const file of files) {
          if (file.endsWith(".muasm")) {
            const filePath = path.join(catPath, file);
            const content = await fs.readFile(filePath, "utf-8");
            
            // Basic metadata parsing
            let description = "";
            let expectedResult: "Secure" | "SNI_Violation" | undefined;

            const lines = content.split("\n");
            const comments = takeWhile(lines, (l) => l.trim().startsWith("%"));
            
            // Extract Description (all comments excluding metadata)
            description = comments
              .map(l => l.replace(/^%\s?/, "").trim())
              .filter(l => !l.startsWith("期待") && !l.startsWith("Expect:") && !l.startsWith("Case:"))
              .join(" "); // One liner for UI

             // Extract Expected
             const expectedLine = comments.find(l => l.includes("期待") || l.includes("Expect"));
             if (expectedLine) {
               if (expectedLine.includes("Secure")) expectedResult = "Secure";
               if (expectedLine.includes("Violation")) expectedResult = "SNI_Violation";
             }

            cases.push({
              id: `${entry.name}/${file}`,
              name: file,
              category: entry.name,
              content,
              description: description.slice(0, 100) + (description.length > 100 ? "..." : ""),
              expectedResult,
            });
          }
        }
        
        if (cases.length > 0) {
          categories.push({ name: entry.name, cases });
        }
      }
    }

    return categories;
  } catch (error) {
    console.error("Failed to load test cases:", error);
    return [];
  }
}
